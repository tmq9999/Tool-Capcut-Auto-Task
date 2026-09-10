import crypto from 'node:crypto';
import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { PurchasedEmailRepository } from '../repositories/PurchasedEmailRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError, ConfirmedOutOfStockError } from '../providers/ProviderError';
import { SecretReader } from './SecretReader';
import type { Gmail94Profile, Gmail94Service } from '../providers/Gmail94Provider';
import { AutomationTerminalError } from './AutomationTerminalError';
import type { DongVanCodeResult, DongVanPurchasedMail } from '../providers/DongVanFBProvider';
import { buildCustomDomainAddress, generateMailUsernames } from './mailUsername';
import type { CustomEmailSettingsDTO } from '../../shared/schemas/settings.schema';
import type { ObservationIdentity, ObservationScope } from '../providers/ObservedHttpClient';
import type { AccountMutationPort } from '../repositories/AccountMutationRepository';
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

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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
  ownerRef?: string;
}

export interface AcquisitionIdentity {
  ownerRef: string;
  runId: string;
  stepAttemptId: string;
}

export interface DiagnosticMutationContext {
  repository: AccountMutationPort & {
    bindMailbox(ownerRef: string, mailboxRef: string): void;
    getOwnerByMailbox(mailboxRef: string): string | null;
    getBinding(ownerRef: string): { ownerRef: string; mailboxRef: string | null; accountId: string | null } | null;
  };
  authorityRef: string;
  budgetOwnerRef: string;
}

export interface BillablePurchaseStats {
  budget: number;
  attempted: number;
  confirmed: number;
  ambiguous: number;
}

export interface BillablePurchaseEvent {
  provider: 'gmail94' | 'dongvanfb';
  outcome: 'attempted' | 'confirmed' | 'ambiguous';
  stats: BillablePurchaseStats;
}

export interface EmailAcquisitionSession {
  readonly capacity?: EmailCapacitySnapshot;
  acquireOne(workerId: string, signal: AbortSignal, identity?: AcquisitionIdentity): Promise<ReservedEmail>;
  bindAccount?(reservation: ReservedEmail, accountId: string): void;
  commit(reservation: ReservedEmail, accountId: string): void;
  release(reservation: ReservedEmail): void;
  purchaseStats(): BillablePurchaseStats;
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
  maxBillablePurchases: number;
  onPurchaseEvent?: (event: BillablePurchaseEvent) => void;
  emailRetryIntervalMs?: number;
  onRetryWait?: (message: string) => void;
}

export interface EmailPurchaseServiceDeps {
  nextId?: () => string;
  /** Current catch-all domain settings, read fresh so a Settings change applies. */
  customEmail?: () => CustomEmailSettingsDTO;
  observation?: ObservationScope;
  mutationContext?: DiagnosticMutationContext;
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
  private readonly observation?: ObservationScope;
  private readonly mutationContext?: DiagnosticMutationContext;

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
    this.observation = deps.observation;
    this.mutationContext = deps.mutationContext;
  }

  private observe<T>(identity: Readonly<ObservationIdentity>, operation: () => Promise<T>): Promise<T> {
    return this.observation?.withObservationScope(identity, operation) ?? operation();
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

  private async preflightGmail94(
    initialConcurrency: number,
    signal: AbortSignal
  ): Promise<EmailCapacitySnapshot> {
    signal.throwIfAborted();
    const serviceSlug = CAPCUT_OTP_SERVICE;
    const token = this.readApiKey('gmail94');
    const [profile, services] = await Promise.all([
      this.observe({ provider: 'gmail94', operation: 'profile' }, () =>
        this.apis.gmail94.getProfile(token)),
      this.observe({ provider: 'gmail94', operation: 'service-list' }, () =>
        this.apis.gmail94.listServices())
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
    options: PurchaseOptions,
    signal: AbortSignal
  ): Promise<EmailAcquisitionSession> {
    const purchaseProvider = provider === 'gmail94' || provider === 'dongvanfb'
      ? provider
      : null;
    if (
      purchaseProvider !== null &&
      (!Number.isInteger(options.maxBillablePurchases) || options.maxBillablePurchases < 0)
    ) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Giới hạn mua email phải là số nguyên không âm.',
        purchaseProvider
      );
    }

    const capacity = provider === 'gmail94'
      ? await this.preflightGmail94(initialConcurrency, signal)
      : undefined;
    const gmailToken = provider === 'gmail94'
      ? this.readApiKey('gmail94')
      : null;
    const gmailServiceSlug = CAPCUT_OTP_SERVICE;
    const unitPrice = capacity?.unitPrice ?? 0;
    let remainingAffordablePurchases = capacity?.affordablePurchaseCount ?? 0;
    const stats: BillablePurchaseStats = {
      budget: purchaseProvider === null ? 0 : options.maxBillablePurchases,
      attempted: 0,
      confirmed: 0,
      ambiguous: 0
    };
    let purchaseAccountingFailure: AutomationTerminalError | null = null;

    const purchaseStats = (): BillablePurchaseStats => ({ ...stats });
    const emitPurchaseEvent = (outcome: BillablePurchaseEvent['outcome']): void => {
      if (purchaseProvider === null) return;
      options.onPurchaseEvent?.({
        provider: purchaseProvider,
        outcome,
        stats: purchaseStats()
      });
    };
    const poisonPurchaseAccounting = (): AutomationTerminalError => {
      purchaseAccountingFailure ??= new AutomationTerminalError(
        'failed',
        {
          code: 'INTERNAL_ERROR',
          provider: purchaseProvider ?? undefined
        },
        'Không thể ghi nhận sự kiện mua email; phiên mua đã dừng an toàn.'
      );
      return purchaseAccountingFailure;
    };
    const assertPurchaseBudget = (): void => {
      if (purchaseProvider === null || stats.attempted < stats.budget) return;
      throw new AutomationTerminalError(
        'blocked',
        {
          code: 'BILLABLE_PURCHASE_LIMIT_REACHED',
          provider: purchaseProvider,
          details: {
            budget: stats.budget,
            attempted: stats.attempted,
            confirmed: stats.confirmed,
            ambiguous: stats.ambiguous
          }
        },
        'Đã dùng hết giới hạn mua email của lượt chạy.'
      );
    };
    const beginPurchase = (): void => {
      assertPurchaseBudget();
      stats.attempted += 1;
      try {
        emitPurchaseEvent('attempted');
      } catch {
        stats.attempted -= 1;
        throw poisonPurchaseAccounting();
      }
    };
    const rollbackAttempt = (): void => {
      if (stats.attempted > 0) {
        stats.attempted -= 1;
      }
    };
    const ambiguousPurchase = (): AutomationTerminalError => {
      stats.ambiguous += 1;
      try {
        emitPurchaseEvent('ambiguous');
      } catch {
        return poisonPurchaseAccounting();
      }
      return new AutomationTerminalError(
        'blocked',
        {
          code: 'PURCHASE_OUTCOME_UNKNOWN',
          provider: purchaseProvider ?? undefined,
          details: { attempts: 1 }
        },
        'Không xác định được kết quả mua email; đã dừng để tránh mua trùng.'
      );
    };
    const isDefinitiveProviderFailure = (error: unknown): error is ProviderError => {
      return error instanceof ProviderError && (
        error.code === 'AUTH_ERROR' ||
        error.code === 'CONFIG_ERROR' ||
        error.code === 'PROVIDER_NOT_IMPLEMENTED'
      );
    };

    const acquireOne = async (workerId: string, workerSignal: AbortSignal, providedIdentity?: AcquisitionIdentity): Promise<ReservedEmail> => {
      return this.exclusive(provider, workerSignal, async () => {
        if (purchaseAccountingFailure) throw purchaseAccountingFailure;
        const reservationId = workerId + ':' + this.nextId();
        const mutationIdentity = this.mutationContext
          ? (providedIdentity ?? (() => { throw new AutomationTerminalError(
              'blocked', { code: 'PROVIDER_CONFIG_ERROR' },
              'Thiếu identity bền vững cho fence mua email.'
            ); })())
          : undefined;
        const isFenced = Boolean(mutationIdentity && this.mutationContext);
        let currentAttemptId = mutationIdentity?.stepAttemptId;
        const recordPurchaseIntent = (): void => {
          if (!mutationIdentity || !this.mutationContext || !currentAttemptId) return;
          this.mutationContext.repository.recordIntent({
            authorityRef: this.mutationContext.authorityRef,
            budgetOwnerRef: this.mutationContext.budgetOwnerRef,
            ownerRef: mutationIdentity.ownerRef,
            accountId: null,
            runId: mutationIdentity.runId,
            sessionAlias: null,
            stepAttemptId: currentAttemptId,
            stepId: 'email-purchase',
            taskKey: null,
            operation: 'purchase',
            operationKey: `purchase:${mutationIdentity.ownerRef}:${currentAttemptId}`,
            intentAt: new Date().toISOString(),
            state: 'outcome-unknown',
            evidenceRef: null
          }, 1);
        };
        const settlePurchase = (purchasedEmailId: string): void => {
          if (!mutationIdentity || !this.mutationContext || !currentAttemptId) return;
          this.mutationContext.repository.bindMailbox(mutationIdentity.ownerRef, purchasedEmailId);
          this.mutationContext.repository.settleIntent(
            mutationIdentity.ownerRef,
            currentAttemptId,
            'effect-confirmed',
            `purchase:${purchasedEmailId}`
          );
        };

        if (provider === 'gmail94') {
          const reusable = this.purchasedRepo.reserveOldestAvailable(
            'gmail94',
            reservationId,
            gmailServiceSlug
          );
          if (reusable) {
            try {
              const originalOwner = this.mutationContext && mutationIdentity
                ? this.mutationContext.repository.getOwnerByMailbox(reusable.id)
                : null;
              if (this.mutationContext && mutationIdentity) {
                this.mutationContext.repository.assertNoUnknown({
                  authorityRef: this.mutationContext.authorityRef,
                  budgetOwnerRef: this.mutationContext.budgetOwnerRef,
                  ownerRef: originalOwner ?? mutationIdentity.ownerRef,
                  mailboxRef: reusable.id,
                  operation: 'purchase'
                });
                if (originalOwner) {
                  const binding = this.mutationContext.repository.getBinding(originalOwner);
                  if (binding?.accountId) {
                    throw new AutomationTerminalError(
                      'blocked',
                      {
                        code: 'PROVIDER_CONFIG_ERROR',
                        details: { accountId: binding.accountId }
                      },
                      `Mailbox đã được liên kết với account ${binding.accountId}. Vui lòng kiểm tra lại.`
                    );
                  }
                }
              }
              return {
                purchasedEmail: reusable,
                reservationId,
                ...((originalOwner || mutationIdentity) ? { ownerRef: originalOwner ?? mutationIdentity!.ownerRef } : {})
              };
            } catch (err) {
              this.purchasedRepo.releaseReservation(reusable.id, reservationId);
              throw err;
            }
          }

          if (gmailToken === null) {
            throw new Error('Gmail94 acquisition session lost its credential.');
          }

          assertPurchaseBudget();
          if (remainingAffordablePurchases <= 0) {
            workerSignal.throwIfAborted();
            const refreshedProfile = await this.observe(
              { provider: 'gmail94', operation: 'profile' },
              () => this.apis.gmail94.getProfile(gmailToken)
            );
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

          const retryIntervalMs = options.emailRetryIntervalMs ?? 15_000;
          let retryCount = 0;
          let order: { email: string; orderId: string };

          while (true) {
            workerSignal.throwIfAborted();
            assertPurchaseBudget();
            recordPurchaseIntent();
            beginPurchase();

            try {
              order = await this.observe(
                { provider: 'gmail94', operation: 'mailbox-purchase' },
                () => this.apis.gmail94.createOtpOrder(gmailToken, gmailServiceSlug)
              );
              break;
            } catch (err: unknown) {
              if (err instanceof ProviderError && err.code === 'INSUFFICIENT_FUNDS') {
                const refreshedProfile = await this.observe(
                  { provider: 'gmail94', operation: 'profile' },
                  () => this.apis.gmail94.getProfile(gmailToken)
                ).catch(() => null);
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

              if (err instanceof ProviderError && err.code === 'OUT_OF_STOCK') {
                if (isFenced) {
                  if (!(err instanceof ConfirmedOutOfStockError)) {
                    throw ambiguousPurchase();
                  }
                  this.mutationContext!.repository.settleIntent(
                    mutationIdentity!.ownerRef,
                    currentAttemptId!,
                    'no-effect-confirmed',
                    'stock-exhausted'
                  );
                  currentAttemptId = this.nextId();
                }
                rollbackAttempt();
                retryCount += 1;
                const retrySeconds = Math.round(retryIntervalMs / 1000);
                const retryMsg = `Kho email Gmail94 tạm hết. Đang chờ nạp lại sau ${retrySeconds}s (lần ${retryCount})...`;
                options.onRetryWait?.(retryMsg);
                await abortableDelay(retryIntervalMs, workerSignal);
                continue;
              }

              if (isDefinitiveProviderFailure(err)) throw err;
              throw ambiguousPurchase();
            }
          }
          if (
            typeof order?.email !== 'string' || order.email.length === 0 ||
            typeof order.orderId !== 'string' || order.orderId.length === 0
          ) {
            throw ambiguousPurchase();
          }

          remainingAffordablePurchases -= 1;
          stats.confirmed += 1;
          const purchasedEmail = this.purchasedRepo.insertReserved({
            id: this.nextId(),
            provider: 'gmail94',
            email: order.email,
            orderId: order.orderId,
            service: gmailServiceSlug
          }, reservationId);
          try {
            settlePurchase(purchasedEmail.id);
            try {
              emitPurchaseEvent('confirmed');
            } catch (error) {
              poisonPurchaseAccounting();
              throw error;
            }
            workerSignal.throwIfAborted();
            return { purchasedEmail, reservationId, ...(mutationIdentity ? { ownerRef: mutationIdentity.ownerRef } : {}) };
          } catch (error) {
            try {
              this.purchasedRepo.releaseReservation(purchasedEmail.id, reservationId);
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                'Paid mailbox delivery and reservation cleanup both failed.'
              );
            }
            throw error;
          }
        }

        if (provider === 'dongvanfb') {
          const reusable = this.purchasedRepo.reserveOldestAvailable(
            'dongvanfb',
            reservationId
          );
          if (reusable) {
            try {
              const originalOwner = this.mutationContext && mutationIdentity
                ? this.mutationContext.repository.getOwnerByMailbox(reusable.id)
                : null;
              if (this.mutationContext && mutationIdentity) {
                this.mutationContext.repository.assertNoUnknown({
                  authorityRef: this.mutationContext.authorityRef,
                  budgetOwnerRef: this.mutationContext.budgetOwnerRef,
                  ownerRef: originalOwner ?? mutationIdentity.ownerRef,
                  mailboxRef: reusable.id,
                  operation: 'purchase'
                });
                if (originalOwner) {
                  const binding = this.mutationContext.repository.getBinding(originalOwner);
                  if (binding?.accountId) {
                    throw new AutomationTerminalError(
                      'blocked',
                      {
                        code: 'PROVIDER_CONFIG_ERROR',
                        details: { accountId: binding.accountId }
                      },
                      `Mailbox đã được liên kết với account ${binding.accountId}. Vui lòng kiểm tra lại.`
                    );
                  }
                }
              }

              let deliveryEmail = reusable;
              if (!reusable.hasOauth) {
                const secrets = this.purchasedRepo.getSecretsById(reusable.id);
                if (secrets?.passwordEncrypted) {
                  const password = this.vault.decrypt(secrets.passwordEncrypted);
                  const apiKey = this.readApiKey('dongvanfb');
                  workerSignal.throwIfAborted();
                  const pair = await this.observe(
                    { provider: 'dongvanfb', operation: 'oauth-exchange' },
                    () => this.apis.dongvanfb.getOauth2(apiKey, reusable.email, password)
                  );
                  workerSignal.throwIfAborted();
                  const updated = this.purchasedRepo.updateReservedOauth(
                    reusable.id,
                    reservationId,
                    this.vault.encrypt(pair.refreshToken),
                    pair.clientId
                  );
                  if (!updated) {
                    throw new AutomationTerminalError(
                      'failed',
                      { code: 'INTERNAL_ERROR' },
                      'Quyền sở hữu mailbox đã thay đổi; chưa cấp mailbox cho worker.'
                    );
                  }
                  deliveryEmail = this.purchasedRepo.getDtoById(reusable.id) ?? { ...reusable, hasOauth: true };
                }
              }

              return {
                purchasedEmail: deliveryEmail,
                reservationId,
                ...((originalOwner || mutationIdentity) ? { ownerRef: originalOwner ?? mutationIdentity!.ownerRef } : {})
              };
            } catch (err) {
              this.purchasedRepo.releaseReservation(reusable.id, reservationId);
              throw err;
            }
          }

          workerSignal.throwIfAborted();
          const apiKey = this.readApiKey('dongvanfb');
          const accountType = options.accountType ?? DEFAULT_DONGVAN_ACCOUNT_TYPE;
          const quality = options.quality ?? DEFAULT_DONGVAN_QUALITY;

          const retryIntervalMs = options.emailRetryIntervalMs ?? 15_000;
          let retryCount = 0;
          let mails: DongVanPurchasedMail[];

          while (true) {
            workerSignal.throwIfAborted();
            assertPurchaseBudget();
            recordPurchaseIntent();
            beginPurchase();

            try {
              mails = await this.observe(
                { provider: 'dongvanfb', operation: 'mailbox-purchase' },
                () => this.apis.dongvanfb.buyMail(apiKey, {
                  accountType,
                  quality,
                  type: 'full'
                })
              );
              break;
            } catch (err: unknown) {
              if (err instanceof ProviderError && err.code === 'INSUFFICIENT_FUNDS') {
                throw new AutomationTerminalError(
                  'blocked',
                  {
                    code: 'INSUFFICIENT_FUNDS',
                    provider: 'dongvanfb'
                  },
                  'Số dư DongVanFB không đủ.'
                );
              }

              if (err instanceof ProviderError && err.code === 'OUT_OF_STOCK') {
                if (isFenced) {
                  if (!(err instanceof ConfirmedOutOfStockError)) {
                    throw ambiguousPurchase();
                  }
                  this.mutationContext!.repository.settleIntent(
                    mutationIdentity!.ownerRef,
                    currentAttemptId!,
                    'no-effect-confirmed',
                    'stock-exhausted'
                  );
                  currentAttemptId = this.nextId();
                }
                rollbackAttempt();
                retryCount += 1;
                const retrySeconds = Math.round(retryIntervalMs / 1000);
                const retryMsg = `Kho email DongVanFB tạm hết. Đang chờ nạp lại sau ${retrySeconds}s (lần ${retryCount})...`;
                options.onRetryWait?.(retryMsg);
                await abortableDelay(retryIntervalMs, workerSignal);
                continue;
              }

              if (
                err instanceof ProviderError &&
                (err.code === 'AUTH_ERROR' || err.code === 'PROVIDER_NOT_IMPLEMENTED')
              ) {
                throw err;
              }
              throw ambiguousPurchase();
            }
          }
          const mail = mails[0];
          if (!mail || typeof mail.email !== 'string' || mail.email.length === 0) {
            throw ambiguousPurchase();
          }

          stats.confirmed += 1;
          const id = this.nextId();
          let purchasedEmail = this.purchasedRepo.insertReserved({
            id,
            provider: 'dongvanfb',
            email: mail.email,
            passwordEncrypted: mail.password ? this.vault.encrypt(mail.password) : null,
            refreshTokenEncrypted: mail.refreshToken ? this.vault.encrypt(mail.refreshToken) : null,
            clientId: mail.clientId ?? null,
            rawPayloadEncrypted: this.vault.encrypt(
              [mail.email, mail.password ?? '', mail.refreshToken ?? '', mail.clientId ?? ''].join('|')
            )
          }, reservationId);
          try {
            settlePurchase(purchasedEmail.id);
            try {
              emitPurchaseEvent('confirmed');
            } catch (error) {
              poisonPurchaseAccounting();
              throw error;
            }

            if ((!mail.refreshToken || !mail.clientId) && mail.password) {
              workerSignal.throwIfAborted();
              const pair = await this.observe(
                { provider: 'dongvanfb', operation: 'oauth-exchange' },
                () => this.apis.dongvanfb.getOauth2(apiKey, mail.email, mail.password!)
              );
              workerSignal.throwIfAborted();
              const updated = this.purchasedRepo.updateReservedOauth(
                id,
                reservationId,
                this.vault.encrypt(pair.refreshToken),
                pair.clientId
              );
              if (!updated) {
                throw new AutomationTerminalError(
                  'failed',
                  { code: 'INTERNAL_ERROR' },
                  'Quyền sở hữu mailbox đã thay đổi; chưa cấp mailbox cho worker.'
                );
              }
              purchasedEmail = this.purchasedRepo.getDtoById(id) ?? { ...purchasedEmail, hasOauth: true };
            }

            workerSignal.throwIfAborted();
            return { purchasedEmail, reservationId, ...(mutationIdentity ? { ownerRef: mutationIdentity.ownerRef } : {}) };
          } catch (error) {
            try {
              this.purchasedRepo.releaseReservation(purchasedEmail.id, reservationId);
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                'Paid mailbox delivery and reservation cleanup both failed.'
              );
            }
            throw error;
          }
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

    const bindAccount = (reservation: ReservedEmail, accountId: string): void => {
      if (reservation.ownerRef && this.mutationContext) {
        this.mutationContext.repository.bindAccount(reservation.ownerRef, accountId);
      }
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

    return { capacity, acquireOne, bindAccount, commit, release, purchaseStats };
  }

  private readApiKey(provider: EmailApiProvider): string {
    return this.secrets.readSimpleKey(provider);
  }

  getProviderConfigs(): EmailProviderConfigDTO[] {
    return EmailApiProviderEnum.options.map((provider) => {
      const record = this.credRepo.getCredential(provider);
      const isConfigured = record !== null;
      let apiKey: string | null = null;
      if (isConfigured) {
        try {
          apiKey = this.readApiKey(provider);
        } catch {
          apiKey = null;
        }
      }
      return {
        provider,
        isConfigured,
        maskedHint: record?.metadata.maskedHint ?? '••••••••',
        apiKey
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
      return this.observe({ provider: 'customdomain', operation: 'read-otp' }, () =>
        this.apis.customdomain.readOtp(settings.apiBaseUrl, secrets.email, {
          senderContains: settings.senderFilter
        }));
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
      return this.observe({ provider: 'gmail94', operation: 'read-otp' }, () =>
        this.apis.gmail94.readOtp(apiKey, secrets.orderId!, secrets.service ?? type));
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

    const viaOauth2 = await this.observe({ provider: 'dongvanfb', operation: 'read-otp' }, () =>
      this.apis.dongvanfb.readCode('oauth2', params));
    if (viaOauth2) return viaOauth2.code;

    const viaGraph = await this.observe({ provider: 'dongvanfb', operation: 'read-otp' }, () =>
      this.apis.dongvanfb.readCode('graph', params));
    return viaGraph ? viaGraph.code : null;
  }
}
