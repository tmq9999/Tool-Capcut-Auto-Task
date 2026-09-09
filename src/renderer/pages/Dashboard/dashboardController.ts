import {
  DEFAULT_AUTOMATION_CONFIG,
  fromPersistedConfig,
  toPersistedConfig,
  toRunConfig,
  type AutomationConfigState
} from './automationConfig';
import type { AppSettingsDTO, CustomEmailSettingsDTO } from '../../../shared/schemas/settings.schema';
import type { SettingsSaveRequestDTO } from '../../../shared/schemas/settings-save.schema';
import type { CredentialStatusDTO } from '../../../shared/schemas/diagnostics.schema';
import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { AccountFilterDTO, AccountListItemDTO } from '../../../shared/schemas/account.schema';
import type { CanonicalRuntimeLog, LogFilterDTO } from '../../../shared/schemas/log.schema';
import type {
  AutomationRunConfigDTO,
  AutomationRunProgressDTO,
  RunningThreadInfoDTO
} from '../../../shared/schemas/automation.schema';
import type { EmailProviderConfigDTO } from '../../../shared/schemas/provider.schema';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings/default-settings';

/** The slice of the preload bridge the Dashboard needs. */
export interface IDashboardBridge {
  accounts: {
    list(filter: AccountFilterDTO): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>>;
    remove(ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>>;
  };
  logs: {
    list(filter: LogFilterDTO): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>>;
    onEntry(listener: (entry: CanonicalRuntimeLog) => void): () => void;
    clear?(): Promise<IpcEnvelope<{ success: boolean }>>;
  };
  run: {
    start(config: AutomationRunConfigDTO): Promise<IpcEnvelope<{ runId: string }>>;
    stop(): Promise<IpcEnvelope<{ success: boolean }>>;
    stopThread(accountId: string): Promise<IpcEnvelope<{ stopped: boolean }>>;
    threads(): Promise<IpcEnvelope<RunningThreadInfoDTO[]>>;
    progress(): Promise<IpcEnvelope<AutomationRunProgressDTO>>;
    onProgress(listener: (progress: AutomationRunProgressDTO) => void): () => void;
  };
  email: {
    providers(): Promise<IpcEnvelope<EmailProviderConfigDTO[]>>;
  };
  settings: {
    get(): Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>>;
    save(req: SettingsSaveRequestDTO): Promise<IpcEnvelope<{ success: boolean }>>;
  };
}

/** Credential mutations that leave every stored secret untouched. */
const KEEP_ALL_CREDENTIALS: SettingsSaveRequestDTO['credentials'] = [
  { serviceName: 'gmail94', operation: { action: 'keep' } },
  { serviceName: 'multilogin', operation: { action: 'keep' } },
  { serviceName: 'kiotproxy', operation: { action: 'keep' } },
  { serviceName: 'dongvanfb', operation: { action: 'keep' } },
  { serviceName: 'gologin', operation: { action: 'keep' } }
];

export interface DashboardState {
  isLoading: boolean;
  isSubmitting: boolean;
  isStopping: boolean;
  error: string | null;
  accounts: AccountListItemDTO[];
  totalAccounts: number;
  logs: CanonicalRuntimeLog[];
  emailProviders: EmailProviderConfigDTO[];
  progress: AutomationRunProgressDTO;
  runningThreads: RunningThreadInfoDTO[];
  config: AutomationConfigState;
  /** Catch-all domain settings, so the email panel can show where mail comes from. */
  customEmail: CustomEmailSettingsDTO;
  isSavingConfig: boolean;
  configSavedAt: string | null;
}

export interface DashboardControllerOptions {
  maxLogs?: number;
  accountPageSize?: number;
}

const IDLE_PROGRESS: AutomationRunProgressDTO = {
  runId: 'none',
  state: 'idle',
  workerTarget: 0,
  workersActive: 0,
  accountsAccepted: 0,
  accountsCompleted: 0,
  accountsFailed: 0,
  accountsStopped: 0,
  message: 'Chưa chạy'
};

const ACTIVE_STATES = new Set<AutomationRunProgressDTO['state']>(['preparing', 'running', 'stopping']);
const DEFAULT_MAX_LOGS = 300;
const DEFAULT_ACCOUNT_PAGE_SIZE = 200;

/**
 * Owns Dashboard state: the automation configuration, the account grid, the live
 * log feed and run progress. All data comes from the main process; the view
 * renders whatever this controller exposes.
 */
export class DashboardController {
  private state: DashboardState;
  private readonly listeners = new Set<(state: DashboardState) => void>();
  private detachers: Array<() => void> = [];
  /** Latest settings read from Main; patched and written back when saving config. */
  private storedSettings: AppSettingsDTO | null = null;
  private autoSaveEnabled = false;
  private pendingSave: Promise<boolean> | null = null;
  private pendingStop: Promise<boolean> | null = null;
  private readonly maxLogs: number;
  private readonly accountPageSize: number;

  constructor(
    private readonly bridge: IDashboardBridge,
    options: DashboardControllerOptions = {}
  ) {
    this.maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
    this.accountPageSize = options.accountPageSize ?? DEFAULT_ACCOUNT_PAGE_SIZE;
    this.state = {
      isLoading: true,
      isSubmitting: false,
      isStopping: false,
      error: null,
      accounts: [],
      totalAccounts: 0,
      logs: [],
      emailProviders: [],
      progress: IDLE_PROGRESS,
      runningThreads: [],
      config: { ...DEFAULT_AUTOMATION_CONFIG },
      customEmail: { ...DEFAULT_APP_SETTINGS.customEmail },
      isSavingConfig: false,
      configSavedAt: null
    };
  }

  getState(): DashboardState {
    return this.state;
  }

  subscribe(listener: (state: DashboardState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  isRunning(): boolean {
    return ACTIVE_STATES.has(this.state.progress.state) || this.state.progress.workersActive > 0;
  }

  updateConfig(patch: Partial<AutomationConfigState>): void {
    this.setState({ config: { ...this.state.config, ...patch }, configSavedAt: null });
    if (this.autoSaveEnabled) {
      this.pendingSave = this.saveConfig();
    }
  }

  /** Lets a caller (or a test) await an auto-save that is in flight. */
  async flushPendingSave(): Promise<void> {
    const pending = this.pendingSave;
    if (!pending) return;
    this.pendingSave = null;
    await pending;
  }

  /**
   * Writes the automation knobs into app settings. Everything else in Settings is
   * carried through untouched, and no credential is rewritten. The three
   * secret-bearing fields are excluded by toPersistedConfig.
   */
  async saveConfig(): Promise<boolean> {
    const base = this.storedSettings;
    if (!base) {
      this.setState({ error: 'Chưa đọc được cài đặt hiện tại, hãy thử tải lại.' });
      return false;
    }

    this.setState({ isSavingConfig: true });
    const response = await this.bridge.settings.save({
      settings: { ...base, automation: toPersistedConfig(this.state.config) },
      credentials: KEEP_ALL_CREDENTIALS
    });

    if (!response.success) {
      this.setState({ isSavingConfig: false, error: response.error.message });
      return false;
    }

    this.storedSettings = { ...base, automation: toPersistedConfig(this.state.config) };
    this.setState({
      isSavingConfig: false,
      configSavedAt: new Date().toISOString(),
      error: null
    });
    return true;
  }

  /** Which accounts hold a live browser right now. */
  private async refreshRunningThreads(): Promise<void> {
    const response = await this.bridge.run.threads();
    if (response.success) {
      this.setState({ runningThreads: response.data });
    }
  }

  isThreadRunning(accountId: string): boolean {
    return this.state.runningThreads.some((thread) => thread.accountId === accountId);
  }

  /** Stops one account browser and leaves every other thread running. */
  async stopThread(accountId: string): Promise<boolean> {
    const response = await this.bridge.run.stopThread(accountId);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.refreshRunningThreads();
    await this.refreshAccounts();
    if (!response.data.stopped) {
      this.setState({ error: 'Không thể dừng phiên trình duyệt. Hãy thử lại hoặc kiểm tra cửa sổ Multilogin.' });
      return false;
    }
    return response.data.stopped;
  }

  private async refreshAccounts(): Promise<string | null> {
    const response = await this.bridge.accounts.list({ page: 1, pageSize: this.accountPageSize });
    if (!response.success) {
      return 'Không tải được danh sách tài khoản.';
    }
    this.setState({ accounts: response.data.items, totalAccounts: response.data.total });
    return null;
  }

  async load(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    // Restore the saved knobs, keeping whatever the user is currently typing in
    // the fields that are deliberately never persisted.
    const settingsResponse = await this.bridge.settings.get();
    if (settingsResponse.success) {
      this.storedSettings = settingsResponse.data.settings;
      this.autoSaveEnabled = settingsResponse.data.settings.general.autoSaveConfig;
      this.setState({
        customEmail: settingsResponse.data.settings.customEmail,
        config: fromPersistedConfig(settingsResponse.data.settings.automation, {
          emailList: this.state.config.emailList,
          proxyList: this.state.config.proxyList,
          proxyKeyList: this.state.config.proxyKeyList,
          customPassword: this.state.config.customPassword
        })
      });
    }

    const accountError = await this.refreshAccounts();

    const logsResponse = await this.bridge.logs.list({ page: 1, pageSize: this.maxLogs });
    if (logsResponse.success) {
      this.setState({ logs: logsResponse.data.items });
    }

    const providersResponse = await this.bridge.email.providers();
    if (providersResponse.success) {
      this.setState({ emailProviders: providersResponse.data });
    }

    const progressResponse = await this.bridge.run.progress();
    if (progressResponse.success) {
      this.setState({ progress: progressResponse.data });
    }

    await this.refreshRunningThreads();

    this.setState({ isLoading: false, error: accountError });
  }

  /** Wires the push channels. Returns the detach function for convenience. */
  attach(): () => void {
    this.detachers.push(
      this.bridge.logs.onEntry((entry) => {
        const next = [entry, ...this.state.logs].slice(0, this.maxLogs);
        this.setState({ logs: next });
      })
    );

    this.detachers.push(
      this.bridge.run.onProgress((progress) => {
        const terminalError =
          progress.state === 'blocked' || progress.state === 'failed'
            ? progress.message
            : this.state.error;
        this.setState({
          progress,
          error: terminalError
        });
        // Rows appear as threads launch, so the grid follows every progress
        // event rather than waiting for the run to finish — otherwise the
        // per-row stop control is unreachable while the run is live.
        void this.refreshRunningThreads();
        void this.refreshAccounts();
      })
    );

    const pollInterval = setInterval(() => {
      const isLive = this.isRunning() || this.state.progress.workersActive > 0;
      if (isLive) {
        void this.refreshRunningThreads();
        void this.refreshAccounts();
      }
    }, 1000);
    this.detachers.push(() => clearInterval(pollInterval));

    return () => this.dispose();
  }

  async start(): Promise<boolean> {
    await this.flushPendingSave();
    const mapped = toRunConfig(this.state.config);
    if (!mapped.ok) {
      this.setState({ error: mapped.message });
      return false;
    }

    // Clear runtime logs for the new session immediately
    this.setState({ logs: [], isSubmitting: true, error: null });
    try {
      if (this.bridge.logs.clear) {
        await this.bridge.logs.clear();
      }
    } catch {
      // Best-effort clear
    }

    const response = await this.bridge.run.start(mapped.config);
    this.setState({ isSubmitting: false });

    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    this.setState({ error: null });
    return true;
  }

  /** Deletes account rows from the grid, e.g. clearing finished runs. */
  async removeAccounts(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    const response = await this.bridge.accounts.remove(ids);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.refreshAccounts();
    return true;
  }

  stop(): Promise<boolean> {
    if (this.pendingStop) return this.pendingStop;
    this.setState({ isStopping: true });
    this.pendingStop = this.stopAndRefresh().finally(() => {
      this.pendingStop = null;
      this.setState({ isStopping: false });
    });
    return this.pendingStop;
  }

  private async stopAndRefresh(): Promise<boolean> {
    try {
      const response = await this.bridge.run.stop();
      await Promise.all([this.refreshRunningThreads(), this.refreshAccounts()]);
      const progress = await this.bridge.run.progress();
      if (progress.success) this.setState({ progress: progress.data });
      if (!response.success || !response.data.success) {
        this.setState({ error: response.success ? 'Chưa xác nhận được phiên đã dừng.' : response.error.message });
        return false;
      }
      this.setState({ error: null });
      return true;
    } catch {
      this.setState({ error: 'Không nhận được xác nhận dừng. Hãy kiểm tra kết nối rồi thử lại.' });
      return false;
    }
  }

  dispose(): void {
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers = [];
    this.listeners.clear();
  }
}

let sharedDashboardController: DashboardController | null = null;

export function getSharedDashboardController(
  bridge: IDashboardBridge,
  options?: DashboardControllerOptions
): DashboardController {
  if (!sharedDashboardController) {
    sharedDashboardController = new DashboardController(bridge, options);
  }
  return sharedDashboardController;
}

export function resetSharedDashboardController(): void {
  sharedDashboardController = null;
}

