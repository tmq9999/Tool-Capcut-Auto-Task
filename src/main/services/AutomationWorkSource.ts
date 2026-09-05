import { z } from 'zod';
import type {
  AutomationRunConfigDTO
} from '../../shared/schemas/automation.schema';
import type { EmailSourceProvider } from '../../shared/schemas/provider.schema';
import { ProviderError } from '../providers/ProviderError';
import type {
  EmailAcquisitionSession,
  EmailCapacitySnapshot,
  EmailPurchaseService,
  ReservedEmail
} from './EmailPurchaseService';

export type WorkSourceKind = 'finite' | 'continuous';

export interface AutomationWorkItem {
  sourceId: string;
  email: string;
  emailProvider: string;
  emailPassword?: string;
  purchasedEmailId?: string;
  reservationId?: string;
}

export interface SourceReadiness {
  workerTarget: number;
  capacity?: EmailCapacitySnapshot;
}

export interface AutomationWorkSource {
  readonly kind: WorkSourceKind;
  prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness>;
  next(workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null>;
  commit(item: AutomationWorkItem, accountId: string): void;
  release(item: AutomationWorkItem): void;
}

export interface AutomationWorkSourceFactory {
  create(config: AutomationRunConfigDTO, runId: string): AutomationWorkSource;
}

class ManualWorkSource implements AutomationWorkSource {
  readonly kind = 'finite' as const;
  private queue: AutomationWorkItem[] = [];

  constructor(private readonly entries: string[]) {}

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
    return { workerTarget: Math.min(initialConcurrency, this.queue.length) };
  }

  async next(): Promise<AutomationWorkItem | null> {
    return this.queue.shift() ?? null;
  }

  commit(): void {}
  release(): void {}
}

class ContinuousEmailWorkSource implements AutomationWorkSource {
  readonly kind = 'continuous' as const;
  private session: EmailAcquisitionSession | null = null;
  private readonly reservations = new Map<string, ReservedEmail>();

  constructor(
    private readonly emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>,
    private readonly provider: EmailSourceProvider,
    private readonly service: string | undefined,
    private readonly runId: string
  ) {}

  async prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness> {
    this.session = await this.emailService.openAcquisitionSession(
      this.provider,
      initialConcurrency,
      { service: this.service },
      signal
    );
    return {
      workerTarget: initialConcurrency,
      capacity: this.session.capacity
    };
  }

  async next(workerId: string, signal: AbortSignal): Promise<AutomationWorkItem> {
    if (!this.session) throw new Error('Continuous source was not prepared.');
    const reservation = await this.session.acquireOne(this.runId + ':' + workerId, signal);
    this.reservations.set(reservation.reservationId, reservation);
    return {
      sourceId: reservation.reservationId,
      email: reservation.purchasedEmail.email,
      emailProvider: reservation.purchasedEmail.provider,
      purchasedEmailId: reservation.purchasedEmail.id,
      reservationId: reservation.reservationId
    };
  }

  commit(item: AutomationWorkItem, accountId: string): void {
    if (!item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) throw new Error('Email reservation ownership was lost.');
    this.session.commit(reservation, accountId);
    this.reservations.delete(item.reservationId);
  }

  release(item: AutomationWorkItem): void {
    if (!item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) return;
    this.session.release(reservation);
    this.reservations.delete(item.reservationId);
  }
}

export function createAutomationWorkSourceFactory(
  emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>
): AutomationWorkSourceFactory {
  return {
    create(config, runId) {
      if (config.emailSource.mode === 'manual') {
        return new ManualWorkSource(config.emailSource.entries);
      }
      const provider: EmailSourceProvider =
        config.emailSource.mode === 'custom'
          ? 'customdomain'
          : config.emailSource.provider;
      const service = config.emailSource.mode === 'api'
        ? config.emailSource.service
        : undefined;
      return new ContinuousEmailWorkSource(
        emailService,
        provider,
        service,
        runId
      );
    }
  };
}
