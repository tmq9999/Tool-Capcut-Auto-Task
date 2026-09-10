import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';
import { LOG_PAGE_SIZE_MAX } from '../../../shared/schemas/log.schema';
import type { RuntimeLog } from '../../../shared/types/log';

export interface ILogsBridge {
  logs: {
    list(filter: { page: number; pageSize: number; level?: string; email?: string }):
      Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>>;
    clear(): Promise<IpcEnvelope<{ success: boolean; clearedThrough?: number }>>;
    onEntry(listener: (entry: CanonicalRuntimeLog) => void): () => void;
    onReset?(listener: (payload: { clearedThrough: number }) => void): () => void;
  };
}

export interface LogsState {
  isLoading: boolean;
  error: string | null;
  logs: RuntimeLog[];
  isPaused: boolean;
}

export interface LogsControllerOptions {
  maxLogs?: number;
}

/** Bộ lọc trang Logs đẩy xuống server; `'ALL'`/rỗng nghĩa là không lọc. */
export interface LogsQuery {
  level?: string;
  email?: string;
}

const DEFAULT_MAX_LOGS = 1000;

/**
 * `'ALL'` (giá trị của mục "Tất cả" trong `LogsFilterBar`) và chuỗi rỗng đều
 * nghĩa là KHÔNG lọc, nên trả `undefined` để `load()` bỏ hẳn khoá khỏi request.
 * Không gửi chuỗi rỗng xuống: `LogFilterSchema` cho `level: ''` đi qua, rồi
 * `LogRepository.ts:56` dịch thành `status = ''` — khớp 0 dòng, trang trắng dù
 * DB có 1573 dòng.
 */
function normalizeFilterValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'ALL') return undefined;
  return trimmed;
}

/** Renders the stored UTC timestamp as a local HH:MM:SS clock for the grid. */
export function toViewLog(entry: CanonicalRuntimeLog): RuntimeLog {
  const parsed = new Date(entry.createdAt);
  const time = Number.isNaN(parsed.getTime())
    ? entry.createdAt
    : parsed.toTimeString().slice(0, 8);

  const view: RuntimeLog = {
    id: entry.id,
    time,
    email: entry.email,
    step: entry.step,
    status: entry.status,
    message: entry.message
  };
  if (entry.streamSequence !== undefined) {
    view.streamSequence = entry.streamSequence;
  }
  return view;
}

interface NormalizedLog {
  entry: CanonicalRuntimeLog;
  timestamp: number;
  view: RuntimeLog;
}

/** Owns the Logs page: persisted history plus the live stream from the main process. */
export class LogsController {
  private state: LogsState = {
    isLoading: true,
    error: null,
    logs: [],
    isPaused: false
  };

  private readonly listeners = new Set<(state: LogsState) => void>();
  private detachers: Array<() => void> = [];
  private readonly maxLogs: number;
  /**
   * Bộ lọc của lần `load()` gần nhất. Giữ lại để `clear()` hay lần tải lại không
   * tham số vẫn hỏi đúng tập dòng người dùng đang xem, thay vì âm thầm nhảy về
   * "tất cả".
   */
  private lastQuery: LogsQuery = {};
  private loadToken = 0;
  private clearedThrough: number | null = null;
  private pendingPushes: CanonicalRuntimeLog[] = [];
  private clearPromise: Promise<boolean> | null = null;
  private clearPushes: CanonicalRuntimeLog[] = [];
  private clearSurvivors: CanonicalRuntimeLog[] = [];
  private disposed = false;
  private generation = 0;
  private canonicalRows: CanonicalRuntimeLog[] = [];
  private clearError: string | null = null;
  private clearCollecting = false;
  private readonly normalized = new WeakMap<CanonicalRuntimeLog, NormalizedLog>();
  private unconfirmedPushes: CanonicalRuntimeLog[] = [];

  constructor(
    private readonly bridge: ILogsBridge,
    options: LogsControllerOptions = {}
  ) {
    this.maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
  }

  getState(): LogsState {
    return this.state;
  }

  subscribe(listener: (state: LogsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<LogsState>): void {
    this.state = { ...this.state, ...patch };
    if (this.disposed) return;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private normalize(entry: CanonicalRuntimeLog): NormalizedLog {
    const old = this.normalized.get(entry);
    if (old) return old;
    const value: NormalizedLog = {
      entry,
      timestamp: Date.parse(entry.createdAt),
      view: toViewLog(entry)
    };
    this.normalized.set(entry, value);
    return value;
  }

  private compareLogs(a: CanonicalRuntimeLog, b: CanonicalRuntimeLog): number {
    return (
      this.normalize(b).timestamp - this.normalize(a).timestamp ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  private upsertSorted(
    rows: readonly CanonicalRuntimeLog[],
    entry: CanonicalRuntimeLog
  ): CanonicalRuntimeLog[] {
    this.normalize(entry);
    const next = rows.filter((row) => row.id !== entry.id);
    let low = 0;
    let high = next.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.compareLogs(entry, next[mid]) < 0) high = mid;
      else low = mid + 1;
    }
    next.splice(low, 0, entry);
    return next.slice(0, this.maxLogs);
  }

  private compact(entries: readonly CanonicalRuntimeLog[]): CanonicalRuntimeLog[] {
    const unique = new Map<string, CanonicalRuntimeLog>();
    for (const item of entries) {
      if (!unique.has(item.id)) unique.set(item.id, item);
    }
    return [...unique.values()].sort((a, b) => this.compareLogs(a, b)).slice(0, this.maxLogs);
  }

  private visible(entries: readonly CanonicalRuntimeLog[]): CanonicalRuntimeLog[] {
    return this.compact(
      entries.filter(
        (item) =>
          this.matchesFilter(item) &&
          (this.clearedThrough === null ||
            item.streamSequence === undefined ||
            item.streamSequence > this.clearedThrough)
      )
    );
  }

  private publishRows(
    entries: readonly CanonicalRuntimeLog[],
    patch: Partial<LogsState> = {}
  ): void {
    this.canonicalRows = this.visible(entries);
    this.setState({
      ...patch,
      logs: this.canonicalRows.map((row) => this.normalize(row).view)
    });
  }

  private isCurrentLoad(token: number, generation: number): boolean {
    return !this.disposed && this.generation === generation && token === this.loadToken;
  }

  private matchesFilter(entry: CanonicalRuntimeLog): boolean {
    if (this.lastQuery.level && this.lastQuery.level !== 'ALL') {
      if (entry.status !== this.lastQuery.level) return false;
    }
    if (this.lastQuery.email && this.lastQuery.email.trim().length > 0) {
      const q = this.lastQuery.email.trim().toLowerCase();
      if (!entry.email.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  async load(filter?: LogsQuery): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    const token = ++this.loadToken;
    if (filter) {
      this.lastQuery = {
        level: normalizeFilterValue(filter.level),
        email: normalizeFilterValue(filter.email)
      };
    }
    const barrier = this.clearPromise;
    if (!barrier) this.clearError = null;
    this.setState({ isLoading: true, error: this.clearError });
    if (barrier) await barrier;
    if (!this.isCurrentLoad(token, generation)) return;
    await this.loadHistory(token, generation);
  }

  private async loadHistory(token: number, generation: number): Promise<void> {
    if (!this.isCurrentLoad(token, generation)) return;
    this.pendingPushes = [];
    this.setState({ isLoading: true, error: this.clearError });
    const request: { page: number; pageSize: number; level?: string; email?: string } = {
      page: 1,
      pageSize: Math.min(this.maxLogs, LOG_PAGE_SIZE_MAX)
    };
    if (this.lastQuery.level !== undefined) request.level = this.lastQuery.level;
    if (this.lastQuery.email !== undefined) request.email = this.lastQuery.email;
    const loadError = () =>
      this.setState({
        isLoading: false,
        error: this.clearError
          ? this.clearError + ' — Không tải được nhật ký runtime.'
          : 'Không tải được nhật ký runtime.'
      });
    try {
      const response = await this.bridge.logs.list(request);
      if (!this.isCurrentLoad(token, generation)) return;
      if (!response.success) {
        loadError();
        return;
      }
      const combined = [
        ...this.unconfirmedPushes,
        ...this.pendingPushes,
        ...this.clearSurvivors,
        ...response.data.items
      ];
      const historyIds = new Set(response.data.items.map((row) => row.id));
      this.clearSurvivors = this.compact(
        this.clearSurvivors.filter((row) => !historyIds.has(row.id))
      );
      this.unconfirmedPushes = this.unconfirmedPushes.filter(
        (row) => !historyIds.has(row.id)
      );
      this.pendingPushes = [];
      this.publishRows(combined, { isLoading: false, error: this.clearError });
    } catch {
      if (this.isCurrentLoad(token, generation)) loadError();
    }
  }

  attach(): void {
    if (this.detachers.length > 0) return;
    this.disposed = false;
    const generation = this.generation;
    this.detachers.push(
      this.bridge.logs.onEntry((entry) => {
        if (this.disposed || generation !== this.generation || this.state.isPaused) return;
        if (
          this.clearedThrough !== null &&
          entry.streamSequence !== undefined &&
          entry.streamSequence <= this.clearedThrough
        ) {
          return;
        }

        this.unconfirmedPushes = this.upsertSorted(this.unconfirmedPushes, entry);

        if (this.clearCollecting) {
          this.clearPushes = this.upsertSorted(this.clearPushes, entry);
          return;
        }
        if (this.clearPromise !== null) {
          this.clearSurvivors = this.upsertSorted(this.clearSurvivors, entry);
        }
        if (this.state.isLoading) {
          this.pendingPushes = this.upsertSorted(this.pendingPushes, entry);
        }
        if (!this.matchesFilter(entry)) return;

        this.canonicalRows = this.upsertSorted(this.canonicalRows, entry);
        this.setState({ logs: this.canonicalRows.map((row) => this.normalize(row).view) });
      })
    );

    if (this.bridge.logs.onReset) {
      this.detachers.push(
        this.bridge.logs.onReset((payload) => {
          if (this.disposed || generation !== this.generation) return;
          this.applyLogReset(payload.clearedThrough);
        })
      );
    }
  }

  private applyLogReset(cutoff: number): void {
    this.clearedThrough = Math.max(this.clearedThrough ?? 0, cutoff);
    const committedCutoff = this.clearedThrough;
    this.unconfirmedPushes = this.unconfirmedPushes.filter(
      (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
    );
    this.pendingPushes = this.pendingPushes.filter(
      (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
    );
    this.clearPushes = this.clearPushes.filter(
      (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
    );
    this.clearSurvivors = this.clearSurvivors.filter(
      (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
    );
    this.canonicalRows = this.canonicalRows.filter(
      (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
    );
    this.publishRows(this.canonicalRows, { isLoading: false, error: null });
  }

  setPaused(isPaused: boolean): void {
    if (!this.disposed) this.setState({ isPaused });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.loadToken += 1;
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers = [];
    this.listeners.clear();
    this.pendingPushes = [];
    // Keep unconfirmedPushes across dispose so preclear pushes survive component unmount/remount
    // Keep the in-flight clear, its buffers and watermark until it settles.
  }


  clear(): Promise<boolean> {
    if (this.clearPromise) return this.clearPromise;
    if (this.disposed) return Promise.resolve(false);
    this.loadToken += 1;
    const previousRows = [...this.canonicalRows];
    this.pendingPushes = [];
    this.clearPushes = [];
    this.clearCollecting = true;
    this.clearError = null;
    this.publishRows([], { isLoading: false, error: null });
    const operation = this.finishClear(previousRows).finally(() => {
      if (this.clearPromise !== operation) return;
      this.clearPromise = null;
      this.clearPushes = [];
      this.clearCollecting = false;
    });
    this.clearPromise = operation;
    return operation;
  }

  private async finishClear(previousRows: CanonicalRuntimeLog[]): Promise<boolean> {
    let response: Awaited<ReturnType<ILogsBridge['logs']['clear']>>;
    try {
      response = await this.bridge.logs.clear();
    } catch (error) {
      response = {
        success: false,
        error: {
          code: 'ERR_PERSISTENCE_FAILED',
          message: error instanceof Error ? error.message : 'Clear failed'
        }
      };
    }
    this.clearCollecting = false;
    if (!response.success || !response.data.success) {
      this.clearError = response.success ? 'Clear failed' : response.error.message;
      this.clearSurvivors = this.compact([...this.clearPushes, ...this.clearSurvivors]);
      this.publishRows(
        [...this.unconfirmedPushes, ...this.clearPushes, ...this.clearSurvivors, ...previousRows],
        { isLoading: false, error: this.clearError }
      );
      return false;
    }

    const cutoff = response.data.clearedThrough;
    if (cutoff !== undefined) {
      this.clearedThrough = Math.max(this.clearedThrough ?? 0, cutoff);
      const committedCutoff = this.clearedThrough;
      this.unconfirmedPushes = this.unconfirmedPushes.filter(
        (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
      );
      this.clearSurvivors = this.compact(
        [...this.clearPushes, ...this.clearSurvivors].filter(
          (item) => item.streamSequence !== undefined && item.streamSequence > committedCutoff
        )
      );
    } else {
      this.unconfirmedPushes = [];
      this.clearSurvivors = [];
    }
    this.publishRows(this.clearSurvivors, { isLoading: false, error: null });

    if (cutoff === undefined && !this.disposed) {
      // Private read cannot await this clearPromise; it owns the latest query now.
      const token = ++this.loadToken;
      await this.loadHistory(token, this.generation);
    }
    return true;
  }
}
