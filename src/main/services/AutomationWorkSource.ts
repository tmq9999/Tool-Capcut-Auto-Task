import { z } from 'zod';
import type {
  AutomationRunConfigDTO
} from '../../shared/schemas/automation.schema';
import type {
  PastedCapcutCredential
} from '../../shared/schemas/pasted-capcut.schema';
import {
  normalizePastedCapcutEntries,
  formatPastedCapcutIssues
} from '../../shared/schemas/pasted-capcut.schema';
import type { EmailSourceProvider } from '../../shared/schemas/provider.schema';
import { ProviderError } from '../providers/ProviderError';
import type { ObservationScope } from '../providers/ObservedHttpClient';
import type {
  EmailAcquisitionSession,
  EmailCapacitySnapshot,
  EmailPurchaseService,
  AcquisitionIdentity,
  DiagnosticMutationContext,
  BillablePurchaseEvent,
  BillablePurchaseStats,
  ReservedEmail
} from './EmailPurchaseService';

export type WorkSourceKind = 'finite' | 'continuous';

export interface PastedExistingWorkItem {
  kind: 'pasted-existing';
  sourceId: string;
  email: string;
  emailProvider: 'manual';
  capcutPassword: string;
  line: number;
}

export type AutomationWorkItem =
  | {
      kind: 'new';
      sourceId: string;
      email: string;
      emailProvider: string;
      emailPassword?: string;
      purchasedEmailId?: string;
      reservationId?: string;
      ownerRef?: string;
    }
  | {
      kind: 'existing';
      sourceId: string;
      accountId: string;
      email: string;
      emailProvider: string;
      capcutPassword: string;
    }
  | PastedExistingWorkItem;

export interface SourceReadiness {
  workerTarget: number;
  capacity?: EmailCapacitySnapshot;
}

export interface AutomationWorkSource {
  readonly kind: WorkSourceKind;
  prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness>;
  next(workerId: string, signal: AbortSignal, identity?: AcquisitionIdentity): Promise<AutomationWorkItem | null>;
  commit(item: AutomationWorkItem, accountId: string): void;
  bind?(item: AutomationWorkItem, accountId: string): void;
  release(item: AutomationWorkItem): void;
  purchaseStats(): BillablePurchaseStats;
  isExhausted?(): boolean;
}

export interface AutomationWorkSourceFactory {
  create(
    config: AutomationRunConfigDTO,
    runId: string,
    onPurchaseEvent?: (event: BillablePurchaseEvent) => void,
    mutationContext?: DiagnosticMutationContext,
    onRetryWait?: (message: string) => void
  ): AutomationWorkSource;
}

function noPurchases(): BillablePurchaseStats {
  return { budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 };
}

export type AutomationCredentialReader = (accountId: string) => {
  accountId: string;
  email: string;
  emailProvider: string;
  capcutPassword: string;
} | null;

class ExistingAccountWorkSource implements AutomationWorkSource {
  readonly kind = 'finite' as const;
  private queue: AutomationWorkItem[] = [];

  constructor(
    private readonly accountIds: readonly string[],
    private readonly credentialReader?: AutomationCredentialReader
  ) {}

  async prepare(initialConcurrency: number): Promise<SourceReadiness> {
    if (this.accountIds.length === 0) {
      throw new ProviderError('CONFIG_ERROR', 'Danh sách accountIds không được để trống.');
    }
    const uniqueIds = new Set(this.accountIds);
    if (uniqueIds.size !== this.accountIds.length) {
      throw new ProviderError('CONFIG_ERROR', 'Danh sách accountIds có tài khoản trùng lặp.');
    }
    if (!this.credentialReader) {
      throw new ProviderError('CONFIG_ERROR', 'Không có credentialReader để nạp tài khoản có sẵn.');
    }

    this.queue = [];
    for (const id of this.accountIds) {
      const cred = this.credentialReader(id);
      if (!cred || !cred.capcutPassword) {
        throw new ProviderError(
          'CONFIG_ERROR',
          `Tài khoản ${id} không tồn tại hoặc chưa có mật khẩu CapCut được lưu.`
        );
      }
      this.queue.push({
        kind: 'existing',
        sourceId: `existing:${cred.accountId}`,
        accountId: cred.accountId,
        email: cred.email,
        emailProvider: cred.emailProvider,
        capcutPassword: cred.capcutPassword
      });
    }

    const workerTarget = Math.max(1, Math.min(initialConcurrency, this.queue.length));
    return { workerTarget };
  }

  async next(): Promise<AutomationWorkItem | null> {
    return this.queue.shift() ?? null;
  }

  commit(): void {}
  release(): void {}

  purchaseStats(): BillablePurchaseStats { return noPurchases(); }

  isExhausted(): boolean {
    return this.queue.length === 0;
  }
}

class ManualWorkSource implements AutomationWorkSource {
  readonly kind = 'finite' as const;
  private queue: AutomationWorkItem[] = [];

  constructor(private readonly entries: string[], private readonly limit = 0) {}

  async prepare(initialConcurrency: number): Promise<SourceReadiness> {
    const invalid: number[] = [];
    this.queue = this.entries.flatMap((raw, index) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return [];
      const [emailPart, passwordPart] = trimmed.split('|').map((part) => part.trim());
      if (!z.string().email().safeParse(emailPart).success) {
        invalid.push(index + 1);
        return [];
      }
      return [{
        kind: 'new',
        sourceId: 'manual:' + (index + 1),
        email: emailPart,
        emailProvider: 'manual',
        emailPassword: passwordPart || undefined
      }];
    });

    if (invalid.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Email thủ công không hợp lệ ở dòng: ' + invalid.join(', ') + '.'
      );
    }
    if (this.queue.length === 0) {
      throw new ProviderError('CONFIG_ERROR', 'Danh sách email thủ công đang trống.');
    }
    if (this.limit > 0) this.queue = this.queue.slice(0, this.limit);
    return { workerTarget: Math.min(initialConcurrency, this.queue.length) };
  }

  async next(): Promise<AutomationWorkItem | null> {
    return this.queue.shift() ?? null;
  }

  commit(): void {}
  release(): void {}

  purchaseStats(): BillablePurchaseStats { return noPurchases(); }
}

class PastedExistingWorkSource implements AutomationWorkSource {
  readonly kind = 'finite' as const;
  private queue: PastedExistingWorkItem[] = [];

  constructor(
    private readonly entries: PastedCapcutCredential[],
    private readonly limit = 0
  ) {}

  async prepare(initialConcurrency: number, _signal?: AbortSignal): Promise<SourceReadiness> {
    const normalized = normalizePastedCapcutEntries(this.entries);
    if (normalized.issues.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        formatPastedCapcutIssues(normalized.issues)
      );
    }
    if (normalized.entries.length === 0) {
      throw new ProviderError('CONFIG_ERROR', 'Danh sách email thủ công đang trống.');
    }

    this.queue = normalized.entries.map((entry) => ({
      kind: 'pasted-existing',
      sourceId: 'pasted:' + entry.line,
      email: entry.email,
      emailProvider: 'manual',
      capcutPassword: entry.capcutPassword,
      line: entry.line
    }));

    if (this.limit > 0) {
      this.queue = this.queue.slice(0, this.limit);
    }

    return { workerTarget: Math.min(initialConcurrency, this.queue.length) };
  }

  async next(_workerId: string, signal?: AbortSignal): Promise<AutomationWorkItem | null> {
    if (signal?.aborted) return null;
    return this.queue.shift() ?? null;
  }

  commit(): void {}
  release(): void {}

  purchaseStats(): BillablePurchaseStats {
    return noPurchases();
  }

  isExhausted(): boolean {
    return this.queue.length === 0;
  }
}

class ContinuousEmailWorkSource implements AutomationWorkSource {
  readonly kind = 'continuous' as const;
  private session: EmailAcquisitionSession | null = null;
  private readonly reservations = new Map<string, ReservedEmail>();
  private acquired = 0;

  constructor(
    private readonly emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>,
    private readonly provider: EmailSourceProvider,
    private readonly service: string | undefined,
    private readonly runId: string,
    private readonly limit: number,
    private readonly budget: number,
    private readonly onPurchaseEvent?: (event: BillablePurchaseEvent) => void,
    private readonly observation?: ObservationScope,
    private readonly mutationContext?: DiagnosticMutationContext,
    private readonly emailRetryIntervalMs?: number,
    private readonly onRetryWait?: (message: string) => void
  ) {}

  async prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness> {
    const workerTarget = this.limit > 0 ? Math.min(initialConcurrency, this.limit) : initialConcurrency;
    this.session = await this.emailService.openAcquisitionSession(
      this.provider,
      workerTarget,
      {
        service: this.service,
        maxBillablePurchases: this.budget,
        onPurchaseEvent: this.onPurchaseEvent,
        emailRetryIntervalMs: this.emailRetryIntervalMs,
        onRetryWait: this.onRetryWait
      },
      signal
    );
    return {
      workerTarget,
      capacity: this.session.capacity
    };
  }

  async next(workerId: string, signal: AbortSignal, providedIdentity?: AcquisitionIdentity): Promise<AutomationWorkItem | null> {
    signal.throwIfAborted();
    if (!this.session) throw new Error('Continuous source was not prepared.');
    if (this.limit > 0 && this.acquired >= this.limit) return null;
    // Reserve synchronously, including in-flight attempts. Never refill a failed
    // or released slot: its purchase may already have reached the provider.
    this.acquired += 1;
    const identity: AcquisitionIdentity = providedIdentity ?? {
      runId: this.runId,
      ownerRef: `${this.runId}:${workerId}:${this.acquired}`,
      stepAttemptId: `${this.runId}:${workerId}:${this.acquired}`
    };
    const observationIdentity = {
      runId: this.runId,
      workerAlias: workerId,
      acquisitionAlias: identity.ownerRef,
      accountAlias: 'unassigned',
      sessionAlias: 'unassigned',
      authorityRef: this.mutationContext?.authorityRef ?? 'email:' + this.provider
    } as const;
    const acquire = () => this.session!.acquireOne(this.runId + ':' + workerId, signal, identity);
    const reservation = this.observation
      ? await this.observation.withObservationScope(observationIdentity, acquire)
      : await acquire();
    this.reservations.set(reservation.reservationId, reservation);
    return {
      kind: 'new',
      sourceId: reservation.reservationId,
      email: reservation.purchasedEmail.email,
      emailProvider: reservation.purchasedEmail.provider,
      purchasedEmailId: reservation.purchasedEmail.id,
      reservationId: reservation.reservationId,
      ownerRef: reservation.ownerRef
    };
  }

  isExhausted(): boolean {
    return this.limit > 0 && this.acquired >= this.limit;
  }

  purchaseStats(): BillablePurchaseStats {
    if (!this.session) return { ...noPurchases(), budget: this.budget };
    return { ...this.session.purchaseStats() };
  }

  commit(item: AutomationWorkItem, accountId: string): void {
    if (item.kind !== 'new' || !item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) throw new Error('Email reservation ownership was lost.');
    this.session.commit(reservation, accountId);
    this.reservations.delete(item.reservationId);
  }

  bind(item: AutomationWorkItem, accountId: string): void {
    if (item.kind !== 'new' || !this.session) return;
    const reservation = item.reservationId ? this.reservations.get(item.reservationId) : undefined;
    if (!reservation) throw new Error('Email reservation ownership was lost.');
    this.session.bindAccount?.(reservation, accountId);
  }

  release(item: AutomationWorkItem): void {
    if (item.kind !== 'new' || !item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) return;
    this.session.release(reservation);
    this.reservations.delete(item.reservationId);
  }
}

export function createAutomationWorkSourceFactory(
  emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>,
  credentialReader?: AutomationCredentialReader,
  observation?: ObservationScope
): AutomationWorkSourceFactory {
  return {
    create(config, runId, onPurchaseEvent, mutationContext, onRetryWait) {
      if (config.emailSource.mode === 'existing') {
        return new ExistingAccountWorkSource(config.emailSource.accountIds, credentialReader);
      }
      if (config.emailSource.mode === 'manual') {
        return new ManualWorkSource(config.emailSource.entries, config.mailLimit ?? 0);
      }
      if (config.emailSource.mode === 'pasted-existing') {
        return new PastedExistingWorkSource(config.emailSource.entries, config.mailLimit ?? 0);
      }
      const provider: EmailSourceProvider =
        config.emailSource.mode === 'custom'
          ? 'customdomain'
          : config.emailSource.provider;
      const service = config.emailSource.mode === 'api'
        ? config.emailSource.service
        : undefined;
      let budget = 0;
      if (config.emailSource.mode === 'api') {
        if (config.maxBillablePurchases === undefined || !Number.isInteger(config.maxBillablePurchases) || config.maxBillablePurchases < 0) {
          throw new ProviderError('CONFIG_ERROR', 'Phải chỉ định giới hạn mua hộp thư hợp lệ.');
        }
        budget = config.maxBillablePurchases;
      }
      const emailRetryIntervalMs = config.emailRetryIntervalSeconds !== undefined
        ? config.emailRetryIntervalSeconds * 1000
        : undefined;
      return new ContinuousEmailWorkSource(
        emailService,
        provider,
        service,
        runId,
        config.mailLimit ?? 0,
        budget,
        onPurchaseEvent,
        observation,
        mutationContext,
        emailRetryIntervalMs,
        onRetryWait
      );
    }
  };
}
