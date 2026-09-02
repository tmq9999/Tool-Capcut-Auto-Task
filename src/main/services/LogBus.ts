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

/** The slice of LogRepository the bus writes through. */
export interface ILogSink {
  insertBatch(logs: CanonicalRuntimeLog[]): void;
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
export class LogBus {
  private queue: CanonicalRuntimeLog[] = [];
  private readonly listeners = new Set<(log: CanonicalRuntimeLog) => void>();
  private timerHandle: number | null = null;

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
    const entry: CanonicalRuntimeLog = {
      id: this.nextId(),
      email: input.email,
      step: input.step,
      status: input.status,
      message: input.message,
      createdAt: new Date(this.now()).toISOString()
    };
    if (input.accountId) {
      entry.accountId = input.accountId;
    }

    this.queue.push(entry);
    for (const listener of this.listeners) {
      listener(entry);
    }

    if (this.queue.length >= this.maxBatchSize) {
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

  flush(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    try {
      this.sink.insertBatch(batch);
      this.queue = [];
    } catch {
      // Keep the batch queued; the next flush retries it.
    }
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
    this.flush();
    this.listeners.clear();
  }
}
