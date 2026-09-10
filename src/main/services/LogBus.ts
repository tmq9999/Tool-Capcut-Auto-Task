import crypto from 'node:crypto';
import type {
  CanonicalLogStatus,
  CanonicalRuntimeLog
} from '../../shared/schemas/log.schema';

export interface LogEntryInput {
  accountId?: string;
  email: string;
  step: string;
  status: CanonicalLogStatus;
  message: string;
}

export interface ILogSink {
  insertBatch(logs: CanonicalRuntimeLog[]): void;
  listIds?(): string[];
  deleteIds?(ids: readonly string[]): void;
}

export interface StartLogResetTicket {
  readonly runId: string;
  readonly throughSequence: number;
  readonly ids: readonly string[];
}

export interface StartLogResetPort {
  capture(runId: string): StartLogResetTicket;
  commit(ticket: StartLogResetTicket): { clearedThrough: number };
}

export interface LogBusScheduler {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export interface LogBusOptions {
  maxBatchSize?: number;
  flushIntervalMs?: number;
}

export interface LogBusDeps {
  now?: () => number;
  nextId?: () => string;
  scheduler?: LogBusScheduler;
}

const DEFAULT_MAX_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 1_000;

const nodeScheduler: LogBusScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (handle) => clearInterval(handle as unknown as NodeJS.Timeout)
};

/**
 * Single runtime-log pipeline. Emitters get immediate delivery to live
 * subscribers (Dashboard log panel) while SQLite writes are batched into one
 * transaction, so a burst of worker logs never blocks the main process
 * (AGENTS.md §17). A failed flush keeps the batch queued for the next attempt.
 */
export class LogBus implements StartLogResetPort {
  private queue: CanonicalRuntimeLog[] = [];
  private readonly listeners = new Set<(log: CanonicalRuntimeLog) => void>();
  private readonly resetListeners = new Set<(payload: { clearedThrough: number }) => void>();
  private readonly committedTickets = new WeakSet<StartLogResetTicket>();
  private timerHandle: number | null = null;
  private sequence = 0;
  private retryNotBefore = 0;

  private readonly now: () => number;
  private readonly nextId: () => string;
  private readonly scheduler: LogBusScheduler;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;

  constructor(
    private readonly sink: ILogSink,
    options: LogBusOptions = {},
    deps: LogBusDeps = {}
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
    this.scheduler = deps.scheduler ?? nodeScheduler;
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  emit(input: LogEntryInput): CanonicalRuntimeLog {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('LOG_STREAM_SEQUENCE_OVERFLOW');
    }
    this.sequence += 1;
    const entry: CanonicalRuntimeLog = {
      id: this.nextId(),
      email: input.email,
      step: input.step,
      status: input.status,
      message: input.message,
      createdAt: new Date(this.now()).toISOString(),
      streamSequence: this.sequence
    };
    if (input.accountId) {
      entry.accountId = input.accountId;
    }

    this.queue.push(entry);
    for (const listener of this.listeners) {
      listener(entry);
    }

    if (this.queue.length >= this.maxBatchSize && this.now() >= this.retryNotBefore) {
      this.flush();
    }

    return entry;
  }

  subscribe(listener: (log: CanonicalRuntimeLog) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onReset(listener: (payload: { clearedThrough: number }) => void): () => void {
    this.resetListeners.add(listener);
    return () => {
      this.resetListeners.delete(listener);
    };
  }

  capture(runId: string): StartLogResetTicket {
    const persistedIds = this.sink.listIds ? this.sink.listIds() : [];
    const queueIds = this.queue.map((entry) => entry.id);
    const ids = Array.from(new Set([...persistedIds, ...queueIds]));
    return {
      runId,
      throughSequence: this.sequence,
      ids
    };
  }

  commit(ticket: StartLogResetTicket): { clearedThrough: number } {
    if (this.committedTickets.has(ticket)) {
      throw new Error('Ticket has already been committed');
    }
    this.committedTickets.add(ticket);

    if (this.sink.deleteIds && ticket.ids.length > 0) {
      this.sink.deleteIds(ticket.ids);
    }

    const ticketIdSet = new Set(ticket.ids);
    this.queue = this.queue.filter(
      (entry) => (entry.streamSequence ?? 0) > ticket.throughSequence && !ticketIdSet.has(entry.id)
    );
    if (this.queue.length === 0) {
      this.retryNotBefore = 0;
    }

    const payload = { clearedThrough: ticket.throughSequence };
    for (const listener of this.resetListeners) {
      try {
        listener(payload);
      } catch {
        // listener failure should not fail commit
      }
    }

    return payload;
  }

  flush(force = false): void {
    if (this.queue.length === 0) return;
    const now = this.now();
    if (!force && now < this.retryNotBefore) return;

    const batch = this.queue.slice(0, this.maxBatchSize);
    try {
      this.sink.insertBatch(batch);
      this.queue.splice(0, batch.length);
      if (this.queue.length === 0) {
        this.retryNotBefore = 0;
      }
    } catch {
      this.retryNotBefore = now + this.flushIntervalMs;
    }
  }

  clear(clearPersisted: () => void): number {
    clearPersisted();
    this.queue = [];
    this.retryNotBefore = 0;
    const clearedThrough = this.sequence;
    const payload = { clearedThrough };
    for (const listener of this.resetListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
    return clearedThrough;
  }

  start(): void {
    if (this.timerHandle !== null) return;
    this.timerHandle = this.scheduler.setInterval(() => this.flush(), this.flushIntervalMs);
  }

  pendingCount(): number {
    return this.queue.length;
  }

  dispose(): void {
    if (this.timerHandle !== null) {
      this.scheduler.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.maxBatchSize);
      try {
        this.sink.insertBatch(batch);
        this.queue.splice(0, batch.length);
      } catch {
        break;
      }
    }
    this.listeners.clear();
    this.resetListeners.clear();
    if (this.queue.length > 0) {
      throw new Error('LOG_FLUSH_INCOMPLETE');
    }
  }
}

