import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';
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

const DEFAULT_MAX_LOGS = 1000;

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

  async load(): Promise<void> {
    this.setState({ isLoading: true, error: null });
    const response = await this.bridge.logs.list({ page: 1, pageSize: this.maxLogs });

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
