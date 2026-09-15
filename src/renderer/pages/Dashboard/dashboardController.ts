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


interface ConfigSaveTarget {
  revision: number;
  config: AutomationConfigSettingsDTO;
}

type ConfigSaveResult = {
  revision: number;
  status: 'committed' | 'failed' | 'superseded';
};

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
  private lastCommittedRevision = 0;
  private activeTarget: {
    target: ConfigSaveTarget;
    waiters: Array<(res: ConfigSaveResult) => void>;
    generation: number;
  } | null = null;
  private pendingPinnedTarget: {
    target: ConfigSaveTarget;
    waiters: Array<(res: ConfigSaveResult) => void>;
    generation: number;
  } | null = null;
  private pendingBackgroundTarget: {
    target: ConfigSaveTarget;
    waiters: Array<(res: ConfigSaveResult) => void>;
    generation: number;
  } | null = null;
  private pendingStart: Promise<boolean> | null = null;
  private pendingStop: Promise<boolean> | null = null;
  private lastSaveError: string | null = null;
  private snapshotPromise: Promise<void> | null = null;
  private snapshotPending = false;
  private generation = 0;
  private loadToken = 0;
  private progressPushRevision = 0;
  private logResetEpoch = 0;
  private logClearedThrough: number | null = null;
  private logHistoryToken = 0;
  private readonly unconfirmedLogs = new Map<string, CanonicalRuntimeLog>();
  private readonly knownSequences = new Map<string, number>();
  private readonly editedConfigKeys = new Set<keyof AutomationConfigState>();
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
    for (const k of Object.keys(patch) as Array<keyof AutomationConfigState>) {
      this.editedConfigKeys.add(k);
    }
    this.setState({ config: { ...this.state.config, ...patch }, configSavedAt: null });
    if (this.autoSaveEnabled) {
      void this.scheduleSave();
    }
  }

  private enqueueSave(
    target: ConfigSaveTarget,
    priority: 'background' | 'pinned'
  ): Promise<ConfigSaveResult> {
    if (this.isDisposed) {
      return Promise.resolve({ revision: target.revision, status: 'superseded' });
    }

    const currentGeneration = this.generation;
    return new Promise<ConfigSaveResult>((resolve) => {
      if (!this.activeTarget) {
        this.activeTarget = {
          target,
          waiters: [resolve],
          generation: currentGeneration
        };
        if (!this.isDisposed) {
          this.setState({ isSavingConfig: true });
        }
        void this.processSaveQueue();
        return;
      }

      if (priority === 'pinned') {
        if (this.activeTarget.target.revision === target.revision) {
          this.activeTarget.waiters.push(resolve);
          return;
        }
        if (this.pendingPinnedTarget) {
          if (this.pendingPinnedTarget.target.revision === target.revision) {
            this.pendingPinnedTarget.waiters.push(resolve);
            return;
          }
          for (const w of this.pendingPinnedTarget.waiters) {
            try {
              w({ revision: this.pendingPinnedTarget.target.revision, status: 'superseded' });
            } catch {
              // ignore
            }
          }
        }
        this.pendingPinnedTarget = {
          target,
          waiters: [resolve],
          generation: currentGeneration
        };
        return;
      }

      // priority === 'background'
      if (this.activeTarget.target.revision === target.revision) {
        this.activeTarget.waiters.push(resolve);
        return;
      }

      if (this.pendingBackgroundTarget) {
        if (this.pendingBackgroundTarget.target.revision === target.revision) {
          this.pendingBackgroundTarget.waiters.push(resolve);
          return;
        }
        const superseded = this.pendingBackgroundTarget;
        this.pendingBackgroundTarget = {
          target,
          waiters: [resolve],
          generation: currentGeneration
        };
        for (const w of superseded.waiters) {
          try {
            w({ revision: superseded.target.revision, status: 'superseded' });
          } catch {
            // ignore
          }
        }
        return;
      }

      this.pendingBackgroundTarget = {
        target,
        waiters: [resolve],
        generation: currentGeneration
      };
    });
  }

  private async processSaveQueue(): Promise<void> {
    while (this.activeTarget) {
      const current = this.activeTarget;
      const { target, waiters, generation: targetGen } = current;

      let result: ConfigSaveResult;
      try {
        let response: IpcEnvelope<{ success: boolean }>;
        if (this.bridge.settings.saveAutomation) {
          response = await this.bridge.settings.saveAutomation(target.config);
        } else {
          response = {
            success: false,
            error: {
              code: 'ERR_BRIDGE_NOT_READY',
              message: 'Cầu nối cài đặt chưa hỗ trợ lưu cấu hình tự động.'
            }
          };
        }

        if (response.success && response.data?.success === true) {
          this.lastSavedRevision = Math.max(this.lastSavedRevision, target.revision);
          this.lastCommittedRevision = target.revision;
          if (this.storedSettings) {
            this.storedSettings = { ...this.storedSettings, automation: target.config };
          }
          if (!this.isDisposed && this.generation === targetGen) {
            const isCurrent = this.configRevision === target.revision;
            const shouldClearError = isCurrent && this.state.error === this.lastSaveError;
            if (shouldClearError) {
              this.lastSaveError = null;
            }
            this.setState({
              configSavedAt: isCurrent ? new Date().toISOString() : null,
              ...(shouldClearError ? { error: null } : {})
            });
          }
          result = { revision: target.revision, status: 'committed' };
        } else {
          const errorMsg = !response.success
            ? response.error.message
            : 'Lưu cấu hình tự động không thành công.';
          this.lastSaveError = errorMsg;
          if (!this.isDisposed && this.generation === targetGen) {
            this.setState({
              configSavedAt: null,
              error: errorMsg
            });
          }
          result = { revision: target.revision, status: 'failed' };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.lastSaveError = errorMsg;
        if (!this.isDisposed && this.generation === targetGen) {
          this.setState({
            configSavedAt: null,
            error: errorMsg
          });
        }
        result = { revision: target.revision, status: 'failed' };
      }

      for (const w of waiters) {
        try {
          w(result);
        } catch {
          // ignore
        }
      }

      if (this.pendingPinnedTarget) {
        this.activeTarget = this.pendingPinnedTarget;
        this.pendingPinnedTarget = null;
      } else if (this.pendingBackgroundTarget) {
        this.activeTarget = this.pendingBackgroundTarget;
        this.pendingBackgroundTarget = null;
      } else {
        this.activeTarget = null;
      }
    }

    if (!this.isDisposed) {
      this.setState({ isSavingConfig: false });
    }
  }

  private scheduleSave(): Promise<boolean> {
    const target: ConfigSaveTarget = {
      revision: this.configRevision,
      config: toPersistedConfig(this.state.config)
    };
    return this.enqueueSave(target, 'background').then(
      (res) => res.status === 'committed'
    );
  }

  /** Lets a caller (or a test) await an auto-save that is in flight. */
  async flushPendingSave(targetRevision?: number): Promise<boolean> {
    const target = targetRevision ?? this.configRevision;

    if (this.lastCommittedRevision === target) {
      return true;
    }

    if (this.activeTarget?.target.revision === target) {
      return new Promise<boolean>((resolve) => {
        this.activeTarget!.waiters.push((res) => resolve(res.status === 'committed'));
      });
    }

    if (this.pendingPinnedTarget?.target.revision === target) {
      return new Promise<boolean>((resolve) => {
        this.pendingPinnedTarget!.waiters.push((res) => resolve(res.status === 'committed'));
      });
    }

    if (this.pendingBackgroundTarget?.target.revision === target) {
      return new Promise<boolean>((resolve) => {
        this.pendingBackgroundTarget!.waiters.push((res) => resolve(res.status === 'committed'));
      });
    }

    if (target === 0 || this.lastCommittedRevision === target) {
      return true;
    }

    return false;
  }

  /**
   * Writes the automation knobs into app settings. Everything else in Settings is
   * carried through untouched, and no credential is rewritten. The three
   * secret-bearing fields are excluded by toPersistedConfig.
   */
  async saveConfig(): Promise<boolean> {
    this.configRevision += 1;
    const target: ConfigSaveTarget = {
      revision: this.configRevision,
      config: toPersistedConfig(this.state.config)
    };
    const result = await this.enqueueSave(target, 'background');
    return result.status === 'committed';
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
    try {
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
    } catch (err: unknown) {
      this.setState({ error: err instanceof Error ? err.message : 'Không thể dừng phiên trình duyệt.' });
      return false;
    }
  }

  async load(): Promise<void> {
    const generation = this.generation;
    const token = ++this.loadToken;
    const isCurrent = () => !this.isDisposed && this.generation === generation && this.loadToken === token;

    this.setState({ isLoading: true, error: null });

    try {
      // Restore the saved knobs, keeping whatever the user has already edited in
      // memory, and keeping fields that are deliberately never persisted.
      const settingsResponse = await this.bridge.settings.get();
      if (!isCurrent()) return;

      if (settingsResponse.success) {
        this.storedSettings = settingsResponse.data.settings;
        this.autoSaveEnabled = settingsResponse.data.settings.general.autoSaveConfig;
        const persisted = fromPersistedConfig(settingsResponse.data.settings.automation, {
          emailList: this.state.config.emailList,
          proxyList: this.state.config.proxyList,
          proxyKeyList: this.state.config.proxyKeyList,
          customPassword: this.state.config.customPassword
        });
        const nextConfig = { ...this.state.config };
        for (const key of Object.keys(persisted) as Array<keyof AutomationConfigState>) {
          if (!this.editedConfigKeys.has(key)) {
            Object.assign(nextConfig, { [key]: persisted[key] });
          }
        }
        this.setState({
          customEmail: settingsResponse.data.settings.customEmail,
          config: nextConfig
        });
      }

      await this.refreshLogs();
      if (!isCurrent()) return;

      const providersResponse = await this.bridge.email.providers();
      if (!isCurrent()) return;
      if (providersResponse.success) {
        this.setState({ emailProviders: providersResponse.data });
      }

      const pushRevBefore = this.progressPushRevision;
      const progressResponse = await this.bridge.run.progress();
      if (!isCurrent()) return;
      if (this.progressPushRevision === pushRevBefore && progressResponse.success) {
        this.setState({ progress: progressResponse.data });
      }

      await this.requestSnapshotRefresh();
      if (!isCurrent()) return;

      this.setState({ isLoading: false });
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ isLoading: false, error: message });
    }
  }

  /** Wires the push channels. Returns the detach function for convenience. */
  attach(): () => void {
    if (this.detachers.length > 0) {
      return () => this.dispose();
    }
    this.isDisposed = false;
    if (this.pendingStart) {
      this.setState({ isSubmitting: true });
    }

    this.detachers.push(
      this.bridge.logs.onEntry((entry) => {
        if (
          this.logClearedThrough !== null &&
          entry.streamSequence !== undefined &&
          entry.streamSequence <= this.logClearedThrough
        ) {
          return;
        }
        const idKey = entry.id ? String(entry.id) : `${entry.createdAt}-${entry.message}`;
        if (entry.streamSequence !== undefined) {
          this.knownSequences.set(idKey, entry.streamSequence);
        }
        this.unconfirmedLogs.set(idKey, entry);
        const next = [entry, ...this.state.logs].slice(0, this.maxLogs);
        this.setState({ logs: next });
      })
    );

    this.detachers.push(
      this.bridge.run.onProgress((progress) => {
        this.progressPushRevision++;
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

  start(): Promise<boolean> {
    if (this.pendingStart) {
      return this.pendingStart;
    }
    this.setState({ isSubmitting: true });
    const activeStart = this.executeStart().finally(() => {
      if (this.pendingStart === activeStart) {
        this.pendingStart = null;
      }
      if (!this.isDisposed && this.pendingStart === null) {
        this.setState({ isSubmitting: false });
      }
    });
    this.pendingStart = activeStart;
    return activeStart;
  }

  private async executeStart(): Promise<boolean> {
    const startGeneration = this.generation;
    const snapshotConfig = { ...this.state.config };
    const snapshotRevision = this.configRevision;

    const mapped = toRunConfig(snapshotConfig);
    if (!mapped.ok) {
      if (!this.isDisposed && this.generation === startGeneration) {
        this.setState({ error: mapped.message });
      }
      return false;
    }

    if (this.autoSaveEnabled) {
      const pinnedTarget: ConfigSaveTarget = {
        revision: snapshotRevision,
        config: toPersistedConfig(snapshotConfig)
      };
      const saveResult = await this.enqueueSave(pinnedTarget, 'pinned');
      if (saveResult.status !== 'committed') {
        return false;
      }
    }

    try {
      const response = await this.bridge.run.start(mapped.config);
      if (!response.success) {
        if (!this.isDisposed && this.generation === startGeneration) {
          this.setState({ error: response.error.message });
        }
        return false;
      }

      if (response.data.clearedThrough !== undefined) {
        this.applyLogReset(response.data.clearedThrough);
      }

      if (!this.isDisposed && this.generation === startGeneration) {
        this.setState({ error: null });
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.isDisposed && this.generation === startGeneration) {
        this.setState({ error: message });
      }
      return false;
    }
  }

  private applyLogReset(clearedThrough: number): void {
    if (this.logClearedThrough !== null && clearedThrough <= this.logClearedThrough) {
      return;
    }
    this.logResetEpoch += 1;
    this.logClearedThrough = Math.max(this.logClearedThrough ?? 0, clearedThrough);
    const cutoff = this.logClearedThrough;

    for (const [key, entry] of this.unconfirmedLogs.entries()) {
      if (entry.streamSequence !== undefined && entry.streamSequence <= cutoff) {
        this.unconfirmedLogs.delete(key);
      }
    }
    for (const [key, seq] of this.knownSequences.entries()) {
      if (seq <= cutoff) {
        this.knownSequences.delete(key);
      }
    }

    this.setState({
      logs: this.state.logs.filter((l) => l.streamSequence !== undefined && l.streamSequence > cutoff)
    });
    void this.refreshLogs();
  }

  private async refreshLogs(): Promise<void> {
    const token = ++this.logHistoryToken;
    const requestEpoch = this.logResetEpoch;
    const requestGen = this.generation;

    try {
      const logsResponse = await this.bridge.logs.list({ page: 1, pageSize: this.maxLogs });
      if (
        this.isDisposed ||
        this.generation !== requestGen ||
        this.logResetEpoch !== requestEpoch ||
        token !== this.logHistoryToken
      ) {
        return;
      }
      if (!logsResponse.success) {
        return;
      }

      const sqlItems = logsResponse.data.items;
      const authoritativeKeys = new Set<string>();

      const visibleSqlLogs: CanonicalRuntimeLog[] = [];
      for (let row of sqlItems) {
        const idKey = row.id ? String(row.id) : `${row.createdAt}-${row.message}`;
        authoritativeKeys.add(idKey);
        this.unconfirmedLogs.delete(idKey);

        const knownSeq = this.knownSequences.get(idKey);
        if (knownSeq !== undefined) {
          if (row.streamSequence === undefined || row.streamSequence < knownSeq) {
            row = { ...row, streamSequence: knownSeq };
          } else if (row.streamSequence > knownSeq) {
            this.knownSequences.set(idKey, row.streamSequence);
          }
        } else if (row.streamSequence !== undefined) {
          this.knownSequences.set(idKey, row.streamSequence);
        }

        if (
          this.logClearedThrough === null ||
          row.streamSequence === undefined ||
          row.streamSequence > this.logClearedThrough
        ) {
          visibleSqlLogs.push(row);
        }
      }

      for (const [key] of this.knownSequences.entries()) {
        if (!authoritativeKeys.has(key) && !this.unconfirmedLogs.has(key)) {
          this.knownSequences.delete(key);
        }
      }

      const survivingLive: CanonicalRuntimeLog[] = [];
      for (const entry of this.unconfirmedLogs.values()) {
        if (
          this.logClearedThrough === null ||
          entry.streamSequence === undefined ||
          entry.streamSequence > this.logClearedThrough
        ) {
          survivingLive.push(entry);
        }
      }

      const seenIds = new Set<string>();
      const merged: CanonicalRuntimeLog[] = [];
      for (const l of [...survivingLive, ...visibleSqlLogs]) {
        const idKey = l.id ? String(l.id) : `${l.createdAt}-${l.message}`;
        if (!seenIds.has(idKey)) {
          seenIds.add(idKey);
          merged.push(l);
        }
      }

      merged.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        const seqA = a.streamSequence;
        const seqB = b.streamSequence;
        if (seqA !== undefined && seqB !== undefined && seqA !== seqB) {
          return seqB - seqA;
        }
        return 0;
      });

      this.setState({ logs: merged.slice(0, this.maxLogs) });
    } catch {
      // Ignore background log refresh failures
    }
  }



  /** Deletes account rows from the grid, e.g. clearing finished runs. */
  async removeAccounts(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    try {
      const response = await this.bridge.accounts.remove(ids);
      if (!response.success) {
        this.setState({ error: response.error.message });
        return false;
      }

      await this.requestSnapshotRefresh();
      return true;
    } catch (err: unknown) {
      this.setState({ error: err instanceof Error ? err.message : 'Không thể xóa tài khoản.' });
      return false;
    }
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

    if (this.pendingPinnedTarget) {
      for (const w of this.pendingPinnedTarget.waiters) {
        try {
          w({ revision: this.pendingPinnedTarget.target.revision, status: 'superseded' });
        } catch {
          // ignore
        }
      }
      this.pendingPinnedTarget = null;
    }
    if (this.pendingBackgroundTarget) {
      for (const w of this.pendingBackgroundTarget.waiters) {
        try {
          w({ revision: this.pendingBackgroundTarget.target.revision, status: 'superseded' });
        } catch {
          // ignore
        }
      }
      this.pendingBackgroundTarget = null;
    }
    // In-flight start promise ownership is preserved across dispose/attach so duplicate Start IPCs are coalesced.
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

