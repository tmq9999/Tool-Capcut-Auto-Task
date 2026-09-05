import crypto from 'node:crypto';
import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { PurchasedEmailRepository } from '../repositories/PurchasedEmailRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError } from '../providers/ProviderError';
import { SecretReader } from './SecretReader';
import type { Gmail94Profile, Gmail94Service } from '../providers/Gmail94Provider';
import { AutomationTerminalError } from './AutomationTerminalError';
import type { DongVanCodeResult, DongVanPurchasedMail } from '../providers/DongVanFBProvider';
import { buildCustomDomainAddress, generateMailUsernames } from './mailUsername';
import type { CustomEmailSettingsDTO } from '../../shared/schemas/settings.schema';
import {
  CAPCUT_OTP_SERVICE,
  EmailApiProviderEnum,
  type EmailApiProvider,
  type EmailProviderConfigDTO,
  type EmailSourceProvider,
  type PurchasedEmailDTO
} from '../../shared/schemas/provider.schema';

/**
 * Slug gmail94 dùng khi người gọi không chỉ định. Xem `CAPCUT_OTP_SERVICE`:
 * slug là hằng của site đang tự động hoá, không phải nút của người dùng.
 */
export const DEFAULT_OTP_SERVICE = CAPCUT_OTP_SERVICE;
const DEFAULT_DONGVAN_ACCOUNT_TYPE = 1;
const DEFAULT_DONGVAN_QUALITY = 3;

export interface EmailCapacitySnapshot {
  provider: 'gmail94';
  service: 'capcut';
  balance: number;
  unitPrice: number;
  reusableCount: number;
  affordablePurchaseCount: number;
  totalAvailableCount: number;
  checkedAt: string;
}

export interface ReservedEmail {
  purchasedEmail: PurchasedEmailDTO;
  reservationId: string;
}

export interface EmailAcquisitionSession {
  readonly capacity?: EmailCapacitySnapshot;
  acquireOne(workerId: string, signal: AbortSignal): Promise<ReservedEmail>;
  commit(reservation: ReservedEmail, accountId: string): void;
  release(reservation: ReservedEmail): void;
}

/** The slice of Gmail94Provider used to rent mailboxes and read codes. */
export interface IGmail94EmailApi {
  getProfile(token: string): Promise<Gmail94Profile>;
  listServices(): Promise<Gmail94Service[]>;
  createOtpOrder(token: string, service: string): Promise<{ email: string; orderId: string }>;
  readOtp(token: string, orderId: string, service: string): Promise<string | null>;
}

/** The slice of DongVanFBProvider used to buy mailboxes and read codes. */
export interface IDongVanFBEmailApi {
  buyMail(
    apiKey: string,
    params: { accountType: number | string; quality: number | string; type?: 'full' | 'null' | 'text' }
  ): Promise<DongVanPurchasedMail[]>;
  getOauth2(apiKey: string, email: string, password: string): Promise<{ refreshToken: string; clientId: string }>;
  readCode(
    mode: 'oauth2' | 'graph',
    params: { email: string; refreshToken: string; clientId: string; type: string }
  ): Promise<DongVanCodeResult | null>;
}

/** The slice of CustomDomainMailProvider used to read a catch-all mailbox. */
export interface ICustomDomainMailApi {
  readOtp(
    baseUrl: string,
    address: string,
    options?: { senderContains?: string }
  ): Promise<string | null>;
}

export interface EmailPurchaseApis {
  gmail94: IGmail94EmailApi;
  dongvanfb: IDongVanFBEmailApi;
  customdomain: ICustomDomainMailApi;
}

export interface PurchaseOptions {
  service?: string;
  accountType?: number | string;
  quality?: number | string;
}

export interface EmailPurchaseServiceDeps {
  nextId?: () => string;
  /** Current catch-all domain settings, read fresh so a Settings change applies. */
  customEmail?: () => CustomEmailSettingsDTO;
}

const FALLBACK_CUSTOM_EMAIL: CustomEmailSettingsDTO = {
  domain: 'oldevlk.com',
  apiBaseUrl: 'http://103.116.38.76:3000',
  senderFilter: 'capcut'
};

/**
 * Buys disposable mailboxes from the configured email vendor and reads
 * verification codes back. Every secret (mailbox password, OAuth2 refresh token,
 * the raw purchase line) is encrypted before it touches SQLite, and the DTOs
 * returned to the renderer carry booleans instead of secret material.
 */
export class EmailPurchaseService {
  private readonly nextId: () => string;
  private readonly secrets: SecretReader;
  private readonly customEmail: () => CustomEmailSettingsDTO;
  private readonly acquisitionTails = new Map<EmailSourceProvider, Promise<void>>();

  constructor(
    private readonly credRepo: CredentialRepository,
    private readonly purchasedRepo: PurchasedEmailRepository,
    private readonly vault: ICredentialVault,
    private readonly apis: EmailPurchaseApis,
    deps: EmailPurchaseServiceDeps = {}
  ) {
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
    this.secrets = new SecretReader(credRepo, vault);
    this.customEmail = deps.customEmail ?? (() => FALLBACK_CUSTOM_EMAIL);
  }

  private async exclusive<T>(
    provider: EmailSourceProvider,
    signal: AbortSignal,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.acquisitionTails.get(provider) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.acquisitionTails.set(provider, current);
    void current.then(() => {
      if (this.acquisitionTails.get(provider) === current) {
        this.acquisitionTails.delete(provider);
      }
    });
    try {
      await this.awaitTurn(previous.catch(() => undefined), signal);
      signal.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }

  private async awaitTurn(turn: Promise<void>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([turn, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      function cleanup(): void {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
      function onAbort(): void {
        cleanup();
        reject(signal.reason ?? new Error('Aborted'));
      }
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async createGmail94OrderWithRetry(
    token: string,
    service: string,
    signal: AbortSignal
  ): Promise<{ email: string; orderId: string }> {
    const delays = [0, 500, 1500];

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      signal.throwIfAborted();
      const delay = delays[attempt];
      if (delay > 0) {
        await this.wait(delay, signal);
      }
      signal.throwIfAborted();

      try {
        return await this.apis.gmail94.createOtpOrder(token, service);
      } catch (err: unknown) {
        const isTransient =
          err instanceof ProviderError &&
          (err.code === 'NETWORK_ERROR' || err.code === 'RATE_LIMITED');

        if (!isTransient) {
          throw err;
        }
      }
    }

    throw new AutomationTerminalError(
      'blocked',
      {
        code: 'PROVIDER_RETRY_EXHAUSTED',
        provider: 'gmail94',
        details: { attempts: delays.length }
      },
      'Gmail94 mua email vượt quá số lần thử lại.'
    );
  }

  private async preflightGmail94(
    initialConcurrency: number,
    signal: AbortSignal
  ): Promise<EmailCapacitySnapshot> {
    signal.throwIfAborted();
    const serviceSlug = CAPCUT_OTP_SERVICE;
    const token = this.readApiKey('gmail94');
    const [profile, services] = await Promise.all([
      this.apis.gmail94.getProfile(token),
      this.apis.gmail94.listServices()
    ]);
    signal.throwIfAborted();
    const service = services.find((entry) => entry.slug === serviceSlug);
    const balance = profile.balance;
    const unitPrice = service?.price;

    if (balance === null || !Number.isFinite(balance) || balance < 0) {
      throw new ProviderError('CONFIG_ERROR', 'Gmail94 không trả về số dư hợp lệ.', 'gmail94');
    }
    if (
      !service ||
      typeof unitPrice !== 'number' ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0
    ) {
      throw new ProviderError('CONFIG_ERROR', 'Không đọc được giá dịch vụ capcut từ Gmail94.', 'gmail94');
    }

    const reusableCount = this.purchasedRepo.countAvailable(
      'gmail94',
      CAPCUT_OTP_SERVICE
    );
    const affordablePurchaseCount = Math.floor(balance / unitPrice);
    const snapshot: EmailCapacitySnapshot = {
      provider: 'gmail94',
      service: 'capcut',
      balance,
      unitPrice,
      reusableCount,
      affordablePurchaseCount,
      totalAvailableCount: reusableCount + affordablePurchaseCount,
      checkedAt: new Date().toISOString()
    };

    if (snapshot.totalAvailableCount < initialConcurrency) {
      throw new AutomationTerminalError(
        'blocked',
        {
          code: 'INSUFFICIENT_FUNDS',
          provider: 'gmail94',
          details: {
            requestedWorkers: initialConcurrency,
            reusableCount,
            balance,
            unitPrice,
            affordablePurchaseCount,
            checkedAt: snapshot.checkedAt
          }
        },
        'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.'
      );
    }
    return snapshot;
  }

  async openAcquisitionSession(
    provider: EmailSourceProvider,
    initialConcurrency: number,
    options: PurchaseOptions = {},
    signal: AbortSignal
  ): Promise<EmailAcquisitionSession> {
    const capacity = provider === 'gmail94'
      ? await this.preflightGmail94(initialConcurrency, signal)
      : undefined;
    const gmailToken = provider === 'gmail94'
      ? this.readApiKey('gmail94')
      : null;
    const gmailServiceSlug = CAPCUT_OTP_SERVICE;
    const unitPrice = capacity?.unitPrice ?? 0;
    let remainingAffordablePurchases = capacity?.affordablePurchaseCount ?? 0;

    const acquireOne = async (workerId: string, workerSignal: AbortSignal): Promise<ReservedEmail> => {
      return this.exclusive(provider, workerSignal, async () => {
        const reservationId = workerId + ':' + this.nextId();

        if (provider === 'gmail94') {
          const reusable = this.purchasedRepo.reserveOldestAvailable(
            'gmail94',
            reservationId,
            gmailServiceSlug
          );
          if (reusable) return { purchasedEmail: reusable, reservationId };

          if (gmailToken === null) {
            throw new Error('Gmail94 acquisition session lost its credential.');
          }

          if (remainingAffordablePurchases <= 0) {
            workerSignal.throwIfAborted();
            const refreshedProfile = await this.apis.gmail94.getProfile(gmailToken);
            const refreshedBalance = refreshedProfile.balance;
            if (refreshedBalance === null || !Number.isFinite(refreshedBalance) || refreshedBalance < 0) {
              throw new ProviderError('CONFIG_ERROR', 'Gmail94 không trả về số dư hợp lệ.', 'gmail94');
            }
            const affordable = Math.floor(refreshedBalance / unitPrice);
            if (affordable <= 0) {
              throw new AutomationTerminalError(
                'blocked',
                {
                  code: 'INSUFFICIENT_FUNDS',
                  provider: 'gmail94',
                  details: {
                    balance: refreshedBalance,
                    unitPrice,
                    affordablePurchaseCount: 0,
                    checkedAt: new Date().toISOString()
                  }
                },
                'Số dư Gmail94 không đủ.'
              );
            }
            remainingAffordablePurchases = affordable;
          }

          workerSignal.throwIfAborted();
          let order: { email: string; orderId: string };
          try {
            order = await this.createGmail94OrderWithRetry(
              gmailToken,
              gmailServiceSlug,
              workerSignal
            );
          } catch (err: unknown) {
            if (err instanceof ProviderError && err.code === 'INSUFFICIENT_FUNDS') {
              const refreshedProfile = await this.apis.gmail94.getProfile(gmailToken).catch(() => null);
              const refreshedBalance = refreshedProfile?.balance ?? 0;
              const affordable = Math.floor(refreshedBalance / unitPrice);
              throw new AutomationTerminalError(
                'blocked',
                {
                  code: 'INSUFFICIENT_FUNDS',
                  provider: 'gmail94',
                  details: {
                    balance: refreshedBalance,
                    unitPrice,
                    affordablePurchaseCount: affordable
                  }
                },
                'Số dư Gmail94 không đủ.'
              );
            }
            throw err;
          }

          const purchasedEmail = this.purchasedRepo.insertReserved({
            id: this.nextId(),
            provider: 'gmail94',
            email: order.email,
            orderId: order.orderId,
            service: gmailServiceSlug
          }, reservationId);
          remainingAffordablePurchases -= 1;
          return { purchasedEmail, reservationId };
        }

        if (provider === 'dongvanfb') {
          const reusable = this.purchasedRepo.reserveOldestAvailable(
            'dongvanfb',
            reservationId
          );
          if (reusable) return { purchasedEmail: reusable, reservationId };

          workerSignal.throwIfAborted();
          const apiKey = this.readApiKey('dongvanfb');
          const accountType = options.accountType ?? DEFAULT_DONGVAN_ACCOUNT_TYPE;
          const quality = options.quality ?? DEFAULT_DONGVAN_QUALITY;

          const mails = await this.apis.dongvanfb.buyMail(apiKey, {
            accountType,
            quality,
            type: 'full'
          });
          const mail = mails[0];
          if (!mail) {
            throw new ProviderError('NETWORK_ERROR', 'DongVanFB không trả về tài khoản nào.', 'dongvanfb');
          }

          let refreshToken = mail.refreshToken;
          let clientId = mail.clientId;
          if ((!refreshToken || !clientId) && mail.password) {
            workerSignal.throwIfAborted();
            const pair = await this.apis.dongvanfb.getOauth2(apiKey, mail.email, mail.password);
            refreshToken = pair.refreshToken;
            clientId = pair.clientId;
          }

          const id = this.nextId();
          const purchasedEmail = this.purchasedRepo.insertReserved({
            id,
            provider: 'dongvanfb',
            email: mail.email,
            passwordEncrypted: mail.password ? this.vault.encrypt(mail.password) : null,
            refreshTokenEncrypted: refreshToken ? this.vault.encrypt(refreshToken) : null,
            clientId: clientId ?? null,
            rawPayloadEncrypted: this.vault.encrypt(
              [mail.email, mail.password ?? '', refreshToken ?? '', clientId ?? ''].join('|')
            )
          }, reservationId);

          return { purchasedEmail, reservationId };
        }

        if (provider === 'customdomain') {
          const reusable = this.purchasedRepo.reserveOldestAvailable(
            'customdomain',
            reservationId
          );
          if (reusable) return { purchasedEmail: reusable, reservationId };

          workerSignal.throwIfAborted();
          const settings = this.customEmail();
          const existing = new Set(
            this.purchasedRepo
              .listRecent(500)
              .filter((row) => row.provider === 'customdomain')
              .map((row) => row.email.split('@')[0])
          );

          const usernames = generateMailUsernames(1, existing);
          const username = usernames[0];
          if (!username) {
            throw new Error('Failed to generate username for custom domain email');
          }
          const email = buildCustomDomainAddress(username, settings.domain);
          const id = this.nextId();
          const purchasedEmail = this.purchasedRepo.insertReserved({
            id,
            provider: 'customdomain',
            email
          }, reservationId);

          return { purchasedEmail, reservationId };
        }

        throw new ProviderError('CONFIG_ERROR', `Unsupported email provider: ${provider}`);
      });
    };

    const commit = (reservation: ReservedEmail, accountId: string): void => {
      const consumed = this.purchasedRepo.consumeReserved(
        reservation.purchasedEmail.id,
        reservation.reservationId,
        accountId
      );
      if (!consumed) {
        throw new AutomationTerminalError(
          'failed',
          { code: 'INTERNAL_ERROR' },
          'Quyền sở hữu email đã mua không còn hợp lệ.'
        );
      }
    };

    const release = (reservation: ReservedEmail): void => {
      this.purchasedRepo.releaseReservation(
        reservation.purchasedEmail.id,
        reservation.reservationId
      );
    };

    return { capacity, acquireOne, commit, release };
  }

  private readApiKey(provider: EmailApiProvider): string {
    return this.secrets.readSimpleKey(provider);
  }

  getProviderConfigs(): EmailProviderConfigDTO[] {
    return EmailApiProviderEnum.options.map((provider) => {
      const record = this.credRepo.getCredential(provider);
      return {
        provider,
        isConfigured: record !== null,
        maskedHint: record?.metadata.maskedHint ?? '••••••••'
      };
    });
  }

  /**
   * Reads the verification code for a purchased mailbox.
   * Returns null while the code has not arrived so callers may poll.
   */
  async readOtp(purchasedEmailId: string, type: string = DEFAULT_OTP_SERVICE): Promise<string | null> {
    const secrets = this.purchasedRepo.getSecretsById(purchasedEmailId);
    if (!secrets) {
      throw new ProviderError('CONFIG_ERROR', 'Không tìm thấy email đã mua tương ứng.');
    }

    if (secrets.provider === 'customdomain') {
      const settings = this.customEmail();
      return this.apis.customdomain.readOtp(settings.apiBaseUrl, secrets.email, {
        senderContains: settings.senderFilter
      });
    }

    const apiKey = this.readApiKey(secrets.provider);

    if (secrets.provider === 'gmail94') {
      if (!secrets.orderId) {
        throw new ProviderError(
          'CONFIG_ERROR',
          'Email Gmail94 này không có order id nên không thể đọc OTP.',
          'gmail94'
        );
      }
      return this.apis.gmail94.readOtp(apiKey, secrets.orderId, secrets.service ?? type);
    }

    if (!secrets.refreshTokenEncrypted || !secrets.clientId) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Email DongVanFB này chưa có refresh token/client id nên không thể đọc mã.',
        'dongvanfb'
      );
    }

    const refreshToken = this.vault.decrypt(secrets.refreshTokenEncrypted);
    const params = { email: secrets.email, refreshToken, clientId: secrets.clientId, type };

    const viaOauth2 = await this.apis.dongvanfb.readCode('oauth2', params);
    if (viaOauth2) return viaOauth2.code;

    const viaGraph = await this.apis.dongvanfb.readCode('graph', params);
    return viaGraph ? viaGraph.code : null;
  }
}
