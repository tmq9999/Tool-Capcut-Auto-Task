import crypto from 'node:crypto';
import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { PurchasedEmailRepository } from '../repositories/PurchasedEmailRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError } from '../providers/ProviderError';
import { SecretReader } from './SecretReader';
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

/** The slice of Gmail94Provider used to rent mailboxes and read codes. */
export interface IGmail94EmailApi {
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

export interface EmailPurchaseResult {
  purchased: PurchasedEmailDTO[];
  failures: string[];
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

  private async purchaseGmail94(
    apiKey: string,
    count: number,
    options: PurchaseOptions
  ): Promise<EmailPurchaseResult> {
    const serviceSlug = options.service ?? DEFAULT_OTP_SERVICE;
    const ids: string[] = [];
    const failures: string[] = [];

    for (let index = 0; index < count; index += 1) {
      try {
        const order = await this.apis.gmail94.createOtpOrder(apiKey, serviceSlug);
        const id = this.nextId();
        this.purchasedRepo.insert({
          id,
          provider: 'gmail94',
          email: order.email,
          orderId: order.orderId,
          service: serviceSlug
        });
        ids.push(id);
      } catch (err: unknown) {
        failures.push(err instanceof Error ? err.message : 'Mua email thất bại.');
      }
    }

    return { purchased: this.loadDtos(ids), failures };
  }

  private async purchaseDongVanFB(
    apiKey: string,
    count: number,
    options: PurchaseOptions
  ): Promise<EmailPurchaseResult> {
    const accountType = options.accountType ?? DEFAULT_DONGVAN_ACCOUNT_TYPE;
    const quality = options.quality ?? DEFAULT_DONGVAN_QUALITY;
    const ids: string[] = [];
    const failures: string[] = [];

    for (let index = 0; index < count; index += 1) {
      try {
        const mails = await this.apis.dongvanfb.buyMail(apiKey, {
          accountType,
          quality,
          type: 'full'
        });
        const mail = mails[0];
        if (!mail) {
          failures.push('DongVanFB không trả về tài khoản nào.');
          continue;
        }

        let refreshToken = mail.refreshToken;
        let clientId = mail.clientId;
        if ((!refreshToken || !clientId) && mail.password) {
          const pair = await this.apis.dongvanfb.getOauth2(apiKey, mail.email, mail.password);
          refreshToken = pair.refreshToken;
          clientId = pair.clientId;
        }

        const id = this.nextId();
        this.purchasedRepo.insert({
          id,
          provider: 'dongvanfb',
          email: mail.email,
          passwordEncrypted: mail.password ? this.vault.encrypt(mail.password) : null,
          refreshTokenEncrypted: refreshToken ? this.vault.encrypt(refreshToken) : null,
          clientId: clientId ?? null,
          rawPayloadEncrypted: this.vault.encrypt(
            [mail.email, mail.password ?? '', refreshToken ?? '', clientId ?? ''].join('|')
          )
        });
        ids.push(id);
      } catch (err: unknown) {
        failures.push(err instanceof Error ? err.message : 'Mua email thất bại.');
      }
    }

    return { purchased: this.loadDtos(ids), failures };
  }

  /**
   * Generates mailboxes on the operator's catch-all domain. Nothing is bought and
   * nothing is charged; the addresses simply have to be unique.
   */
  private purchaseCustomDomain(count: number): EmailPurchaseResult {
    const settings = this.customEmail();
    const existing = new Set(
      this.purchasedRepo
        .listRecent(500)
        .filter((row) => row.provider === 'customdomain')
        .map((row) => row.email.split('@')[0])
    );

    const ids: string[] = [];
    const failures: string[] = [];

    for (const username of generateMailUsernames(count, existing)) {
      const email = buildCustomDomainAddress(username, settings.domain);
      const id = this.nextId();
      try {
        this.purchasedRepo.insert({ id, provider: 'customdomain', email });
        ids.push(id);
      } catch (err: unknown) {
        failures.push(err instanceof Error ? err.message : 'Không tạo được địa chỉ mail.');
      }
    }

    return { purchased: this.loadDtos(ids), failures };
  }

  private loadDtos(ids: string[]): PurchasedEmailDTO[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    const rows = this.purchasedRepo.listRecent(Math.max(ids.length * 4, 20));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row && wanted.has(id) ? [row] : [];
    });
  }

  /** Buys exactly `count` mailboxes, one API call per mailbox. */
  async purchase(
    provider: EmailSourceProvider,
    count: number,
    options: PurchaseOptions = {}
  ): Promise<EmailPurchaseResult> {
    if (count <= 0) {
      return { purchased: [], failures: [] };
    }

    // The catch-all domain needs no API key: addresses are generated locally.
    if (provider === 'customdomain') {
      return this.purchaseCustomDomain(count);
    }

    /**
     * Hộp thư đã thuê mà chưa tiêu là TIỀN ĐÃ TRẢ, và `order_id` của nó vẫn còn
     * trong `purchased_emails` nên vẫn đọc được OTP. Lượt 04/09/2026 thuê
     * `songhajun652@gmail.com` rồi `xcli profile-quick` lỗi vì launcher
     * Multilogin đã tắt — không dùng lại thì mỗi lỗi hạ tầng là một lần mất tiền.
     */
    const reuse = this.purchasedRepo.listUnconsumed(provider, count);
    if (reuse.length >= count) {
      return { purchased: reuse.slice(0, count), failures: [] };
    }

    const apiKey = this.readApiKey(provider);
    const missing = count - reuse.length;
    const bought = provider === 'gmail94'
      ? await this.purchaseGmail94(apiKey, missing, options)
      : await this.purchaseDongVanFB(apiKey, missing, options);

    return { purchased: [...reuse, ...bought.purchased], failures: bought.failures };
  }

  /** Đưa hộp thư chưa dùng tới trở lại hàng chờ (xem `PurchasedEmailRepository.release`). */
  release(purchasedEmailId: string): void {
    this.purchasedRepo.release(purchasedEmailId);
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

  markConsumed(purchasedEmailId: string, accountId: string | null): void {
    this.purchasedRepo.markConsumed(purchasedEmailId, accountId);
  }
}
