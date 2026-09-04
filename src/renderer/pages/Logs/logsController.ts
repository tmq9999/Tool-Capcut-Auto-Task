import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';
import { LOG_PAGE_SIZE_MAX } from '../../../shared/schemas/log.schema';
import type { LogStatus, RuntimeLog } from '../../../shared/types/log';

export interface ILogsBridge {
  logs: {
    list(filter: { page: number; pageSize: number; level?: string; email?: string }):
      Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>>;
    clear(): Promise<IpcEnvelope<{ success: boolean }>>;
    onEntry(listener: (entry: CanonicalRuntimeLog) => void): () => void;
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

  return {
    id: entry.id,
    time,
    email: entry.email,
    step: entry.step,
    status: entry.status as LogStatus,
    message: entry.message
  };
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
  private detach: (() => void) | null = null;
  private readonly maxLogs: number;
  /**
   * Bộ lọc của lần `load()` gần nhất. Giữ lại để `clear()` hay lần tải lại không
   * tham số vẫn hỏi đúng tập dòng người dùng đang xem, thay vì âm thầm nhảy về
   * "tất cả".
   */
  private lastQuery: LogsQuery = {};

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
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async load(filter?: LogsQuery): Promise<void> {
    /**
     * Gọi kèm bộ lọc thì THAY luôn bộ nhớ cũ, không merge: người dùng chọn lại
     * "Tất cả" phải xoá được `level` đã nhớ, merge thì họ kẹt ở ERROR vĩnh viễn.
     */
    if (filter) {
      this.lastQuery = {
        level: normalizeFilterValue(filter.level),
        email: normalizeFilterValue(filter.email)
      };
    }

    this.setState({ isLoading: true, error: null });
    /**
     * Kẹp theo `LOG_PAGE_SIZE_MAX`: `maxLogs` là kích thước bộ đệm TRÊN MÀN HÌNH
     * (1000 dòng), còn contract `logs.list` chỉ cho lấy 500 dòng một lần. Gửi
     * 1000 thì `logsIpc` trả VALIDATION_ERROR và trang không hiện dòng nào —
     * đúng lỗi đo được 04/09/2026 khi DB đang có 1573 dòng.
     */
    const request: { page: number; pageSize: number; level?: string; email?: string } = {
      page: 1,
      pageSize: Math.min(this.maxLogs, LOG_PAGE_SIZE_MAX)
    };
    /**
     * Gán có điều kiện chứ không viết `level: this.lastQuery.level`:
     * `LogFilterSchema` là `.strict()`, và khoá mang giá trị `undefined` vẫn
     * hiện trong `Object.keys` — phải VẮNG MẶT thật thì SQL mới bỏ qua.
     */
    if (this.lastQuery.level !== undefined) request.level = this.lastQuery.level;
    if (this.lastQuery.email !== undefined) request.email = this.lastQuery.email;

    const response = await this.bridge.logs.list(request);

    if (!response.success) {
      this.setState({ isLoading: false, error: 'Không tải được nhật ký runtime.' });
      return;
    }

    this.setState({
      isLoading: false,
      error: null,
      logs: response.data.items.map(toViewLog)
    });
  }

  attach(): void {
    if (this.detach) return;
    this.detach = this.bridge.logs.onEntry((entry) => {
      if (this.state.isPaused) return;
      const next = [toViewLog(entry), ...this.state.logs].slice(0, this.maxLogs);
      this.setState({ logs: next });
    });
  }

  setPaused(isPaused: boolean): void {
    this.setState({ isPaused });
  }

  async clear(): Promise<boolean> {
    const response = await this.bridge.logs.clear();
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }
    this.setState({ logs: [] });
    return true;
  }

  dispose(): void {
    if (this.detach) {
      this.detach();
      this.detach = null;
    }
    this.listeners.clear();
  }
}
