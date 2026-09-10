import {
  DEFAULT_AUTOMATION_CONFIG,
  fromPersistedConfig,
  toPersistedConfig,
  toRunConfig,
  type AutomationConfigState
} from './automationConfig';
import type {
  AppSettingsDTO,
  AutomationConfigSettingsDTO,
  CustomEmailSettingsDTO
} from '../../../shared/schemas/settings.schema';
import type { SettingsSaveRequestDTO } from '../../../shared/schemas/settings-save.schema';
import type { CredentialStatusDTO } from '../../../shared/schemas/diagnostics.schema';
import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { AccountFilterDTO, AccountListItemDTO } from '../../../shared/schemas/account.schema';
import type { CanonicalRuntimeLog, LogFilterDTO, LogsResetPayload } from '../../../shared/schemas/log.schema';
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
    clear?(): Promise<IpcEnvelope<{ success: boolean; clearedThrough?: number }>>;
    onReset?(listener: (payload: LogsResetPayload) => void): () => void;
  };
  run: {
    start(config: AutomationRunConfigDTO): Promise<IpcEnvelope<{ runId: string; artifactBasename?: string; clearedThrough?: number }>>;
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
    saveAutomation?(req: AutomationConfigSettingsDTO): Promise<IpcEnvelope<{ success: boolean }>>;
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
  private configRevision = 0;
  private lastSavedRevision = 0;
  private inFlightSave: Promise<boolean> | null = null;
  private pendingStop: Promise<boolean> | null = null;
  private snapshotPromise: Promise<void> | null = null;
  private snapshotPending = false;
  private generation = 0;
  private currentCompletion: { promise: Promise<void>; resolve: () => void } | null = null;
  private nextCompletion: { promise: Promise<void>; resolve: () => void } | null = null;
  private isDisposed = false;
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

  getConfigRevision(): number {
    return this.configRevision;
  }

  getLastSavedRevision(): number {
    return this.lastSavedRevision;
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
    this.configRevision += 1;
    this.setState({ config: { ...this.state.config, ...patch }, configSavedAt: null });
    if (this.autoSaveEnabled) {
      void this.scheduleSave();
    }
  }

  private scheduleSave(): Promise<boolean> {
    if (this.inFlightSave) {
      return this.inFlightSave.then(() => {
        if (this.lastSavedRevision < this.configRevision) {
          return this.scheduleSave();
        }
        return true;
      });
    }

    const targetRevision = this.configRevision;
    const targetConfig = toPersistedConfig(this.state.config);
    this.setState({ isSavingConfig: true });

    this.inFlightSave = (async () => {
      try {
        const response = this.bridge.settings.saveAutomation
          ? await this.bridge.settings.saveAutomation(targetConfig)
          : await (async () => {
              const base = this.storedSettings;
              if (!base) {
                return {
                  success: false,
                  error: { code: 'ERR_PERSISTENCE_FAILED', message: 'Chưa đọc được cài đặt hiện tại, hãy thử tải lại.' }
                };
              }
              return await this.bridge.settings.save({
                settings: { ...base, automation: targetConfig },
                credentials: KEEP_ALL_CREDENTIALS
              });
            })();

        if (!response.success) {
          this.setState({ isSavingConfig: false, error: response.error.message });
          return false;
        }

        this.lastSavedRevision = Math.max(this.lastSavedRevision, targetRevision);
        if (this.storedSettings) {
          this.storedSettings = { ...this.storedSettings, automation: targetConfig };
        }
        this.setState({
          isSavingConfig: this.lastSavedRevision < this.configRevision,
          configSavedAt: new Date().toISOString(),
          error: null
        });
        return true;
      } finally {
        this.inFlightSave = null;
      }
    })();

    return this.inFlightSave.then((success) => {
      if (success && this.lastSavedRevision < this.configRevision) {
        return this.scheduleSave();
      }
      return success;
    });
  }

  /** Lets a caller (or a test) await an auto-save that is in flight. */
  async flushPendingSave(targetRevision?: number): Promise<void> {
    if (!this.autoSaveEnabled && !this.inFlightSave) {
      return;
    }
    const target = targetRevision ?? this.configRevision;
    while (this.lastSavedRevision < target && (this.autoSaveEnabled || this.inFlightSave)) {
      if (this.inFlightSave) {
        await this.inFlightSave;
      } else if (this.autoSaveEnabled) {
        const ok = await this.scheduleSave();
        if (!ok) break;
      }
    }
  }

  /**
   * Writes the automation knobs into app settings. Everything else in Settings is
   * carried through untouched, and no credential is rewritten. The three
   * secret-bearing fields are excluded by toPersistedConfig.
   */
  async saveConfig(): Promise<boolean> {
    this.configRevision += 1;
    return this.scheduleSave();
  }

  private requestSnapshotRefresh(): Promise<void> {
    if (this.isDisposed) {
      return Promise.resolve();
    }

    if (this.snapshotPromise === null) {
      let resolveCurrent!: () => void;
      const currentPromise = new Promise<void>((resolve) => {
        resolveCurrent = resolve;
      });
      this.currentCompletion = { promise: currentPromise, resolve: resolveCurrent };
      this.snapshotPromise = this.executeSnapshotPair();
      return currentPromise;
    }

    this.snapshotPending = true;
    if (!this.nextCompletion) {
      let resolveNext!: () => void;
      const nextPromise = new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      this.nextCompletion = { promise: nextPromise, resolve: resolveNext };
    }
    return this.nextCompletion.promise;
  }

  private async executeSnapshotPair(): Promise<void> {
    const currentGen = this.generation;
    try {
      const accountsRead = this.bridge.accounts.list({ page: 1, pageSize: this.accountPageSize });
      const threadsRead = this.bridge.run.threads();
      const results = await Promise.allSettled([accountsRead, threadsRead]);

      if (!this.isDisposed && this.generation === currentGen) {
        const statePatch: Partial<DashboardState> = {};
        const [accountsResult, threadsResult] = results;

        if (accountsResult.status === 'fulfilled') {
          const response = accountsResult.value;
          if (response.success) {
            statePatch.accounts = response.data.items;
            statePatch.totalAccounts = response.data.total;
          } else {
            statePatch.error = 'Không tải được danh sách tài khoản.';
          }
        } else {
          const reason = accountsResult.reason;
          statePatch.error = reason instanceof Error ? reason.message : 'Không tải được danh sách tài khoản.';
        }

        if (threadsResult.status === 'fulfilled') {
          const response = threadsResult.value;
          if (response.success) {
            statePatch.runningThreads = response.data;
          }
        }

        if (Object.keys(statePatch).length > 0) {
          this.setState(statePatch);
        }
      }
    } catch {
      // Identity guard: unexpected errors should never crash or leave gates stuck
    } finally {
      const finishedCompletion = this.currentCompletion;
      this.currentCompletion = null;
      finishedCompletion?.resolve();

      if (!this.isDisposed && this.snapshotPending) {
        this.snapshotPending = false;
        this.currentCompletion = this.nextCompletion;
        this.nextCompletion = null;
        this.snapshotPromise = this.executeSnapshotPair();
      } else {
        this.snapshotPromise = null;
        if (this.nextCompletion) {
          const dangling = this.nextCompletion;
          this.nextCompletion = null;
          dangling.resolve();
        }
      }
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

    await this.requestSnapshotRefresh();
    if (!response.data.stopped) {
      this.setState({ error: 'Không thể dừng phiên trình duyệt. Hãy thử lại hoặc kiểm tra cửa sổ Multilogin.' });
      return false;
    }
    return response.data.stopped;
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

    await this.requestSnapshotRefresh();

    this.setState({ isLoading: false });
  }

  /** Wires the push channels. Returns the detach function for convenience. */
  attach(): () => void {
    if (this.detachers.length > 0) {
      return () => this.dispose();
    }
    this.isDisposed = false;

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
        void this.requestSnapshotRefresh();
      })
    );

    if (this.bridge.logs.onReset) {
      this.detachers.push(
        this.bridge.logs.onReset((payload) => {
          this.applyLogReset(payload.clearedThrough);
        })
      );
    }

    const pollInterval = setInterval(() => {
      const isLive = this.isRunning() || this.state.progress.workersActive > 0;
      if (isLive) {
        void this.requestSnapshotRefresh();
      }
    }, 1000);
    this.detachers.push(() => clearInterval(pollInterval));

    return () => this.dispose();
  }

  async start(): Promise<boolean> {
    const startRevision = this.configRevision;
    await this.flushPendingSave(startRevision);
    const mapped = toRunConfig(this.state.config);
    if (!mapped.ok) {
      this.setState({ error: mapped.message });
      return false;
    }

    this.setState({ isSubmitting: true, error: null });

    const response = await this.bridge.run.start(mapped.config);
    this.setState({ isSubmitting: false });

    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    if (response.data.clearedThrough !== undefined) {
      this.applyLogReset(response.data.clearedThrough);
    } else {
      try {
        if (this.bridge.logs.clear) {
          const clearRes = await this.bridge.logs.clear();
          if (clearRes.success && clearRes.data?.clearedThrough !== undefined) {
            this.applyLogReset(clearRes.data.clearedThrough);
          } else {
            this.setState({ logs: [] });
          }
        }
      } catch {
        // Best-effort clear
      }
    }

    this.setState({ error: null });
    return true;
  }

  private applyLogReset(clearedThrough: number): void {
    this.setState({
      logs: this.state.logs.filter((l) => (l.streamSequence ?? 0) > clearedThrough)
    });
  }

  /** Deletes account rows from the grid, e.g. clearing finished runs. */
  async removeAccounts(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    const response = await this.bridge.accounts.remove(ids);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.requestSnapshotRefresh();
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
      await this.requestSnapshotRefresh();
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
    this.isDisposed = true;
    this.generation++;
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers = [];
    this.listeners.clear();

    if (this.currentCompletion) {
      this.currentCompletion.resolve();
      this.currentCompletion = null;
    }
    if (this.nextCompletion) {
      this.nextCompletion.resolve();
      this.nextCompletion = null;
    }
    this.snapshotPending = false;
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

