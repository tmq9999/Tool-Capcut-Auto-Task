import crypto from 'node:crypto';
import type { BrowserContext as CapcutContext, Page as CapcutPage } from 'playwright-core';
import { ProviderError } from '../providers/ProviderError';
import { AutomationTerminalError } from './AutomationTerminalError';
import { DirectProxyPool, getDirectProxyRouteKey } from './DirectProxyPool';
import { generateCapcutPassword } from './passwordGenerator';
import { measureStage } from './stageTiming';
import {
  type BrowserLauncher,
  type LauncherProxy,
  ProfileStopError,
  type ProfileStopDiagnostic,
  type ProfileStopObservation
} from './capcut/launcher';
import { abortable, abortableDelay, withinDeadline } from './capcut/cancellation';
import {
  RunUiInteractionScheduler,
  createDirectUiInteraction,
  mapUiSchedulerEventToEvidence,
  type UiSchedulerSnapshot
} from './capcut/uiInteractionScheduler';
import { createRunTelemetry, type RunTelemetry } from './capcut/runTelemetry';
import {
  EvidenceTaskKeySchema,
  type AutomationEvidenceNonTerminalEvent,
  type AutomationEvidenceTerminalEvent
} from '../../shared/schemas/automation-evidence.schema';
import type {
  AccountUiInteraction,
  CapcutAuthAttempt,
  CapcutUiAccountResult,
  CapcutVerificationReceipt,
  UnsettledTaskProof
} from './capcut/types';
import type { LogBus, StartLogResetTicket, StartLogResetPort } from './LogBus';
import type { AcquiredProxyLease } from './ProxyLeaseManager';
import type { ObservationIdentity, ObservationScope } from '../providers/ObservedHttpClient';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  AutomationWorkSourceFactory,
  SourceReadiness
} from './AutomationWorkSource';
import type { DiagnosticMutationContext } from './EmailPurchaseService';
import type {
  AutomationRunConfigDTO,
  AutomationRunCountersDTO,
  AutomationRunProgressDTO,
  AutomationRunState,
  AutomationTerminalCode,
  AutomationTerminalReasonDTO,
  BrowserRuntime,
  RunHealthRequestDTO,
  RunHealthResponseDTO
} from '../../shared/schemas/automation.schema';
import {
  AutomationRunConfigSchema,
  IMPLEMENTED_BROWSER_RUNTIMES,
  isBrowserImplemented,
  RunHealthRequestSchema
} from '../../shared/schemas/automation.schema';
import type {
  AccountCreateInputDTO,
  AccountUpdateInputDTO
} from '../../shared/schemas/account.schema';
import type { AccountIdentity } from './AccountService';
import {
  normalizePastedCapcutEntries,
  formatPastedCapcutIssues
} from '../../shared/schemas/pasted-capcut.schema';
import { TaskEvidenceError } from './capcut/TaskEvidenceError';

/**
 * Hạn chờ mã xác minh của một luồng. Giữ nguyên 90 giây của bản đầu vì CHƯA có
 * số đo nào về độ trễ CapCut → hộp thư vendor; `buildOtpReader` in mốc thời gian
 * mỗi lượt để lượt chạy thật cung cấp số đó (AGENTS.md §3).
 */
const OTP_WAIT_MS = 90_000;
export const HEADLESS_WORKER_STAGGER_MS = 4_000;

export function headlessWorkerStaggerMs(headless: boolean, workerId: string): number {
  if (!headless) return 0;
  const match = /^worker-(\d+)$/.exec(workerId);
  return match ? Math.max(0, Number(match[1]) - 1) * HEADLESS_WORKER_STAGGER_MS : 0;
}

export function systemStopMessage(code: string | undefined): string {
  if (code === 'RESOURCE_CLEANUP_FAILED') {
    return 'Đã dừng vì lỗi thu hồi browser của phiên chạy';
  }
  if (code === 'APP_SHUTDOWN') {
    return 'Đã dừng khi đóng ứng dụng';
  }
  if (code === 'USER_STOP') {
    return 'Đã dừng theo yêu cầu';
  }
  return 'Đã dừng vì lỗi của phiên chạy';
}

export interface StartedProfile {
  profileId: string;
  /** Remote-debugging port, null when the runtime does not report one at start. */
  port: number | null;
  browserType: string;
}

export interface BrowserProxySettings {
  host: string;
  port: number;
  type: string;
  username?: string;
  password?: string;
}

/** Provider-agnostic browser runtime. Implemented today by Multilogin quick profiles. */
export interface IBrowserRuntimeApi {
  startProfile(params: {
    headless: boolean;
    proxy?: BrowserProxySettings;
    browser?: BrowserRuntime;
    signal?: AbortSignal;
    onProfileStarted?: (profileId: string) => void;
  }): Promise<StartedProfile>;
  stopProfile(profileId: string): Promise<void>;
}

export interface IEmailOtpSource {
  readOtp(purchasedEmailId: string, type?: string): Promise<string | null>;
}

export interface IProxyLeaseSource {
  acquire(signal?: AbortSignal): Promise<AcquiredProxyLease>;
  release(lease: AcquiredProxyLease): Promise<void>;
  releaseAll(): Promise<void>;
  /**
   * How many threads can hold a proxy at the same time — the account's key
   * count. null means no known ceiling.
   */
  availableSlots?(): Promise<number | null>;
  /** Narrows the source to the keys — và vùng — lượt chạy này được dùng. */
  configure?(options: { keys?: string[]; region?: string }): void;
  resetIdlePreflightCache?(): void;
}

export interface IAccountSink {
  create(input: AccountCreateInputDTO): { id: string };
  update(id: string, data: AccountUpdateInputDTO): { success: boolean };
  findByEmail?(email: string): AccountIdentity[];
}

/**
 * Kết quả CapCut ghi nhận cho một account, đọc từ chính snapshot `task_list`
 * của CapCut — không phải bộ đếm nội bộ (xem `docs/AUTOMATION-ENGINE.md` §3).
 */
export interface CapcutAccountResult {
  done: number;
  total: number;
  credits: number;
  creditsTotal: number;
  missing: string[];
  /**
   * Ưu đãi Pro đọc được từ DOM, dạng câu để hiển thị — ví dụ `Pro trial 7 ngày`
   * hoặc `Không có ưu đãi`. `undefined` khi cổng trial không đọc được gì.
   */
  subscription?: string;
  /** Account bị bỏ qua có chủ ý (ví dụ không có ưu đãi trial), không phải lỗi. */
  skipped?: boolean;
  /**
   * Tiến độ TỪNG nhiệm vụ, để lưu xuống SQLite (`docs/MERGE-PLAN.md` §4 Pha 5).
   */
  tasks: Array<{
    key: string;
    title: string;
    reward: number;
    status: number;
    opId?: string;
    provedAt?: string;
  }>;
  fatalError?: string;
}

/**
 * Bộ chạy nhiệm vụ CapCut. Khai ở đây theo hướng đảo phụ thuộc: service này chỉ
 * cần biết "đưa một phiên browser vào, nhận kết quả ra", không cần biết engine
 * làm gì bên trong.
 */
export interface CapcutTaskRunner {
  runAccount(input: {
    page: CapcutPage;
    context: CapcutContext;
    email: string;
    password: string;
    accountId: string;
    /**
     * true khi email của luồng vừa được thuê/mua trong lượt chạy này, nên account
     * CHƯA tồn tại trên CapCut và phải đi thẳng đường ĐĂNG KÝ.
     */
    isNewAccount: boolean;
    authAttempt?: CapcutAuthAttempt;
    runId?: string;
    sessionAlias?: string;
    sessionStartedAt?: number;
    signal: AbortSignal;
    ui: AccountUiInteraction;
    /** Nguồn OTP của riêng luồng này; chỉ đường ĐĂNG KÝ cần. */
    getOtp?: () => Promise<string>;
    /** `retryCount` của Dashboard, đã đổi sang số lượt quét lại nhiệm vụ. */
    maxRounds?: number;
    pace?: { stepMinMs: number; stepMaxMs: number; typeMinMs: number; typeMaxMs: number };
    skipWithoutTrial: boolean;
    unsettledProofs: readonly UnsettledTaskProof[];
    onAcceptedProof?: (proof: UnsettledTaskProof) => Promise<void>;
    onTaskCheckpoint: (checkpoint: {
      rows: CapcutAccountResult['tasks'];
      receipt: CapcutVerificationReceipt;
      unsettledProofs: readonly UnsettledTaskProof[];
    }) => Promise<void>;
    isExpectedClose?: () => boolean;
    log: (status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', step: string, message: string) => void;
  }): Promise<CapcutUiAccountResult>;
}

/**
 * Account-scoped HTTP mission runner.  This is deliberately a separate
 * dependency from the Playwright-backed `CapcutTaskRunner`: it receives only
 * account credentials, an explicit proxy route, logging and cancellation—no
 * browser/Page/DOM handle—so it cannot fall through to the legacy UI engine.
 */
export interface HttpOnlyAccountRunner {
  preflight(config: AutomationRunConfigDTO, signal: AbortSignal): Promise<void>;
  runAccount(input: {
    email: string;
    password: string;
    accountId: string;
    isNewAccount: boolean;
    getOtp?: () => Promise<string>;
    /** Account-bound checkpoint callback; callers cannot select another account. */
    onTaskProgress(rows: CapcutAccountResult['tasks']): void;
    proxy?: {
      server: string;
      username?: string;
      password?: string;
    };
    signal: AbortSignal;
    log: (
      status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR',
      step: string,
      message: string
    ) => void;
  }): Promise<CapcutAccountResult>;
}

/**
 * Nơi lưu tiến độ từng nhiệm vụ xuống SQLite.
 */
export interface ICapcutTaskProgressSink {
  record(accountId: string, checkpoint: {
    rows: CapcutAccountResult['tasks'];
    receipt: CapcutVerificationReceipt;
    unsettledProofs: readonly UnsettledTaskProof[];
  }): Promise<void>;
  recordLegacy?(accountId: string, rows: CapcutAccountResult['tasks']): void;
  recordUnsettled?(accountId: string, runId: string, proofs: readonly UnsettledTaskProof[]): Promise<void>;
}

export interface AutomationRunCollaborators {
  workSources: AutomationWorkSourceFactory;
  emailOtp: IEmailOtpSource;
  proxies: IProxyLeaseSource;
  browser: IBrowserRuntimeApi;
  accounts: IAccountSink;
  logBus: Pick<LogBus, 'emit'>;
  logReset?: StartLogResetPort;
  launcher?: () => BrowserLauncher | null;
  capcut?: CapcutTaskRunner;
  httpOnlyRunner?: HttpOnlyAccountRunner;
  taskProgress?: ICapcutTaskProgressSink;
  observation?: ObservationScope;
  mutationContext?: DiagnosticMutationContext;
}

export const SESSION_LAUNCH_STOP_GRACE_MS = 30_000;
export const PROFILE_STOP_TIMEOUT_MS = 60_000;
export const MAX_UI_SESSION_RECYCLES = 1;

export interface AutomationRunDeps {
  sleep?: (ms: number) => Promise<void>;
  nextId?: () => string;
  sessionLaunchStopGraceMs?: number;
  profileStopTimeoutMs?: number;
  userDataDir?: string;
  createTelemetry?: (runId: string) => RunTelemetry;
  onTerminalSnapshot?: (snapshot: AutomationRunTerminalSnapshot) => void;
}

export interface AutomationRunTerminalSnapshot {
  schedulers: Array<{ sessionAlias: string; snapshot: UiSchedulerSnapshot }>;
  activeThreads: number;
  activeProfiles: number;
  activeProxies: number;
  activeMailReservations: number;
}

type ThreadOutcome =
  | { kind: 'completed'; status: 'done'; step: string }
  | { kind: 'skipped'; status: 'done'; step: string }
  | { kind: 'failed'; status: 'error'; step: string }
  | { kind: 'stopped'; status: 'stopped'; step: string };

export type AutomationRunSummary = AutomationRunProgressDTO & {
  startedProfiles: string[];
};

/** One live thread, addressable so the UI can stop just this one. */
export interface RunningThreadInfo {
  accountId: string;
  email: string;
  transport?: 'ui' | 'http-only';
  profileId?: string;
}

export interface BrowserSessionRuntime {
  alias: string;
  provider?: string;
  startedAt: number;
  launchPromise?: Promise<void>;
  stopRequested: boolean;
  profileId?: string;
  port?: number | null;
  page?: CapcutPage;
  context?: CapcutContext;
  launcher?: BrowserLauncher;
  ui: AccountUiInteraction;
  scheduler?: RunUiInteractionScheduler;
  profileStopPromise?: Promise<boolean>;
  stopPromise?: Promise<boolean>;
  stopFailed?: boolean;
  stopOutcomeLocked?: boolean;
  profileStartRecorded?: boolean;
  stopDiagnostic?: ProfileStopDiagnostic;
  stopCause?: unknown;
  stopPhase?: ProfileStopObservation['phase'] | 'unknown';
  remoteConfirmed?: boolean;
}

export interface IterationProofState {
  readonly ownerToken: object;
  readonly acceptedProofWrites: Map<string, Promise<void>>;
}

interface ThreadRuntime extends IterationProofState {
  runId: string;
  workerAlias: string;
  accountAlias: string;
  accountId: string;
  email: string;
  emailProvider: string;
  capcutPassword: string;
  isExistingAccount?: boolean;
  purchasedEmailId?: string;
  lease?: AcquiredProxyLease;
  directProxy?: BrowserProxySettings;
  session?: BrowserSessionRuntime;
  sessionSequence: number;
  sessionRecycleCount: number;
  outcomeStep?: string;
  outcome?: ThreadOutcome;
  outcomePersisted?: boolean;
  completionPromise?: Promise<void>;
  notifyDone?: () => void;
  routeReleased?: boolean;
}

class InitialWaveBarrier {
  private arrived = 0;
  private open = false;
  private release: () => void = () => {};
  private readonly ready = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(private readonly target: number) {
    if (target === 0) this.openBarrier();
  }

  arrive(): void {
    if (this.open) return;
    this.arrived += 1;
    if (this.arrived >= this.target) this.openBarrier();
  }

  private openBarrier(): void {
    if (this.open) return;
    this.open = true;
    this.release();
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (this.open) return;
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.ready, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Các scheme proxy đọc được.
 */
const PROXY_SCHEMES = ['http', 'https', 'socks4', 'socks5'] as const;

/**
 * Đọc một dòng proxy trực tiếp.
 */
export function parseDirectProxy(entry: string): BrowserProxySettings | null {
  const raw = entry.trim();
  if (!raw) return null;

  let type: string = 'http';
  let rest = raw;

  const schemeMatch = /^([a-z0-9]+):\/\/(.*)$/i.exec(raw);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!(PROXY_SCHEMES as readonly string[]).includes(scheme)) return null;
    type = scheme;
    rest = schemeMatch[2].trim();
  }

  let host = '';
  let port = 0;
  let username: string | undefined;
  let password: string | undefined;

  if (rest.includes('@')) {
    // Format: [user:pass@]host:port
    const atIndex = rest.lastIndexOf('@');
    const authPart = rest.slice(0, atIndex).trim();
    const hostPortPart = rest.slice(atIndex + 1).trim();

    const authColon = authPart.indexOf(':');
    if (authColon >= 0) {
      username = authPart.slice(0, authColon).trim();
      password = authPart.slice(authColon + 1);
    } else {
      username = authPart;
    }

    const hostPortParts = hostPortPart.split(':').map((p) => p.trim());
    if (hostPortParts.length !== 2) return null;
    host = hostPortParts[0] ?? '';
    port = Number(hostPortParts[1]);
  } else {
    // Format: host:port[:user[:pass]]
    const parts = rest.split(':');
    if (parts.length < 2) return null;
    host = parts[0].trim();
    port = Number(parts[1].trim());
    if (parts[2] !== undefined && parts[2].trim() !== '') {
      username = parts[2].trim();
    }
    if (parts.length > 3) {
      password = parts.slice(3).join(':');
    }
  }

  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const settings: BrowserProxySettings = { host: host.toLowerCase(), port, type: type.toLowerCase() };
  if (username !== undefined && username !== '') settings.username = username;
  if (password !== undefined && password !== '') settings.password = password;
  return settings;
}

function toLauncherProxy(proxy?: BrowserProxySettings): LauncherProxy | null {
  if (!proxy) return null;
  const mapped: LauncherProxy = {
    scheme: proxy.type,
    host: proxy.host,
    port: String(proxy.port)
  };
  if (proxy.username) mapped.username = proxy.username;
  if (proxy.password) mapped.password = proxy.password;
  return mapped;
}

function leaseToProxySettings(lease: AcquiredProxyLease): BrowserProxySettings {
  const settings: BrowserProxySettings = {
    host: lease.host,
    port: lease.port,
    type: lease.protocol
  };
  if (lease.username) settings.username = lease.username;
  if (lease.password) settings.password = lease.password;
  return settings;
}

function toHttpOnlyProxy(proxy?: BrowserProxySettings): {
  server: string;
  username?: string;
  password?: string;
} | undefined {
  if (!proxy) return undefined;
  return {
    server: proxy.type + '://' + proxy.host + ':' + proxy.port,
    ...(proxy.username ? { username: proxy.username } : {}),
    ...(proxy.password ? { password: proxy.password } : {})
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

export class AutomationRunService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nextId: () => string;
  private readonly sessionLaunchStopGraceMs: number;
  private readonly profileStopTimeoutMs: number;
  private readonly uiSchedulers = new Map<string, RunUiInteractionScheduler>();
  private telemetry: RunTelemetry | null = null;
  private readonly listeners = new Set<(progress: AutomationRunProgressDTO) => void>();

  private progress: AutomationRunProgressDTO = {
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

  private activeRun: Promise<AutomationRunSummary> | null = null;
  private healthRun: Promise<RunHealthResponseDTO> | null = null;
  private healthAbort: AbortController | null = null;
  private healthUncertainProfiles = 0;
  private starting: Promise<{ runId: string; artifactBasename?: string }> | null = null;
  private stopping: Promise<void> | null = null;
  private lastSummary: AutomationRunSummary | null = null;
  private runAbort: AbortController | null = null;
  private acquisitionAbort: AbortController | null = null;
  private terminalIntent: AutomationTerminalReasonDTO | null = null;
  private terminalState: 'blocked' | 'failed' | 'stopped' | null = null;
  private terminalPersistenceFailure: AutomationTerminalError | null = null;
  private proofPersistenceFailure: AutomationTerminalError | null = null;
  private readonly iterationAbort = new Map<string, AbortController>();
  private readonly iterationOwners = new Map<string, object>();
  private cleanupFailures = 0;
  private skippedAccounts = 0;
  private mailboxAcquisitions = 0;
  private accountSequence = 0;
  private readonly sessionSequences = new Map<string, number>();
  private evidenceMode: 'new' | 'resume' | 'health' = 'new';
  private evidenceStage: 1 | 3 | 5 | 10 | null = null;
  private sourceForEvidence: AutomationWorkSource | null = null;
  private activeProfileCount = 0;
  private activeProxyCount = 0;
  private activeDirectProxyPool: DirectProxyPool | null = null;
  private activeMailReservationCount = 0;
  private startedProfiles: string[] = [];
  private readonly activeThreads = new Map<string, ThreadRuntime>();
  private runningResolvers: Array<() => void> = [];
  private firstWaveDone = false;

  private observe<T>(identity: Readonly<ObservationIdentity>, operation: () => Promise<T>): Promise<T> {
    return this.deps.observation?.withObservationScope(identity, operation) ?? operation();
  }

  constructor(
    private readonly deps: AutomationRunCollaborators,
    private readonly runtime: AutomationRunDeps = {}
  ) {
    this.sleep = runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nextId = runtime.nextId ?? (() => crypto.randomUUID());
    this.sessionLaunchStopGraceMs = runtime.sessionLaunchStopGraceMs ?? SESSION_LAUNCH_STOP_GRACE_MS;
    this.profileStopTimeoutMs = runtime.profileStopTimeoutMs ?? PROFILE_STOP_TIMEOUT_MS;
  }

  getTelemetry(): RunTelemetry | null {
    return this.telemetry;
  }

  getUserDataDir(): string {
    if (!this.runtime.userDataDir) throw new Error('RUNTIME_USER_DATA_UNAVAILABLE');
    return this.runtime.userDataDir;
  }

  subscribe(listener: (progress: AutomationRunProgressDTO) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getProgress(): AutomationRunProgressDTO {
    return this.progress;
  }

  isRunning(): boolean {
    return this.activeRun !== null || this.healthRun !== null || this.healthUncertainProfiles > 0 ||
      this.starting !== null || this.stopping !== null || this.uiSchedulers.size > 0;
  }

  private createUiScheduler(runId: string, onEvidenceFailure?: () => void): RunUiInteractionScheduler {
    return new RunUiInteractionScheduler({
      editorLaneLimit: 1,
      onEvent: (event) => {
        if (event.type === 'profile-stopped') return;
        try {
          if (this.telemetry && runId === this.progress.runId) {
            this.recordEvidence(mapUiSchedulerEventToEvidence(runId, event));
          }
        } catch {
          onEvidenceFailure?.();
        }
      }
    });
  }

  private retireUiScheduler(sessionAlias: string, scheduler: RunUiInteractionScheduler): void {
    if (this.uiSchedulers.get(sessionAlias) !== scheduler) return;
    scheduler.closeSession(sessionAlias);
    const snapshot = scheduler.snapshot();
    if (snapshot.foreground.active === 0 && snapshot.foreground.queued === 0 &&
        snapshot.editor.active === 0 && snapshot.editor.queued === 0) {
      this.uiSchedulers.delete(sessionAlias);
    }
  }

  private shutdownAllUiSchedulers(
    reason: { code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED'; message: string }
  ): void {
    for (const scheduler of this.uiSchedulers.values()) scheduler.shutdown(reason);
  }

  runHealthCheck(input: RunHealthRequestDTO): Promise<RunHealthResponseDTO> {
    const parsedInput = RunHealthRequestSchema.safeParse(input);
    if (!parsedInput.success) {
      return Promise.reject(new ProviderError('CONFIG_ERROR', 'Cấu hình health check không hợp lệ.'));
    }
    input = parsedInput.data;
    if (this.isRunning() || this.activeThreads.size > 0) {
      return Promise.reject(new ProviderError('CONFIG_ERROR', 'Đang có phiên chạy; không thể chạy health đồng thời.'));
    }
    const launcher = this.deps.launcher?.();
    if (!launcher) {
      return Promise.reject(new ProviderError('CONFIG_ERROR', 'Không có browser launcher cho health check.'));
    }
    const runId = this.nextId();
    const telemetry = this.runtime.createTelemetry?.(runId) ?? createRunTelemetry({
      userDataDir: this.getUserDataDir(),
      runId
    });
    const artifactBasename = telemetry.artifactBasename();
    const abort = new AbortController();
    this.healthAbort = abort;
    let evidenceFailed = false;
    const abortHealthOwnership = (message: string): void => {
      const reason = { code: 'RESOURCE_CLEANUP_FAILED' as const, message };
      abort.abort(Object.assign(new Error(message), { code: reason.code }));
      this.shutdownAllUiSchedulers(reason);
    };

    const operation = (async (): Promise<RunHealthResponseDTO> => {
      let attempted = 0;
      let healthy = 0;
      let stopped = 0;
      let cleanupFailures = 0;
      let activeProfiles = 0;
      let runFailed = false;
      const snapshot = (): void => telemetry.record({
        schemaVersion: 1,
        runId,
        at: new Date().toISOString(),
        type: 'resource-snapshot',
        activeWorkers: activeProfiles,
        activeProfiles,
        activeProxies: 0,
        activeMailReservations: 0
      });

      telemetry.record({
        schemaVersion: 1,
        runId,
        at: new Date().toISOString(),
        type: 'run-start',
        mode: 'health',
        headed: true,
        uiScope: 'session-target',
        stage: input.rolloutStage,
        workerTarget: input.threadCount,
        maxBillablePurchases: 0
      });
      snapshot();

      const results = await Promise.allSettled(Array.from({ length: input.threadCount }, async (_unused, index) => {
        const workerAlias = `worker-${index + 1}`;
        const sessionAlias = `${workerAlias}-session-1`;
        const scheduler = new RunUiInteractionScheduler({
          editorLaneLimit: 1,
          onEvent: (event) => {
            if (event.type === 'profile-stopped' || evidenceFailed) return;
            try {
              telemetry.record(mapUiSchedulerEventToEvidence(runId, event));
            } catch {
              evidenceFailed = true;
              abortHealthOwnership('Health evidence failed');
            }
          }
        });
        this.uiSchedulers.set(sessionAlias, scheduler);
        const identity = { sessionAlias, signal: abort.signal, focusMode: 'target' as const };
        const ui = scheduler.forSession(identity);
        attempted += 1;
        let profileId: string | undefined;
        let profileRecorded = false;
        let launchTimedOut = false;
        let iterationClosed = false;
        const adoptProfile = (id: string): void => {
          profileId = id;
          if (profileRecorded) return;
          profileRecorded = true;
          if (iterationClosed && launchTimedOut) {
            void withTimeout(
              this.observe({
                runId,
                workerAlias,
                accountAlias: 'unassigned',
                sessionAlias,
                provider: 'multilogin',
                operation: 'profile-stop'
              }, () => launcher.stop(id)),
              this.profileStopTimeoutMs,
              new Error('Late health profile stop timeout')
            ).then(
              () => {
                this.healthUncertainProfiles = Math.max(0, this.healthUncertainProfiles - 1);
                scheduler.confirmProfileStopped(sessionAlias);
                this.retireUiScheduler(sessionAlias, scheduler);
              },
              () => {}
            );
            return;
          }
          activeProfiles += 1;
          telemetry.record({
            schemaVersion: 1, runId, workerAlias, sessionAlias,
            at: new Date().toISOString(), type: 'profile-start'
          });
          snapshot();
        };
        try {
          const launchOp = this.observe({
            runId,
            workerAlias,
            accountAlias: 'unassigned',
            sessionAlias,
            provider: 'multilogin',
            operation: 'profile-launch'
          }, () => launcher.launch({
              headless: false,
              signal: abort.signal,
              ui,
              onProfileStarted: adoptProfile
            }));
          void launchOp.then(
            (launched) => {
              try {
                adoptProfile(launched.profileId);
              } catch {
                evidenceFailed = true;
                abortHealthOwnership('Health profile evidence failed');
              }
            },
            () => {
              if (iterationClosed && launchTimedOut && !profileId) {
                this.healthUncertainProfiles = Math.max(0, this.healthUncertainProfiles - 1);
                this.retireUiScheduler(sessionAlias, scheduler);
              }
            }
          );
          const launched = await withTimeout(
            launchOp,
            this.sessionLaunchStopGraceMs,
            new Error('Health launch timeout')
          );
          adoptProfile(launched.profileId);
          healthy += 1;
        } catch (error: unknown) {
          launchTimedOut = error instanceof Error && error.message === 'Health launch timeout';
          if (launchTimedOut && !profileId) {
            this.healthUncertainProfiles += 1;
            cleanupFailures += 1;
            abortHealthOwnership('Health launch ownership did not settle before timeout');
          }
          throw error;
        } finally {
          iterationClosed = true;
          if (profileId) {
            try {
              await withTimeout(
                this.observe({
                  runId,
                  workerAlias,
                  accountAlias: 'unassigned',
                  sessionAlias,
                  provider: 'multilogin',
                  operation: 'profile-stop'
                }, () => launcher.stop(profileId!)),
                this.profileStopTimeoutMs,
                new Error('Profile stop timeout')
              );
              activeProfiles = Math.max(0, activeProfiles - 1);
              stopped += 1;
              scheduler.confirmProfileStopped(sessionAlias);
              this.retireUiScheduler(sessionAlias, scheduler);
              telemetry.record({
                schemaVersion: 1, runId, workerAlias, sessionAlias,
                at: new Date().toISOString(), type: 'profile-stop', outcome: 'confirmed'
              });
              snapshot();
            } catch {
              cleanupFailures += 1;
              this.healthUncertainProfiles += 1;
              abortHealthOwnership('Health profile cleanup failed');
              telemetry.record({
                schemaVersion: 1, runId, workerAlias, sessionAlias,
                at: new Date().toISOString(), type: 'profile-stop', outcome: 'failed',
                code: 'RESOURCE_CLEANUP_FAILED'
              });
            }
          }
          if (!profileId && !launchTimedOut) {
            this.retireUiScheduler(sessionAlias, scheduler);
          }
        }
      }));
      runFailed = evidenceFailed || cleanupFailures > 0 || results.some((result) => result.status === 'rejected');

      telemetry.record({
        schemaVersion: 1, runId, at: new Date().toISOString(), type: 'health-summary',
        attempted, healthy, stopped, cleanupFailures
      });
      await telemetry.close({
        schemaVersion: 1, runId, at: new Date().toISOString(), type: 'terminal',
        mode: 'health', stage: input.rolloutStage, mailboxAcquisitions: 0,
        state: !runFailed && cleanupFailures === 0 && healthy === attempted ? 'completed' : 'failed',
        code: cleanupFailures > 0
          ? 'RESOURCE_CLEANUP_FAILED'
          : runFailed || healthy !== attempted ? 'INTERNAL_ERROR' : 'HEALTH_CHECK_COMPLETED',
        accepted: 0, completed: 0, failed: 0, stopped: 0, skipped: 0,
        cleanupFailures, purchaseAttempted: 0, purchaseConfirmed: 0, purchaseAmbiguous: 0
      });
      if (runFailed) throw new Error('HEALTH_CHECK_FAILED');
      return { runId, artifactBasename, attempted, healthy, stopped, cleanupFailures };
    })().finally(() => {
      this.healthAbort = null;
      this.healthRun = null;
    });
    this.healthRun = operation;
    return operation;
  }

  private publish(
    state: AutomationRunState,
    message: string,
    patch: Partial<AutomationRunProgressDTO> = {}
  ): void {
    this.progress = {
      ...this.progress,
      ...patch,
      state,
      message
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(this.progress);
      } catch {
        // Guard each observer separately; no recursive LogBus warning
      }
    }
  }

  private increment(
    key: keyof Pick<
      AutomationRunCountersDTO,
      'accountsAccepted' | 'accountsCompleted' | 'accountsFailed' | 'accountsStopped'
    >
  ): void {
    this.publish(this.progress.state, this.progress.message, {
      [key]: this.progress[key] + 1
    });
  }

  private recordResourceSnapshot(): void {
    this.recordEvidence({
      schemaVersion: 1,
      runId: this.progress.runId,
      at: new Date().toISOString(),
      type: 'resource-snapshot',
      activeWorkers: this.progress.workersActive,
      activeProfiles: this.activeProfileCount,
      activeProxies: this.activeProxyCount,
      activeMailReservations: this.activeMailReservationCount
    });
  }

  private recordEvidence(event: AutomationEvidenceNonTerminalEvent): void {
    if (!this.telemetry) return;
    try {
      this.telemetry.record(event);
    } catch {
      const failure = new AutomationTerminalError(
        'failed',
        { code: 'INTERNAL_ERROR' },
        'Không ghi được bằng chứng rollout.'
      );
      this.shutdownAllUiSchedulers({
        code: 'RUN_ABORTED',
        message: failure.message
      });
      this.acceptTerminalError(failure);
      throw failure;
    }
  }

  private log(
    status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR',
    email: string,
    step: string,
    message: string,
    accountId?: string
  ): void {
    this.deps.logBus.emit({ accountId, email, step, status, message });
  }

  private parseDirectProxyList(entries: string[], threadCount: number): BrowserProxySettings[] {
    if (entries.length === 0) return [];

    const parsed: BrowserProxySettings[] = [];
    const badLines: string[] = [];
    const seenRoutes = new Map<string, number>();
    const duplicateLines: string[] = [];

    entries.forEach((entry, index) => {
      const lineNum = index + 1;
      const proxy = parseDirectProxy(entry);
      if (!proxy) {
        badLines.push('dòng ' + lineNum);
        return;
      }
      const routeKey = getDirectProxyRouteKey(proxy);
      if (seenRoutes.has(routeKey)) {
        duplicateLines.push('dòng ' + lineNum + ' (trùng với dòng ' + seenRoutes.get(routeKey) + ')');
      } else {
        seenRoutes.set(routeKey, lineNum);
      }
      parsed.push(proxy);
    });

    if (badLines.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không đọc được ' + badLines.length + ' dòng proxy (' + badLines.join(', ') + '). ' +
          'Định dạng đầy đủ: http://ip:port[:user:pass] hoặc socks5://ip:port[:user:pass] ' +
          '(hỗ trợ cả user:pass@ip:port, scheme: http, https, socks4, socks5). Không chạy tiếp để tránh luồng đi bằng IP thật.'
      );
    }

    if (duplicateLines.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Phát hiện proxy trùng lặp: ' + duplicateLines.join(', ') + '. ' +
          'Mỗi luồng cần proxy riêng biệt, hãy xoá dòng trùng hoặc thay bằng proxy khác.'
      );
    }

    if (parsed.length < threadCount) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Chỉ có ' + parsed.length + ' proxy cho ' + threadCount + ' luồng. ' +
          (threadCount - parsed.length) + ' luồng còn lại sẽ chạy bằng IP thật của máy — ' +
          'thêm proxy hoặc giảm số luồng.'
      );
    }

    return parsed;
  }

  private assertLauncherSupportsConfig(
    config: AutomationRunConfigDTO,
    directProxies: BrowserProxySettings[]
  ): void {
    const launcher = this.deps.launcher?.();
    if (!launcher || launcher.name !== 'xcli') return;

    const authProxy = directProxies.find((proxy) => proxy.username || proxy.password);
    if (authProxy) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Đường mở browser "xcli" chưa hỗ trợ proxy có user/pass, mà danh sách proxy ' +
          'đang có loại đó. Vào Settings đổi "Đường mở profile" sang "api-v3", ' +
          'hoặc dùng proxy xác thực bằng IP.'
      );
    }

    if (config.headless) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Đường mở profile "xcli" không hỗ trợ headless. Đổi sang "api-v3" trước khi chạy.'
      );
    }
  }

  private commitOutcome(thread: ThreadRuntime, outcome: ThreadOutcome, persisted: boolean): void {
    thread.outcome = outcome;
    thread.outcomePersisted = persisted;
    if (outcome.kind === 'completed') this.increment('accountsCompleted');
    if (outcome.kind === 'skipped') this.skippedAccounts += 1;
    if (outcome.kind === 'failed') this.increment('accountsFailed');
    if (outcome.kind === 'stopped') this.increment('accountsStopped');
    this.recordEvidence({
      schemaVersion: 1,
      runId: thread.runId,
      workerAlias: thread.workerAlias,
      accountAlias: thread.accountAlias,
      at: new Date().toISOString(),
      type: 'account-terminal',
      outcome: outcome.kind
    });
  }

  private promotePersistenceFailure(error: AutomationTerminalError): void {
    this.terminalIntent = error.reason;
    this.terminalState = 'failed';
    this.acquisitionAbort?.abort(error);
    this.shutdownAllUiSchedulers({ code: 'RUN_ABORTED', message: error.message });
    for (const controller of this.iterationAbort.values()) controller.abort(error);
    this.publish('failed', error.message, { terminalReason: error.reason });
  }

  private recordOutcome(thread: ThreadRuntime, outcome: ThreadOutcome): void {
    if (thread.outcome) return;

    let writeSucceeded = false;
    let writeError: unknown;
    try {
      const updateResult = this.deps.accounts.update(thread.accountId, {
        status: outcome.status,
        automationStep: outcome.step
      });
      if (updateResult && updateResult.success === true) {
        writeSucceeded = true;
      } else {
        writeError = new Error('Database returned success: false');
      }
    } catch (err) {
      writeError = err;
    }

    if (!writeSucceeded) {
      const cause = writeError instanceof Error ? writeError : new Error(String(writeError ?? 'Unknown database error'));
      const failureOutcome: ThreadOutcome = {
        kind: 'failed',
        status: 'error',
        step: outcome.step
      };

      const termErr = new AutomationTerminalError(
        'failed',
        {
          code: 'INTERNAL_ERROR',
          details: { failure: 'ACCOUNT_TERMINAL_PERSISTENCE_FAILED', persisted: false }
        },
        'Không thể lưu trạng thái kết thúc của tài khoản vào database.',
        cause
      );
      this.terminalPersistenceFailure ??= termErr;
      this.promotePersistenceFailure(this.terminalPersistenceFailure);
      this.commitOutcome(thread, failureOutcome, false);
      return;
    }

    this.commitOutcome(thread, outcome, true);
  }

  private acceptProofPersistenceFailure(error: unknown): AutomationTerminalError {
    const originalCause = error instanceof AutomationTerminalError && error.cause
      ? error.cause
      : error instanceof Error
        ? error
        : new Error('UNKNOWN_PROOF_PERSISTENCE_CAUSE');

    const failure = new AutomationTerminalError(
      'failed',
      {
        code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED',
        details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' }
      },
      'Không lưu được bằng chứng nhiệm vụ đã được xác nhận.',
      originalCause
    );
    this.proofPersistenceFailure ??= failure;
    return this.proofPersistenceFailure;
  }

  private acceptTerminalError(error: unknown): void {
    if (this.terminalIntent) return;

    if (error instanceof AutomationTerminalError) {
      this.terminalIntent = error.reason;
      this.terminalState = error.state;
      this.acquisitionAbort?.abort(error);
      if (error.state === 'failed') {
        this.shutdownAllUiSchedulers({ code: 'RUN_ABORTED', message: error.message });
        for (const controller of this.iterationAbort.values()) {
          controller.abort(error);
        }
      }
      this.publish(error.state, error.message, { terminalReason: error.reason });
      return;
    }

    if (error instanceof ProviderError) {
      let code: AutomationTerminalCode;
      if (error.code === 'AUTH_ERROR') code = 'PROVIDER_AUTH_REQUIRED';
      else if (error.code === 'CONFIG_ERROR') code = 'PROVIDER_CONFIG_ERROR';
      else if (error.code === 'INSUFFICIENT_FUNDS') code = 'INSUFFICIENT_FUNDS';
      else code = 'PROVIDER_RETRY_EXHAUSTED';
      const reason: AutomationTerminalReasonDTO = {
        code,
        ...(error.serviceName ? { provider: error.serviceName } : {})
      };
      this.terminalIntent = reason;
      this.terminalState = 'blocked';
      this.acquisitionAbort?.abort(error);
      this.publish('blocked', error.message, { terminalReason: reason });
      return;
    }

    const message = error instanceof Error ? error.message : 'Lỗi không xác định.';
    const reason: AutomationTerminalReasonDTO = { code: 'INTERNAL_ERROR' };
    this.terminalIntent = reason;
    this.terminalState = 'failed';
    this.acquisitionAbort?.abort(error);
    for (const controller of this.iterationAbort.values()) {
      controller.abort(error);
    }
    this.publish('failed', message, { terminalReason: reason });
  }

  private startProfileStop(
    thread: ThreadRuntime,
    session: BrowserSessionRuntime,
    profileId: string
  ): Promise<boolean> {
    if (session.profileStopPromise) return session.profileStopPromise;
    const stopOp = (async (): Promise<boolean> => {
      try {
        await this.observe({
          runId: thread.runId,
          workerAlias: thread.workerAlias,
          accountAlias: thread.accountAlias,
          sessionAlias: session.alias,
          provider: session.provider ?? 'multilogin',
          operation: 'profile-stop'
        }, () => session.launcher
          ? session.launcher.stop(profileId, {
              onPhase: (obs) => {
                if (session.stopOutcomeLocked) return;
                session.stopPhase = obs.phase;
                if (obs.remoteConfirmed) session.remoteConfirmed = true;
              }
            })
          : this.deps.browser.stopProfile(profileId));
        if (!session.stopOutcomeLocked) session.stopFailed = false;
        return true;
      } catch (error: unknown) {
        if (session.stopOutcomeLocked) return false;
        session.stopFailed = true;
        session.stopCause = error;
        if (error instanceof ProfileStopError) {
          session.stopDiagnostic = error.diagnostic;
          const { phase, kind, providerCode, httpStatus } = error.diagnostic;
          this.log(
            'WARNING',
            thread.workerAlias,
            thread.accountAlias,
            `Dừng profile thất bại ở phase "${phase}" (${kind}${providerCode ? `, code=${providerCode}` : ''}${httpStatus !== undefined ? `, status=${httpStatus}` : ''}).`
          );
        } else {
          this.log(
            'WARNING',
            thread.workerAlias,
            thread.accountAlias,
            `Dừng profile thất bại: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return false;
      }
    })();
    stopOp.catch(() => {});
    session.profileStopPromise = stopOp;
    return stopOp;
  }

  private stopSession(thread: ThreadRuntime, session: BrowserSessionRuntime): Promise<boolean> {
    session.stopRequested = true;
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = this.stopSessionWhenOwnershipSettles(thread, session);
    return session.stopPromise;
  }

  private async stopSessionWhenOwnershipSettles(
    thread: ThreadRuntime,
    session: BrowserSessionRuntime
  ): Promise<boolean> {
    session.stopRequested = true;

    // 1. Wait for launch to settle or profileId to appear (bounded by sessionLaunchStopGraceMs)
    if (!session.profileId && session.launchPromise) {
      try {
        const launchSettled = session.launchPromise.catch(() => {});
        await withTimeout(
          launchSettled,
          this.sessionLaunchStopGraceMs,
          new Error('Launch stop grace timeout')
        );
      } catch {
        return this.handleStopFailure(thread, session, 'Hết hạn chờ khởi chạy browser khi dừng.');
      }
    }

    // If after launch settled, no profile was ever started
    if (!session.profileId) {
      if (session.scheduler) {
        this.retireUiScheduler(session.alias, session.scheduler);
      }
      if (thread.session === session) {
        thread.session = undefined;
      }
      return true;
    }

    // 2. We have a profileId. Start profile stop if not already started.
    const profileId = session.profileId;
    const stopOp = this.startProfileStop(thread, session, profileId);

    // 3. Await profile stop with profileStopTimeoutMs
    let stopSuccess = false;
    try {
      stopSuccess = await withTimeout(
        stopOp,
        this.profileStopTimeoutMs,
        new Error('Profile stop timeout')
      );
    } catch (timeoutError) {
      stopSuccess = false;
      if (!session.stopCause) {
        session.stopCause = timeoutError;
      }
      if (!session.stopDiagnostic) {
        session.stopDiagnostic = {
          phase: session.stopPhase ?? 'unknown',
          kind: 'deadline',
          remoteConfirmed: session.remoteConfirmed === true
        };
      }
    }

    if (stopSuccess) {
      session.stopFailed = false;
      session.scheduler?.confirmProfileStopped(session.alias);
      this.recordEvidence({
          schemaVersion: 1,
          runId: thread.runId,
          workerAlias: thread.workerAlias,
          sessionAlias: session.alias,
          accountAlias: thread.accountAlias,
          at: new Date().toISOString(),
          type: 'profile-stop',
          outcome: 'confirmed'
        });
      this.activeProfileCount = Math.max(0, this.activeProfileCount - 1);
      this.recordResourceSnapshot();
      if (thread.session === session) {
        thread.session = undefined;
      }
      if (session.scheduler) {
        this.retireUiScheduler(session.alias, session.scheduler);
      }
      return true;
    }

    return this.handleStopFailure(
      thread,
      session,
      'Không dừng được browser profile trong lúc thu hồi tài nguyên.'
    );
  }

  private handleStopFailure(
    thread: ThreadRuntime,
    session: BrowserSessionRuntime,
    message: string
  ): boolean {
    session.stopFailed = true;
    session.stopOutcomeLocked = true;
    this.noteCleanupFailure(thread, 'browser-profile');
    this.recordEvidence({
        schemaVersion: 1,
        runId: thread.runId,
        workerAlias: thread.workerAlias,
        sessionAlias: session.alias,
        accountAlias: thread.accountAlias,
        at: new Date().toISOString(),
        type: 'profile-stop',
        outcome: 'failed',
        code: 'RESOURCE_CLEANUP_FAILED'
      });

    const terminalError = new AutomationTerminalError(
      'failed',
      {
        code: 'RESOURCE_CLEANUP_FAILED',
        details: { cleanupFailures: this.cleanupFailures }
      },
      message
    );

    this.shutdownAllUiSchedulers({
      code: 'RESOURCE_CLEANUP_FAILED',
      message
    });

    for (const controller of this.iterationAbort.values()) {
      controller.abort(terminalError);
    }
    this.acceptTerminalError(terminalError);

    return false;
  }

  private noteCleanupFailure(
    thread: ThreadRuntime | undefined,
    resource: 'browser-profile' | 'proxy-lease' | 'mailbox-reservation'
  ): void {
    this.cleanupFailures += 1;
    this.log(
      'WARNING',
      thread?.email ?? 'system',
      'Cleanup',
      'Không thu hồi được tài nguyên: ' + resource + '.',
      thread?.accountId
    );
  }

  private async cleanupIteration(
    source: AutomationWorkSource,
    item: AutomationWorkItem | null,
    committed: boolean,
    thread: ThreadRuntime | undefined,
    lease: AcquiredProxyLease | undefined,
    acquisitionIdentity?: Readonly<ObservationIdentity>,
    directProxy?: BrowserProxySettings,
    directProxyPool?: DirectProxyPool
  ): Promise<void> {
    const cleanupSessionAlias = thread?.session?.alias ?? 'unassigned';
    if (item && item.kind === 'new' && !committed) {
      try {
        source.release(item);
        if (this.activeMailReservationCount > 0) {
          this.activeMailReservationCount -= 1;
          this.recordResourceSnapshot();
        }
      } catch {
        this.noteCleanupFailure(thread, 'mailbox-reservation');
      }
    }

    let stopSuccess = true;
    if (thread) {
      if (thread.session) {
        stopSuccess = await this.stopSession(thread, thread.session);
      }
      if (!thread.session) {
        this.activeThreads.delete(thread.accountId);
      }
      this.iterationAbort.delete(thread.accountId);
    }

    if (!stopSuccess || Boolean(thread?.session)) {
      return;
    }

    if (thread?.routeReleased) {
      return;
    }
    if (thread) {
      thread.routeReleased = true;
    }

    if (lease) {
      try {
        const cleanupIdentity = thread
          ? {
              runId: thread.runId,
              workerAlias: thread.workerAlias,
              accountAlias: thread.accountAlias,
              sessionAlias: cleanupSessionAlias,
              provider: 'kiotproxy',
              operation: 'proxy-release'
            } as const
          : {
              ...(acquisitionIdentity ?? {
                runId: this.progress.runId,
                workerAlias: null,
                acquisitionAlias: null,
                accountAlias: null,
                sessionAlias: null,
                authorityRef: 'cleanup'
              }),
              provider: 'kiotproxy',
              operation: 'proxy-release'
            } as const;
        await this.observe(cleanupIdentity, () => this.deps.proxies.release(lease));
        this.activeProxyCount = Math.max(0, this.activeProxyCount - 1);
        this.recordResourceSnapshot();
        if (thread) {
          thread.routeReleased = true;
        }
      } catch {
        this.noteCleanupFailure(thread, 'proxy-lease');
      }
    } else {
      const proxyToRelease = directProxy ?? thread?.directProxy;
      if (proxyToRelease && directProxyPool) {
        directProxyPool.release(proxyToRelease);
        this.activeProxyCount = Math.max(0, this.activeProxyCount - 1);
        this.recordResourceSnapshot();
        if (thread) {
          thread.routeReleased = true;
        }
      } else if (thread?.directProxy) {
        this.activeProxyCount = Math.max(0, this.activeProxyCount - 1);
        this.recordResourceSnapshot();
        if (thread) {
          thread.routeReleased = true;
        }
      }
    }
  }

  private createThreadRecord(
    item: AutomationWorkItem,
    config: AutomationRunConfigDTO,
    slotProxy: BrowserProxySettings | undefined,
    lease: AcquiredProxyLease | undefined,
    runId: string,
    workerAlias: string
  ): ThreadRuntime {
    let accountId: string;
    let capcutPassword: string;
    const isExistingAccount = item.kind === 'existing' || item.kind === 'pasted-existing';

    if (item.kind === 'existing') {
      accountId = item.accountId;
      capcutPassword = item.capcutPassword;
      const updateResult = this.deps.accounts.update(accountId, {
        status: 'processing',
        automationStep: config.missionTransport === 'http-only'
          ? 'Đang khởi chạy HTTP-only'
          : 'Đang khởi chạy browser',
        ...(config.missionTransport === 'http-only' ? {} : { browserProvider: config.browser })
      });
      if (!updateResult || updateResult.success !== true) {
        throw new Error(`Không thể cập nhật trạng thái tài khoản ${accountId} trong database.`);
      }
    } else if (item.kind === 'pasted-existing') {
      capcutPassword = item.capcutPassword;
      const matches = this.deps.accounts.findByEmail
        ? this.deps.accounts.findByEmail(item.email)
        : [];
      if (matches.length > 1) {
        throw new Error(
          `Tài khoản ${item.email} (dòng ${item.line}) trùng với ${matches.length} bản ghi trong cơ sở dữ liệu.`
        );
      }
      if (matches.length === 1) {
        const candidate = matches[0];
        if (this.isAccountActive(candidate.id)) {
          throw new Error(
            `Tài khoản ${item.email} (dòng ${item.line}) hiện đang được xử lý bởi một tác vụ khác.`
          );
        }
        accountId = candidate.id;
        const updateResult = this.deps.accounts.update(accountId, {
          status: 'processing',
          automationStep: config.missionTransport === 'http-only'
            ? 'Đang khởi chạy HTTP-only'
            : 'Đang khởi chạy browser',
          ...(config.missionTransport === 'http-only' ? {} : { browserProvider: config.browser })
        });
        if (!updateResult || updateResult.success !== true) {
          throw new Error(`Không thể cập nhật trạng thái tài khoản ${accountId} trong database.`);
        }
      } else {
        const created = this.deps.accounts.create({
          email: item.email,
          emailProvider: 'manual',
          passwordCapcut: item.capcutPassword,
          credit: 0,
          status: 'processing',
          automationStep: config.missionTransport === 'http-only'
            ? 'Đang khởi chạy HTTP-only'
            : 'Đang khởi chạy browser',
          ...(config.missionTransport === 'http-only' ? {} : { browserProvider: config.browser })
        });
        accountId = created.id;
      }
    } else {
      capcutPassword = generateCapcutPassword(config.password);
      const created = this.deps.accounts.create({
        email: item.email,
        emailProvider: item.emailProvider,
        emailPassword: item.emailPassword,
        passwordCapcut: capcutPassword,
        credit: 0,
        status: 'processing',
        automationStep: config.missionTransport === 'http-only'
          ? 'Đang khởi chạy HTTP-only'
          : 'Đang khởi chạy browser',
        ...(config.missionTransport === 'http-only' ? {} : { browserProvider: config.browser })
      });
      accountId = created.id;
    }

    const threadController = new AbortController();
    this.iterationAbort.set(accountId, threadController);

    const token = {};
    this.iterationOwners.set(accountId, token);
    let notifyDone: () => void = () => {};
    const completionPromise = new Promise<void>((resolve) => {
      notifyDone = () => {
        if (this.iterationOwners.get(accountId) === token) {
          this.iterationOwners.delete(accountId);
        }
        resolve();
      };
    });

    const runtime: ThreadRuntime = {
      runId,
      workerAlias,
      accountAlias: `account-${++this.accountSequence}`,
      accountId,
      email: item.email,
      emailProvider: item.emailProvider,
      capcutPassword,
      isExistingAccount,
      purchasedEmailId: item.kind === 'new' ? item.purchasedEmailId : undefined,
      lease,
      directProxy: slotProxy,
      sessionSequence: 0,
      sessionRecycleCount: 0,
      completionPromise,
      notifyDone,
      ownerToken: token,
      acceptedProofWrites: new Map<string, Promise<void>>()
    };
    return runtime;
  }

  private async launchSession(
    thread: ThreadRuntime,
    session: BrowserSessionRuntime,
    config: AutomationRunConfigDTO,
    signal: AbortSignal
  ): Promise<void> {
    const proxy = thread.lease ? leaseToProxySettings(thread.lease) : thread.directProxy;
    const launcher = config.browser === 'multilogin' ? this.deps.launcher?.() ?? null : null;

    const launchOp = (async () => {
      if (launcher) {
        session.launcher = launcher;
        const started = await this.observe({
          runId: thread.runId,
          workerAlias: thread.workerAlias,
          accountAlias: thread.accountAlias,
          sessionAlias: session.alias,
          provider: 'multilogin',
          operation: 'profile-launch'
        }, () => launcher.launch({
          proxy: toLauncherProxy(proxy),
          headless: config.headless,
          signal,
          ui: session.ui,
          onProfileStarted: (profileId: string) => {
            session.profileId = profileId;
            if (!this.startedProfiles.includes(profileId)) {
              this.startedProfiles.push(profileId);
            }
            if (!session.profileStartRecorded) {
              session.profileStartRecorded = true;
              this.activeProfileCount += 1;
              this.recordEvidence({
                schemaVersion: 1, runId: thread.runId, workerAlias: thread.workerAlias,
                sessionAlias: session.alias, accountAlias: thread.accountAlias,
                at: new Date().toISOString(), type: 'profile-start'
              });
              this.recordResourceSnapshot();
            }
            if (session.stopRequested) {
              void this.startProfileStop(thread, session, profileId);
            }
          }
        }));
        if (session.stopRequested) {
          if (started.profileId) {
            session.profileId = started.profileId;
            void this.startProfileStop(thread, session, started.profileId);
          }
          return;
        }
        session.profileId = started.profileId;
        session.port = started.port;
        session.page = started.page;
        session.context = started.context;
        if (started.profileId && !this.startedProfiles.includes(started.profileId)) {
          this.startedProfiles.push(started.profileId);
        }
      } else {
        const started = await this.observe({
          runId: thread.runId,
          workerAlias: thread.workerAlias,
          accountAlias: thread.accountAlias,
          sessionAlias: session.alias,
          provider: config.browser,
          operation: 'profile-launch'
        }, () => this.deps.browser.startProfile({
          headless: config.headless,
          proxy,
          browser: config.browser,
          signal,
          onProfileStarted: (profileId: string) => {
            session.profileId = profileId;
            if (!this.startedProfiles.includes(profileId)) {
              this.startedProfiles.push(profileId);
            }
            if (!session.profileStartRecorded) {
              session.profileStartRecorded = true;
              this.activeProfileCount += 1;
              this.recordEvidence({
                schemaVersion: 1, runId: thread.runId, workerAlias: thread.workerAlias,
                sessionAlias: session.alias, accountAlias: thread.accountAlias,
                at: new Date().toISOString(), type: 'profile-start'
              });
              this.recordResourceSnapshot();
            }
            if (session.stopRequested) {
              void this.startProfileStop(thread, session, profileId);
            }
          }
        }));
        if (session.stopRequested) {
          if (started.profileId) {
            session.profileId = started.profileId;
            void this.startProfileStop(thread, session, started.profileId);
          }
          return;
        }
        session.profileId = started.profileId;
        session.port = started.port;
        if (started.profileId && !this.startedProfiles.includes(started.profileId)) {
          this.startedProfiles.push(started.profileId);
        }
      }
    })();

    launchOp.catch(() => {});
    session.launchPromise = launchOp;

    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      await Promise.race([launchOp, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }

    signal.throwIfAborted();
    if (session.stopRequested) {
      throw signal.reason ?? new Error('Stop requested before launch finished');
    }

    if (session.profileId) {
      this.deps.accounts.update(thread.accountId, {
        status: 'processing',
        automationStep: 'Browser đang chạy',
        browserProfileId: session.profileId,
        proxy: proxy ? proxy.host + ':' + proxy.port : null
      });
      this.publish(this.progress.state, this.progress.message);
      this.log(
        'SUCCESS',
        thread.email,
        'Browser',
        'Đã mở ' + config.browser + ' profile ' + session.profileId +
          (session.port !== null && session.port !== undefined ? ' (port ' + session.port + ')' : ''),
        thread.accountId
      );
    }
  }

  private async holdForThread(
    durationMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (durationMs <= 0) {
      signal.throwIfAborted();
      return;
    }
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(durationMs), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private buildOtpReader(thread: ThreadRuntime, signal: AbortSignal): (() => Promise<string>) | undefined {
    const purchasedEmailId = thread.purchasedEmailId;
    if (!purchasedEmailId) return undefined;

    return async () => {
      const startedAt = Date.now();
      const deadline = startedAt + OTP_WAIT_MS;
      const waited = (): string => String(Math.round((Date.now() - startedAt) / 1000)) + 's';
      const say = (
        status: 'INFO' | 'SUCCESS' | 'WARNING',
        message: string
      ): void => this.log(status, thread.email, 'OTP', message, thread.accountId);

      let lastError = '';
      let attempt = 0;

      say('INFO', 'Đang chờ mã xác minh CapCut về hộp thư đã thuê...');

      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        attempt += 1;
        try {
          const code = await this.observe({
            runId: thread.runId,
            workerAlias: thread.workerAlias,
            accountAlias: thread.accountAlias,
            sessionAlias: thread.session?.alias ?? 'unassigned',
            provider: thread.emailProvider,
            operation: 'read-otp'
          }, () => {
            const readPromise = this.deps.emailOtp.readOtp(purchasedEmailId);
            const currentRemaining = deadline - Date.now();
            return withinDeadline(
              readPromise,
              Math.max(0, currentRemaining),
              signal
            );
          });
          signal.throwIfAborted();
          if (Date.now() >= deadline) break;
          if (code) {
            say('SUCCESS', 'Đã nhận mã xác minh sau ' + waited() + ' (' + attempt + ' lượt đọc)');
            return code;
          }
          say('INFO', 'Chưa có mã sau ' + waited() + ', đọc lại sau 5 giây');
        } catch (err: unknown) {
          signal.throwIfAborted();
          lastError = err instanceof Error ? err.message : String(err);
          say('WARNING', 'Đọc mã thất bại ở lượt ' + attempt + ': ' + lastError);
        }
        const remainingAfter = deadline - Date.now();
        if (remainingAfter <= 0) break;
        await this.holdForThread(Math.min(5_000, remainingAfter), signal);
      }

      throw new Error(
        'Không lấy được OTP cho ' + thread.email + ' sau ' + Math.round(OTP_WAIT_MS / 1000) +
          ' giây' + (lastError ? ': ' + lastError : '')
      );
    };
  }

  private recordTaskProgress(thread: ThreadRuntime, rows: CapcutAccountResult['tasks']): void {
    const sink = this.deps.taskProgress;
    if (!sink?.recordLegacy || rows.length === 0) return;

    try {
      sink.recordLegacy(thread.accountId, rows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi ghi DB.';
      this.log(
        'WARNING',
        thread.email,
        'Nhiệm vụ',
        'Không lưu được tiến độ nhiệm vụ vào cơ sở dữ liệu: ' + message,
        thread.accountId
      );
    }
  }

  private async launchThreadSession(
    thread: ThreadRuntime,
    config: AutomationRunConfigDTO,
    signal: AbortSignal
  ): Promise<BrowserSessionRuntime> {
    const sequence = (this.sessionSequences.get(thread.workerAlias) ?? 0) + 1;
    this.sessionSequences.set(thread.workerAlias, sequence);
    thread.sessionSequence = sequence;
    const alias = `${thread.workerAlias}-session-${sequence}`;
    const scheduler = !config.headless && (config.missionTransport ?? 'ui') !== 'http-only'
      ? this.createUiScheduler(thread.runId)
      : undefined;
    if (scheduler) this.uiSchedulers.set(alias, scheduler);
    const identity = { sessionAlias: alias, signal, focusMode: 'target' as const };
    const session: BrowserSessionRuntime = {
      alias,
      provider: config.browser,
      startedAt: Date.now(),
      stopRequested: false,
      ui: scheduler ? scheduler.forSession(identity) : createDirectUiInteraction(signal),
      scheduler
    };
    thread.session = session;
    this.activeThreads.set(thread.accountId, thread);

    await measureStage(
      'browser-launch',
      () => this.launchSession(thread, session, config, signal),
      (message) => this.log('INFO', thread.email, 'Timing', message, thread.accountId)
    );
    return session;
  }

  private assertProofOwner(thread: ThreadRuntime): void {
    if (this.iterationOwners.get(thread.accountId) !== thread.ownerToken) {
      throw new Error('STALE_ACK_PROOF_OWNER');
    }
  }

  private async persistAcceptedProofs(
    thread: ThreadRuntime,
    proofs: readonly UnsettledTaskProof[]
  ): Promise<void> {
    this.assertProofOwner(thread);
    const sink = this.deps.taskProgress;
    if (!sink || typeof sink.recordUnsettled !== 'function') {
      const err = new AutomationTerminalError(
        'failed',
        {
          code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED',
          details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' }
        },
        'Không lưu được bằng chứng nhiệm vụ đã được xác nhận.'
      );
      this.acceptProofPersistenceFailure(err);
      throw err;
    }

    const writes: Promise<void>[] = [];
    for (const item of proofs) {
      const key = JSON.stringify([item.key, item.proof.opId, item.proof.at]);
      let write = thread.acceptedProofWrites.get(key);
      if (!write) {
        const copy = structuredClone(item);
        write = Promise.resolve().then(async () => {
          this.assertProofOwner(thread);
          try {
            if (sink?.recordUnsettled) {
              await sink.recordUnsettled(thread.accountId, thread.runId, [copy]);
            }
          } catch (error: unknown) {
            const terminalErr = this.acceptProofPersistenceFailure(error);
            throw terminalErr;
          }
        });
        thread.acceptedProofWrites.set(key, write);
      }
      writes.push(write);
    }
    const settled = await Promise.allSettled(writes);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (rejected) throw rejected.reason;
  }

  private async runUiSessionAttempt(
    thread: ThreadRuntime,
    session: BrowserSessionRuntime,
    config: AutomationRunConfigDTO,
    signal: AbortSignal,
    authAttempt: CapcutAuthAttempt,
    unsettledProofs: readonly UnsettledTaskProof[]
  ): Promise<CapcutUiAccountResult> {
    const uiRunner = this.deps.capcut;
    if (!uiRunner || !session.page || !session.context) {
      throw new Error('UI runner or browser session pages are not available');
    }
    const password = thread.capcutPassword;
    if (!password) {
      throw new Error('CapCut password is not available');
    }

    let invocationOpen = true;
    const invocationWrites = new Set<Promise<void>>();
    const ownWrite = (operation: Promise<void>): Promise<void> => {
      invocationWrites.add(operation);
      void operation.catch(() => undefined);
      return operation;
    };

    const assertInvocation = (): void => {
      if (!invocationOpen) throw new Error('INVOCATION_CLOSED');
      this.assertProofOwner(thread);
      if (thread.session !== session) throw new Error('STALE_CHECKPOINT_SESSION');
    };

    const onAcceptedProof = (proof: UnsettledTaskProof): Promise<void> => {
      return ownWrite(
        (async () => {
          assertInvocation();
          await this.persistAcceptedProofs(thread, [proof]);
        })()
      );
    };

    const onTaskCheckpoint = (checkpoint: {
      rows: CapcutAccountResult['tasks'];
      receipt: CapcutVerificationReceipt;
      unsettledProofs: readonly UnsettledTaskProof[];
    }): Promise<void> => {
      return ownWrite(
        (async () => {
          assertInvocation();
          if (this.deps.taskProgress) {
            await this.deps.taskProgress.record(thread.accountId, checkpoint);
            if (checkpoint.unsettledProofs) {
              for (const item of checkpoint.unsettledProofs) {
                const key = JSON.stringify([item.key, item.proof.opId, item.proof.at]);
                thread.acceptedProofWrites.set(key, Promise.resolve());
              }
            }
            for (const row of checkpoint.rows) {
              if (!row.opId || !row.provedAt) continue;
              const at = Date.parse(row.provedAt);
              if (!Number.isFinite(at)) continue;
              const key = JSON.stringify([row.key, row.opId, at]);
              if (!thread.acceptedProofWrites.has(key)) {
                thread.acceptedProofWrites.set(key, Promise.resolve());
              }
            }
          }

          if (this.telemetry) {
            this.recordEvidence({
              schemaVersion: 1,
              runId: thread.runId,
              workerAlias: thread.workerAlias,
              sessionAlias: session.alias,
              accountAlias: thread.accountAlias,
              at: new Date().toISOString(),
              type: 'task-checkpoint',
              fresh: checkpoint.receipt.fresh,
              final: checkpoint.receipt.final,
              observedAt: checkpoint.receipt.observedAt,
              requiredAfter: checkpoint.receipt.requiredAfter,
              serverTotal: checkpoint.receipt.serverTotal,
              serverDone: checkpoint.receipt.serverDone,
              tasks: checkpoint.rows.map((row) => ({
                key: EvidenceTaskKeySchema.parse(row.key),
                status: row.status
              }))
            });
          }
        })()
      );
    };

    let runnerError: unknown = null;
    let result: CapcutUiAccountResult | undefined;
    try {
      result = await uiRunner.runAccount({
        page: session.page,
        context: session.context,
        email: thread.email,
        password,
        accountId: thread.accountId,
        isNewAccount: (authAttempt === 'existing-only' || thread.isExistingAccount) ? false : thread.purchasedEmailId !== undefined,
        authAttempt,
        runId: thread.runId,
        sessionAlias: session.alias,
        sessionStartedAt: session.startedAt,
        signal,
        ui: session.ui,
        getOtp: (authAttempt === 'existing-only' || thread.isExistingAccount) ? undefined : this.buildOtpReader(thread, signal),
        maxRounds: Math.max(1, Math.min(1 + config.retryCount, 4)),
        pace: {
          stepMinMs: config.stepDelayMinMs,
          stepMaxMs: config.stepDelayMaxMs,
          typeMinMs: config.typeDelayMinMs,
          typeMaxMs: config.typeDelayMaxMs
        },
        skipWithoutTrial: config.skipWithoutTrial,
        unsettledProofs,
        onAcceptedProof,
        onTaskCheckpoint,
        isExpectedClose: () => session.stopRequested,
        log: (status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', step: string, message: string) =>
          this.log(status, thread.email, step, message, thread.accountId)
      });
    } catch (err: unknown) {
      runnerError = err;
    } finally {
      invocationOpen = false;
      const allWrites = Array.from(
        new Set([...invocationWrites, ...thread.acceptedProofWrites.values()])
      );
      const settled = await Promise.allSettled(allWrites);
      const drainRejected = settled.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (drainRejected) {
        if (
          !runnerError ||
          !(runnerError instanceof AutomationTerminalError && runnerError.state === 'failed')
        ) {
          runnerError = drainRejected.reason;
        }
      }
    }
    if (runnerError) {
      throw runnerError;
    }
    return result!;
  }

  private deriveStopMessage(signal?: AbortSignal, err?: unknown): string {
    const rawReason = signal?.reason ?? (err instanceof AutomationTerminalError ? err.reason : (err instanceof Error ? err : undefined));
    let code: string | undefined;

    if (rawReason instanceof AutomationTerminalError) {
      code = rawReason.reason.code;
    } else if (rawReason && typeof rawReason === 'object' && 'code' in rawReason && typeof (rawReason as { code?: unknown }).code === 'string') {
      code = (rawReason as { code: string }).code;
    } else if (rawReason instanceof Error) {
      if (rawReason.message === 'USER_STOP' || rawReason.message === 'stopThread requested') {
        code = 'USER_STOP';
      } else if (rawReason.message === 'APP_SHUTDOWN') {
        code = 'APP_SHUTDOWN';
      } else if (rawReason.message === 'RESOURCE_CLEANUP_FAILED') {
        code = 'RESOURCE_CLEANUP_FAILED';
      } else if ('code' in rawReason && typeof (rawReason as { code?: unknown }).code === 'string') {
        code = (rawReason as { code: string }).code;
      }
    }

    if (!code && this.runAbort?.signal.reason) {
      const runReason = this.runAbort.signal.reason;
      if (runReason instanceof AutomationTerminalError) {
        code = runReason.reason.code;
      } else if (runReason instanceof Error) {
        if (runReason.message === 'USER_STOP') code = 'USER_STOP';
        else if (runReason.message === 'APP_SHUTDOWN') code = 'APP_SHUTDOWN';
        else if ('code' in runReason && typeof (runReason as { code?: unknown }).code === 'string') {
          code = (runReason as { code: string }).code;
        }
      }
    }

    if (!code && this.terminalIntent?.code) {
      code = this.terminalIntent.code;
    }

    return systemStopMessage(code);
  }

  private classifyUiResult(
    thread: ThreadRuntime,
    result: CapcutAccountResult | CapcutUiAccountResult,
    config: AutomationRunConfigDTO
  ): ThreadOutcome {
    if (result.fatalError) {
      this.log('ERROR', thread.email, 'Nhiệm vụ', result.fatalError, thread.accountId);
      thread.outcomeStep = 'Lỗi khi làm nhiệm vụ: ' + result.fatalError;
      this.deps.accounts.update(thread.accountId, {
        automationStep: thread.outcomeStep,
        ...(result.credits !== undefined ? { credit: result.credits } : {}),
        ...(result.subscription ? { subscription: result.subscription } : {})
      });
      return { kind: 'failed', status: 'error', step: thread.outcomeStep };
    }

    if (result.skipped) {
      thread.outcomeStep = 'Bỏ qua — không đủ điều kiện';
      this.deps.accounts.update(thread.accountId, {
        automationStep: thread.outcomeStep,
        ...(result.subscription ? { subscription: result.subscription } : {})
      });
      return {
        kind: (config.missionTransport ?? 'ui') === 'http-only' ? 'completed' : 'skipped',
        status: 'done',
        step: thread.outcomeStep
      };
    }

    const uiResult = result as Partial<CapcutUiAccountResult>;
    const missionTransport = config.missionTransport ?? 'ui';
    if (missionTransport === 'http-only') {
      this.recordTaskProgress(thread, result.tasks);
    }
    const full = missionTransport === 'http-only'
      ? result.missing.length === 0
      : Boolean(
          uiResult.verification &&
          uiResult.verification.complete &&
          uiResult.verification.fresh &&
          uiResult.verification.final &&
          uiResult.verification.serverTotal > 0 &&
          result.tasks.length > 0
        );
    thread.outcomeStep = full
      ? 'Đủ ' + result.done + '/' + result.total + ' nhiệm vụ'
      : 'Còn thiếu ' + result.missing.length + ' nhiệm vụ';

    this.deps.accounts.update(thread.accountId, {
      credit: result.credits,
      automationStep: thread.outcomeStep,
      ...(result.subscription ? { subscription: result.subscription } : {})
    });

    this.log(
      full ? 'SUCCESS' : 'WARNING',
      thread.email,
      'Nhiệm vụ',
      'CapCut ghi nhận: ' + result.done + '/' + result.total + ' nhiệm vụ, ' +
        result.credits + '/' + result.creditsTotal + ' credits' +
        (full ? '' : ' — còn thiếu: ' + result.missing.join(', ')),
      thread.accountId
    );

    if (!full) {
      return {
        kind: 'failed',
        status: 'error',
        step: thread.outcomeStep
      };
    }

    return {
      kind: 'completed',
      status: 'done',
      step: thread.outcomeStep
    };
  }

  private async runThreadWorkload(
    thread: ThreadRuntime,
    config: AutomationRunConfigDTO,
    iterationSignal: AbortSignal
  ): Promise<ThreadOutcome> {
    if (config.module !== 'credit') {
      this.log(
        'WARNING',
        thread.email,
        'Nhiệm vụ',
        'Module "' + config.module + '" chưa được implement — chỉ "credit" có engine. ' +
          'Giữ browser để kiểm tra kết nối rồi dừng, không chạy nhiệm vụ nào.',
        thread.accountId
      );
      this.deps.accounts.update(thread.accountId, {
        automationStep: 'Module ' + config.module + ' chưa hỗ trợ'
      });
      await this.holdForThread(config.testDurationMs, iterationSignal);
      return { kind: 'completed', status: 'done', step: thread.outcomeStep ?? 'Hoàn tất' };
    }

    const session = thread.session;
    const uiRunner = this.deps.capcut;
    if (config.missionTransport !== 'http-only' && (!uiRunner || !session?.page || !session?.context)) {
      return { kind: 'failed', status: 'error', step: 'Thiếu UI runner hoặc browser session' };
    }

    const password = thread.capcutPassword;
    if (!password) {
      if (config.missionTransport === 'http-only') {
        this.log(
          'ERROR',
          thread.email,
          'Nhiệm vụ',
          'HTTP-only thiếu mật khẩu account; dừng trước khi gửi request.',
          thread.accountId
        );
        return { kind: 'failed', status: 'error', step: 'HTTP-only thiếu mật khẩu account' };
      }
      this.log(
        'WARNING',
        thread.email,
        'Nhiệm vụ',
        'Không đọc được mật khẩu CapCut của account — giữ browser thay vì làm nhiệm vụ.',
        thread.accountId
      );
      return { kind: 'failed', status: 'error', step: 'Thiếu mật khẩu CapCut' };
    }

    this.deps.accounts.update(thread.accountId, { automationStep: 'Đang làm nhiệm vụ' });
    this.publish(this.progress.state, this.progress.message);
    try {
      if (config.missionTransport === 'http-only') {
        const httpRunner = this.deps.httpOnlyRunner;
        if (!httpRunner) throw new Error('HTTP-only account runner ownership was lost.');
        const proxy = thread.lease ? leaseToProxySettings(thread.lease) : thread.directProxy;
        const result = await httpRunner.runAccount({
          email: thread.email,
          password,
          accountId: thread.accountId,
          isNewAccount: thread.isExistingAccount ? false : thread.purchasedEmailId !== undefined,
          signal: iterationSignal,
          getOtp: thread.isExistingAccount ? undefined : this.buildOtpReader(thread, iterationSignal),
          proxy: toHttpOnlyProxy(proxy),
          onTaskProgress: (rows) => {
            if (this.activeThreads.get(thread.accountId) !== thread) return;
            this.recordTaskProgress(thread, rows);
          },
          log: (status, step, message) =>
            this.log(status, thread.email, step, message, thread.accountId)
        });
        if (result.total <= 0 || result.tasks.length === 0) {
          throw new Error('HTTP_TASKS_UNAVAILABLE');
        }
        return this.classifyUiResult(thread, result, config);
      }

      let authAttempt: CapcutAuthAttempt = thread.isExistingAccount ? 'existing-only' : 'initial';
      let carriedUnsettledProofs: readonly UnsettledTaskProof[] = [];

      while (true) {
        const currentSession = thread.session;
        if (!currentSession) {
          throw new Error('Thread session is missing during UI workload execution');
        }

        let result: CapcutUiAccountResult;
        try {
          result = await this.runUiSessionAttempt(
            thread,
            currentSession,
            config,
            iterationSignal,
            authAttempt,
            carriedUnsettledProofs
          );
        } catch (error: unknown) {
          if (
            error instanceof AutomationTerminalError &&
            error.reason.code === 'TASK_CHECKPOINT_PERSISTENCE_FAILED'
          ) {
            const proofErr = this.acceptProofPersistenceFailure(error);
            this.recordEvidence({
                schemaVersion: 1,
                runId: thread.runId,
                workerAlias: thread.workerAlias,
                sessionAlias: currentSession.alias,
                at: new Date().toISOString(),
                type: 'persistence-failure',
                code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED'
              });
            await this.stopSession(thread, currentSession);
            this.acceptTerminalError(this.proofPersistenceFailure ?? proofErr);
            return {
              kind: 'failed',
              status: 'error',
              step: 'Không lưu được checkpoint nhiệm vụ'
            };
          }
          if (error instanceof TaskEvidenceError) {
            if (error.unsettledProofs.length > 0) {
              await this.persistAcceptedProofs(thread, error.unsettledProofs);
            }
            throw error;
          }
          throw error;
        }

        if (result.fatalCode === 'DOM_READ_TIMEOUT') {
          if (thread.sessionRecycleCount < MAX_UI_SESSION_RECYCLES) {
            thread.sessionRecycleCount += 1;
            this.log(
              'WARNING',
              thread.email,
              'Nhiệm vụ',
              `Gặp lỗi ${result.fatalError ?? 'DOM_READ_TIMEOUT'}; dừng profile cũ và mở lại session mới (${thread.sessionRecycleCount}/${MAX_UI_SESSION_RECYCLES}).`,
              thread.accountId
            );
            const stopped = await this.stopSession(thread, currentSession);
            if (!stopped) {
              return {
                kind: 'failed',
                status: 'error',
                step: 'Không thu hồi được browser profile cũ khi phục hồi'
              };
            }
            iterationSignal.throwIfAborted();
            this.runAbort?.signal.throwIfAborted();
            if (this.terminalIntent) {
              return {
                kind: 'stopped',
                status: 'stopped',
                step: this.deriveStopMessage(iterationSignal)
              };
            }

            authAttempt = 'existing-only';
            carriedUnsettledProofs = result.unsettledProofs ?? [];
            await this.launchThreadSession(thread, config, iterationSignal);
            continue;
          }
        }

        return this.classifyUiResult(thread, result, config);
      }
    } catch (err: unknown) {
      const isIndependentFailure = err instanceof AutomationTerminalError &&
        err.state === 'failed' && err.reason.code !== 'RESOURCE_CLEANUP_FAILED';
      if (!isIndependentFailure && (iterationSignal.aborted || this.runAbort?.signal.aborted)) {
        return {
          kind: 'stopped',
          status: 'stopped',
          step: this.deriveStopMessage(iterationSignal, err)
        };
      }
      if (err instanceof AutomationTerminalError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi làm nhiệm vụ.';
      this.log('ERROR', thread.email, 'Nhiệm vụ', message, thread.accountId);
      const unavailable = config.missionTransport === 'http-only' && message === 'HTTP_TASKS_UNAVAILABLE';
      const failureStep = unavailable
        ? 'HTTP-only không đọc được danh sách nhiệm vụ'
        : 'Lỗi khi làm nhiệm vụ';
      this.deps.accounts.update(thread.accountId, {
        status: 'error',
        automationStep: failureStep
      });
      return {
        kind: 'failed',
        status: 'error',
        step: failureStep
      };
    }
  }

  private async workerLoop(
    workerId: string,
    source: AutomationWorkSource,
    config: AutomationRunConfigDTO,
    directProxyPool: DirectProxyPool | undefined,
    acquisitionSignal: AbortSignal,
    initialWave: InitialWaveBarrier | null
  ): Promise<void> {
    let firstIteration = true;
    let acquisitionSequence = 0;
    while (!acquisitionSignal.aborted && !this.terminalIntent) {
      if (source.isExhausted?.()) {
        if (firstIteration) this.releaseRunningWaiters();
        return;
      }
      acquisitionSequence += 1;
      const acquisitionIdentity = {
        runId: this.progress.runId,
        workerAlias: workerId,
        acquisitionAlias: this.progress.runId + ':' + workerId + ':' + acquisitionSequence,
        accountAlias: 'unassigned',
        sessionAlias: 'unassigned',
        authorityRef: 'automation-run'
      } as const;
      const durableAcquisitionIdentity = this.deps.mutationContext ? {
        ownerRef: acquisitionIdentity.acquisitionAlias,
        runId: acquisitionIdentity.runId,
        stepAttemptId: acquisitionIdentity.acquisitionAlias
      } : undefined;
      let item: AutomationWorkItem | null =
        source.kind === 'finite'
          ? await measureStage(
              'email-acquisition',
              () => this.observe(acquisitionIdentity, () => source.next(workerId, acquisitionSignal, durableAcquisitionIdentity)),
              (message) => this.log('INFO', workerId, 'Timing', message)
            )
          : null;
      if (source.kind === 'finite' && item === null) {
        if (firstIteration) this.releaseRunningWaiters();
        return;
      }

      this.publish(this.progress.state, this.progress.message, {
        workersActive: this.progress.workersActive + 1
      });

      let lease: AcquiredProxyLease | undefined;
      let directProxy: BrowserProxySettings | undefined;
      let thread: ThreadRuntime | undefined;
      let committed = false;
      try {
        const stagger = config.missionTransport === 'http-only'
          ? 0
          : firstIteration ? headlessWorkerStaggerMs(config.headless, workerId) : 0;
        if (stagger > 0) {
          this.log('INFO', item?.email ?? workerId, 'Browser', `Headless stagger: chờ ${stagger}ms trước khi mở profile`);
          await abortableDelay(stagger, acquisitionSignal);
        }
        if (config.proxy.mode === 'proxykey') {
          this.log('INFO', item?.email ?? workerId, 'Proxy', 'Đang xin proxy key...');
          lease = await measureStage(
            'proxy-acquisition',
            () => this.observe(acquisitionIdentity, () => this.deps.proxies.acquire(acquisitionSignal)),
            (message) =>
              this.log(
                'INFO',
                item?.email ?? workerId,
                'Timing',
                message,
                thread?.accountId
              )
          );
          this.activeProxyCount += 1;
          this.recordResourceSnapshot();
          this.log('SUCCESS', item?.email ?? workerId, 'Proxy', 'Đã nhận proxy ' + lease.ip + ':' + lease.port);
        } else if (directProxyPool) {
          this.log('INFO', item?.email ?? workerId, 'Proxy', 'Đang cấp phát proxy tĩnh...');
          directProxy = await measureStage(
            'proxy-acquisition',
            () => directProxyPool.acquire(acquisitionSignal),
            (message) =>
              this.log(
                'INFO',
                item?.email ?? workerId,
                'Timing',
                message,
                thread?.accountId
              )
          );
          this.activeProxyCount += 1;
          this.recordResourceSnapshot();
          this.log('SUCCESS', item?.email ?? workerId, 'Proxy', `Đã cấp proxy ${directProxy.type}://${directProxy.host}:${directProxy.port}`);
        }
        if (source.kind === 'continuous') {
          item = await measureStage(
            'email-acquisition',
            () => this.observe(acquisitionIdentity, () => source.next(workerId, acquisitionSignal, durableAcquisitionIdentity)),
            (message) => this.log('INFO', workerId, 'Timing', message)
          );
        }
        if (!item) {
          if (firstIteration) this.releaseRunningWaiters();
          await this.cleanupIteration(source, item, committed, thread, lease, acquisitionIdentity, directProxy, directProxyPool);
          this.publish(this.progress.state, this.progress.message, {
            workersActive: Math.max(0, this.progress.workersActive - 1)
          });
          return;
        }
        if (item.kind === 'new') {
          this.activeMailReservationCount += 1;
          this.mailboxAcquisitions += 1;
          this.recordResourceSnapshot();
        }
        // A provider block aborts acquisition only and lets this acquired item
        // continue; an explicit whole-run Stop must release it before account use.
        this.runAbort?.signal.throwIfAborted();
        if (source.kind === 'continuous' && firstIteration) {
          initialWave?.arrive();
        }

        await measureStage(
          'account-total',
          async () => {
            thread = this.createThreadRecord(
              item!,
              config,
              directProxy,
              lease,
              this.progress.runId,
              workerId
            );
            try {
              if (thread.directProxy && !directProxyPool) {
                this.activeProxyCount += 1;
                this.recordResourceSnapshot();
              }
              this.increment('accountsAccepted');
              if (item!.kind === 'new') {
                this.recordEvidence({
                  schemaVersion: 1,
                  runId: thread.runId,
                  workerAlias: thread.workerAlias,
                  accountAlias: thread.accountAlias,
                  at: new Date().toISOString(),
                  type: 'mailbox-acquired'
                });
              }
              const iterationSignal = this.iterationAbort.get(thread.accountId)?.signal;
              if (!iterationSignal) throw new Error('Iteration cancellation owner was lost.');
              // Bind a purchased mailbox to its newly-created account before any
              // browser/profile launch. The durable owner identity is carried by
              // the work item and cannot be regenerated by a retry.
              if (item!.kind === 'new' && item!.purchasedEmailId) {
                source.bind?.(item!, thread.accountId);
              }
              if (config.missionTransport === 'http-only') {
                this.activeThreads.set(thread.accountId, thread);
                this.deps.accounts.update(thread.accountId, {
                  status: 'processing',
                  automationStep: 'HTTP-only đang chạy'
                });
              } else {
                await this.launchThreadSession(thread!, config, iterationSignal);
              }
              if (firstIteration) {
                this.releaseRunningWaiters();
              }
              iterationSignal.throwIfAborted();
              if (item!.kind === 'new' && item!.purchasedEmailId) {
                source.commit(item!, thread.accountId);
                committed = true;
                this.activeMailReservationCount = Math.max(0, this.activeMailReservationCount - 1);
                this.recordResourceSnapshot();
              }
              const outcome = await this.runThreadWorkload(thread!, config, iterationSignal);
              this.recordOutcome(thread!, outcome);
            } catch (err: unknown) {
              if (firstIteration) {
                this.releaseRunningWaiters();
              }
              if (!thread.outcome) {
                const iterationSig = this.iterationAbort.get(thread.accountId)?.signal;
                const isIndependentFailure = err instanceof AutomationTerminalError &&
                  err.state === 'failed' && err.reason.code !== 'RESOURCE_CLEANUP_FAILED';
                const wasAborted = this.runAbort?.signal.aborted === true || iterationSig?.aborted === true;
                this.recordOutcome(
                  thread,
                  !isIndependentFailure && wasAborted
                    ? { kind: 'stopped', status: 'stopped', step: this.deriveStopMessage(iterationSig, err) }
                    : { kind: 'failed', status: 'error', step: 'Lỗi khi khởi chạy hoặc xử lý' }
                );
              }
              if (err instanceof AutomationTerminalError) throw err;
            } finally {
              const timingLog = (message: string): void => {
                this.log(
                  'INFO',
                  thread?.email ?? item?.email ?? 'system',
                  'Timing',
                  message,
                  thread?.accountId
                );
              };
              const cleanupFailuresBefore = this.cleanupFailures;
              await measureStage(
                'cleanup',
                async () => {
                  await this.cleanupIteration(source, item, committed, thread, lease, acquisitionIdentity, directProxy, directProxyPool);
                  if (this.cleanupFailures > cleanupFailuresBefore) {
                    throw new Error('sanitized cleanup failure');
                  }
                },
                timingLog
              ).catch(() => undefined);
              thread?.notifyDone?.();
              this.publish(this.progress.state, this.progress.message, {
                workersActive: Math.max(0, this.progress.workersActive - 1)
              });
            }
          },
          (message) => {
            const timing =
              message.replace(' outcome=', ' operationOutcome=') +
              ' accountOutcome=' + (thread?.outcome?.kind ?? 'unrecorded') +
              ' persisted=' + String(thread?.outcomePersisted === true);
            this.log(
              'INFO',
              thread?.email ?? item?.email ?? 'system',
              'Timing',
              timing,
              thread?.accountId
            );
          }
        );
      } catch (error: unknown) {
        if (firstIteration) {
          this.releaseRunningWaiters();
        }
        if (!acquisitionSignal.aborted) {
          this.acceptTerminalError(error);
        }
        if (!thread) {
          await this.cleanupIteration(source, item, committed, thread, lease, acquisitionIdentity, directProxy, directProxyPool);
          this.publish(this.progress.state, this.progress.message, {
            workersActive: Math.max(0, this.progress.workersActive - 1)
          });
        }
      }

      if (firstIteration) {
        firstIteration = false;
        try {
          await initialWave?.wait(acquisitionSignal);
        } catch {
          if (acquisitionSignal.aborted) return;
          throw new Error('Initial acquisition barrier failed.');
        }
      }
    }
  }

  private async runPrepared(
    source: AutomationWorkSource,
    readiness: SourceReadiness,
    config: AutomationRunConfigDTO,
    directProxyPool?: DirectProxyPool
  ): Promise<AutomationRunSummary> {
    try {
      const workerTarget = readiness.workerTarget;
      const initialWave = source.kind === 'continuous' ? new InitialWaveBarrier(workerTarget) : null;
      const acquisitionSignal = this.acquisitionAbort!.signal;

      const workers = Array.from({ length: workerTarget }, (_, i) => {
        return this.workerLoop(
          'worker-' + (i + 1),
          source,
          config,
          directProxyPool,
          acquisitionSignal,
          initialWave
        );
      });

      const results = await Promise.allSettled(workers);
      this.releaseRunningWaiters();

      for (const result of results) {
        if (result.status === 'rejected') {
          this.acceptTerminalError(result.reason);
        }
      }

      const hasRetainedSessions = Array.from(this.activeThreads.values()).some((t) => Boolean(t.session));
      if (!hasRetainedSessions) {
        if (directProxyPool) {
          directProxyPool.drain();
        }

        try {
          await this.observe({
            runId: this.progress.runId,
            workerAlias: null,
            acquisitionAlias: null,
            accountAlias: null,
            sessionAlias: null,
            provider: 'kiotproxy',
            operation: 'proxy-release',
            authorityRef: 'all'
          }, () => this.deps.proxies.releaseAll());
          this.activeProxyCount = 0;
          this.recordResourceSnapshot();
        } catch {
          this.noteCleanupFailure(undefined, 'proxy-lease');
        }
      }

      let finalReason: AutomationTerminalReasonDTO | undefined = this.terminalIntent ?? undefined;
      if (this.terminalPersistenceFailure) {
        finalReason = {
          ...this.terminalPersistenceFailure.reason,
          details: {
            ...(this.terminalPersistenceFailure.reason.details ?? {}),
            ...(this.cleanupFailures > 0 ? { cleanupFailures: this.cleanupFailures } : {}),
            ...(this.activeThreads.size > 0 ? { pendingProfiles: this.activeThreads.size } : {})
          }
        };
        this.terminalIntent = finalReason;
        this.terminalState = 'failed';
      } else if (this.proofPersistenceFailure) {
        finalReason = {
          ...this.proofPersistenceFailure.reason,
          details: {
            ...(this.proofPersistenceFailure.reason.details ?? {}),
            ...(this.cleanupFailures > 0 ? { cleanupFailures: this.cleanupFailures } : {}),
            ...(this.activeThreads.size > 0 ? { pendingProfiles: this.activeThreads.size } : {})
          }
        };
        this.terminalIntent = finalReason;
        this.terminalState = 'failed';
      } else if (!finalReason) {
        if ((config.mailLimit ?? 0) > 0 && this.progress.accountsAccepted >= config.mailLimit!) {
          finalReason = { code: 'MAIL_LIMIT_REACHED', details: { mailLimit: config.mailLimit! } };
        } else if (source.kind === 'finite') {
          finalReason = { code: 'MANUAL_EXHAUSTED' };
        } else {
          finalReason = { code: 'INTERNAL_ERROR' };
        }
      }

      const hasCleanupFailure = this.cleanupFailures > 0 || this.activeThreads.size > 0;
      if (!this.terminalPersistenceFailure && !this.proofPersistenceFailure) {
        if (hasCleanupFailure && this.terminalIntent?.code !== 'USER_STOP' && this.terminalIntent?.code !== 'APP_SHUTDOWN') {
          finalReason = {
            code: 'RESOURCE_CLEANUP_FAILED',
            details: {
              cleanupFailures: this.cleanupFailures,
              ...(this.activeThreads.size > 0 ? { pendingProfiles: this.activeThreads.size } : {})
            }
          };
        } else if (this.cleanupFailures > 0) {
          finalReason = {
            ...finalReason,
            details: {
              ...(finalReason.details ?? {}),
              cleanupFailures: this.cleanupFailures
            }
          };
        }
      }

      if (this.terminalPersistenceFailure) {
        this.terminalIntent = finalReason;
        this.terminalState = 'failed';
        this.publish('failed', this.terminalPersistenceFailure.message, { terminalReason: finalReason });
      } else if (this.proofPersistenceFailure) {
        this.terminalIntent = finalReason;
        this.terminalState = 'failed';
        this.publish('failed', this.proofPersistenceFailure.message, { terminalReason: finalReason });
      } else if (this.terminalIntent?.code === 'USER_STOP' || this.terminalIntent?.code === 'APP_SHUTDOWN') {
        this.publish('stopped', 'Phiên chạy đã dừng.', { terminalReason: finalReason });
      } else if (hasCleanupFailure) {
        this.terminalIntent = finalReason;
        this.terminalState = 'failed';
        this.publish('failed', `Phiên chạy hoàn tất nhưng có ${this.cleanupFailures} lỗi thu hồi tài nguyên.`, {
          terminalReason: finalReason
        });
      } else if (this.terminalState) {
        this.publish(this.terminalState, this.progress.message, { terminalReason: finalReason });
      } else if (this.terminalIntent?.code === 'INTERNAL_ERROR') {
        this.publish('failed', this.progress.message, { terminalReason: finalReason });
      } else if (this.terminalIntent) {
        this.publish('blocked', this.progress.message, { terminalReason: finalReason });
      } else if (finalReason.code === 'MAIL_LIMIT_REACHED') {
        this.publish('completed', 'Đã xử lý đủ giới hạn mail; các worker đã cleanup.', { terminalReason: finalReason });
      } else if (source.kind === 'finite') {
        this.publish('completed', 'Đã xử lý hết danh sách email thủ công.', {
          terminalReason: finalReason
        });
      } else {
        this.publish('failed', 'Nguồn liên tục kết thúc ngoài dự kiến.', {
          terminalReason: finalReason
        });
      }

      return { ...this.progress, startedProfiles: [...this.startedProfiles] };
    } finally {
      this.runtime.onTerminalSnapshot?.({
        schedulers: Array.from(this.uiSchedulers, ([sessionAlias, scheduler]) => ({
          sessionAlias,
          snapshot: scheduler.snapshot()
        })),
        activeThreads: this.activeThreads.size,
        activeProfiles: this.activeProfileCount,
        activeProxies: this.activeProxyCount,
        activeMailReservations: this.activeMailReservationCount
      });
      if (this.telemetry) {
        const finalState: 'completed' | 'failed' | 'stopped' | 'blocked' =
          this.progress.state === 'completed' || this.progress.state === 'failed' ||
          this.progress.state === 'stopped' || this.progress.state === 'blocked'
            ? this.progress.state
            : (this.terminalState ?? 'failed');

        const terminalCode: AutomationTerminalCode =
          this.progress.terminalReason?.code ?? this.terminalIntent?.code ?? (
            this.cleanupFailures > 0
              ? 'RESOURCE_CLEANUP_FAILED'
              : finalState === 'stopped'
                ? 'USER_STOP'
                : finalState === 'completed'
                  ? 'MAIL_LIMIT_REACHED'
                  : 'INTERNAL_ERROR'
          );

        const terminalEvent: AutomationEvidenceTerminalEvent = {
          schemaVersion: 1,
          runId: this.progress.runId,
          at: new Date().toISOString(),
          type: 'terminal',
          mode: this.evidenceMode,
          stage: this.evidenceStage,
          mailboxAcquisitions: this.mailboxAcquisitions,
          state: finalState,
          code: terminalCode,
          accepted: this.progress.accountsAccepted,
          completed: this.progress.accountsCompleted,
          failed: this.progress.accountsFailed,
          stopped: this.progress.accountsStopped,
          skipped: this.skippedAccounts,
          cleanupFailures: this.cleanupFailures,
          purchaseAttempted: this.sourceForEvidence?.purchaseStats().attempted ?? 0,
          purchaseConfirmed: this.sourceForEvidence?.purchaseStats().confirmed ?? 0,
          purchaseAmbiguous: this.sourceForEvidence?.purchaseStats().ambiguous ?? 0
        };

        await this.telemetry.close(terminalEvent);
      }
    }
  }

  /** Threads currently running, so the UI can stop one row at a time. */
  getRunningThreads(): RunningThreadInfo[] {
    return Array.from(this.activeThreads.values())
      .filter((thread) => thread.session !== undefined || thread.outcome === undefined)
      .map((thread) => ({
        accountId: thread.accountId,
        email: thread.email,
        ...(thread.session?.profileId
          ? { profileId: thread.session.profileId }
          : { transport: 'http-only' as const })
      }));
  }

  isAccountActive(accountId: string): boolean {
    return this.iterationOwners.has(accountId) || this.activeThreads.has(accountId) || this.iterationAbort.has(accountId);
  }

  async stopThread(accountId: string): Promise<boolean> {
    const thread = this.activeThreads.get(accountId);
    const controller = this.iterationAbort.get(accountId);
    if (!thread) return false;

    controller?.abort(new Error('stopThread requested'));
    let stopped = true;
    if (thread.session) {
      stopped = await this.stopSession(thread, thread.session);
    }
    if (!thread.session) {
      this.activeThreads.delete(thread.accountId);
    }
    if (thread.completionPromise) {
      await thread.completionPromise;
    }
    return stopped;
  }

  start(config: AutomationRunConfigDTO): Promise<{ runId: string; artifactBasename?: string; clearedThrough?: number }> {
    if (this.isRunning() || this.activeThreads.size > 0 || this.iterationOwners.size > 0) {
      return Promise.reject(new ProviderError('CONFIG_ERROR', 'Đang có phiên hoặc profile chưa dừng, hãy dừng trước khi bắt đầu.'));
    }
    if (this.uiSchedulers.size > 0) {
      return Promise.reject(new ProviderError(
        'CONFIG_ERROR',
        'Còn scheduler/session chưa xác nhận thu hồi; không thể bắt đầu phiên mới.'
      ));
    }
    if (config.emailSource.mode === 'pasted-existing' || config.password.mode === 'per-account') {
      const parsed = AutomationRunConfigSchema.safeParse(config);
      if (!parsed.success) {
        return Promise.reject(new ProviderError(
          'CONFIG_ERROR',
          'Cấu hình tài khoản dán không hợp lệ: ' +
            parsed.error.issues.map((issue) => issue.message).join('; ')
        ));
      }
      config = parsed.data;
    }
    const runId = this.nextId();
    this.lastSummary = null;
    const workerTarget = (config.mailLimit ?? 0) > 0 ? Math.min(config.threadCount, config.mailLimit!) : config.threadCount;
    this.publish('preparing', 'Đang chuẩn bị dữ liệu cho phiên chạy...', {
      runId,
      workerTarget,
      workersActive: 0,
      accountsAccepted: 0,
      accountsCompleted: 0,
      accountsFailed: 0,
      accountsStopped: 0,
      terminalReason: undefined
    });
    this.runAbort = new AbortController();
    this.acquisitionAbort = new AbortController();
    this.terminalIntent = null;
    this.terminalState = null;
    this.terminalPersistenceFailure = null;
    this.proofPersistenceFailure = null;
    this.iterationAbort.clear();
    this.cleanupFailures = 0;
    this.skippedAccounts = 0;
    this.mailboxAcquisitions = 0;
    this.accountSequence = 0;
    this.sessionSequences.clear();
    this.evidenceMode = (config.emailSource.mode === 'existing' || config.emailSource.mode === 'pasted-existing') ? 'resume' : 'new';
    this.evidenceStage = config.rolloutStage ?? null;
    this.sourceForEvidence = null;
    this.activeProfileCount = 0;
    this.activeProxyCount = 0;
    this.activeMailReservationCount = 0;
    this.startedProfiles = [];
    this.firstWaveDone = false;
    const runSignal = this.runAbort.signal;
    let artifactBasename: string | undefined;
    const operation = Promise.resolve().then(async () => {
      try {
        const logResetTicket = this.deps.logReset?.capture(runId);
        const headedRollout = config.headless === false && (config.missionTransport ?? 'ui') === 'ui' && config.rolloutStage !== undefined;
        this.telemetry = headedRollout
          ? this.runtime.createTelemetry?.(runId) ?? createRunTelemetry({ userDataDir: this.getUserDataDir(), runId })
          : null;
        artifactBasename = this.telemetry?.artifactBasename();
        return await this.prepareRun(config, runId, runSignal, logResetTicket);
      } catch (error: unknown) {
        if (runSignal.aborted) {
          const stopReason = this.terminalIntent ?? { code: 'USER_STOP' };
          if (this.progress.state !== 'stopped') {
            this.publish('stopped', 'Đã dừng trước khi khởi chạy.', { terminalReason: stopReason });
          }
        } else if (error instanceof AutomationTerminalError) {
          if (this.progress.state !== error.state || !this.progress.terminalReason) {
            this.publish(error.state, error.message, { terminalReason: error.reason });
          }
        } else if (error instanceof ProviderError) {
          let code: AutomationTerminalCode = 'PROVIDER_CONFIG_ERROR';
          if (error.code === 'AUTH_ERROR') {
            code = 'PROVIDER_AUTH_REQUIRED';
          } else if (error.code === 'INSUFFICIENT_FUNDS') {
            code = 'INSUFFICIENT_FUNDS';
          }
          const terminalReason = {
            code,
            ...(error.serviceName ? { provider: error.serviceName } : {})
          };
          if (this.progress.state !== 'blocked' || !this.progress.terminalReason) {
            this.publish('blocked', error.message, { terminalReason });
          }
        } else {
          if (this.progress.state !== 'failed' && this.progress.state !== 'blocked' && this.progress.state !== 'stopped') {
            this.publish('failed', error instanceof Error ? error.message : String(error), {
              terminalReason: { code: 'INTERNAL_ERROR' }
            });
          }
        }

        this.lastSummary = { ...this.progress, startedProfiles: [...this.startedProfiles] };

        if (this.telemetry) {
          try {
            await this.telemetry.close({
              schemaVersion: 1,
              runId,
              at: new Date().toISOString(),
              type: 'terminal',
              mode: this.evidenceMode,
              stage: this.evidenceStage,
              mailboxAcquisitions: this.mailboxAcquisitions,
              state: (this.progress.state === 'completed' || this.progress.state === 'failed' || this.progress.state === 'stopped' || this.progress.state === 'blocked')
                ? this.progress.state
                : 'failed',
              code: this.progress.terminalReason?.code ?? (this.progress.state === 'stopped' ? 'USER_STOP' : 'INTERNAL_ERROR'),
              accepted: this.progress.accountsAccepted,
              completed: this.progress.accountsCompleted,
              failed: this.progress.accountsFailed,
              stopped: this.progress.accountsStopped,
              skipped: this.skippedAccounts,
              cleanupFailures: this.cleanupFailures,
              purchaseAttempted: this.sourceForEvidence?.purchaseStats().attempted ?? 0,
              purchaseConfirmed: this.sourceForEvidence?.purchaseStats().confirmed ?? 0,
              purchaseAmbiguous: this.sourceForEvidence?.purchaseStats().ambiguous ?? 0
            });
          } catch (telemetryErr: unknown) {
            this.log('WARNING', 'system', 'Run', 'Lỗi đóng telemetry phiên chạy: ' + (telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr)));
          }
        }

        if (runSignal.aborted) {
          return { runId, ...(artifactBasename ? { artifactBasename } : {}) };
        }
        throw error;
      } finally {
        if (this.starting === operation) {
          this.starting = null;
        }
      }
    });
    this.starting = operation;
    return operation.then((result) => ({
      runId,
      ...(artifactBasename ? { artifactBasename } : {}),
      ...(result?.clearedThrough !== undefined ? { clearedThrough: result.clearedThrough } : {})
    }));
  }

  private async prepareRun(
    config: AutomationRunConfigDTO,
    runId: string,
    runSignal: AbortSignal,
    logResetTicket?: StartLogResetTicket
  ): Promise<{ runId: string; clearedThrough?: number }> {
    let workerTarget = (config.mailLimit ?? 0) > 0 ? Math.min(config.threadCount, config.mailLimit!) : config.threadCount;
    runSignal.throwIfAborted();

    let source: AutomationWorkSource | undefined;
    let readiness: SourceReadiness | undefined;

    if (config.emailSource.mode === 'pasted-existing') {
      if (!this.deps.accounts.findByEmail) {
        const err = new AutomationTerminalError(
          'blocked',
          { code: 'PROVIDER_CONFIG_ERROR' },
          'Hệ thống lưu trữ tài khoản chưa hỗ trợ tra cứu email cho danh sách tài khoản CapCut dán có sẵn.'
        );
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }

      const normalizedResult = normalizePastedCapcutEntries(config.emailSource.entries);
      if (normalizedResult.issues.length > 0) {
        const msg = formatPastedCapcutIssues(normalizedResult.issues);
        const err = new AutomationTerminalError('blocked', { code: 'PROVIDER_CONFIG_ERROR' }, msg);
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }

      const selectedEntries = (config.mailLimit ?? 0) > 0
        ? normalizedResult.entries.slice(0, config.mailLimit)
        : normalizedResult.entries;

      const multiMatchLines: string[] = [];
      const activeLines: string[] = [];
      for (const entry of selectedEntries) {
        const matches = this.deps.accounts.findByEmail(entry.email);
        if (matches.length > 1) {
          multiMatchLines.push(`dòng ${entry.line} (${entry.email}) trùng với ${matches.length} bản ghi trong cơ sở dữ liệu`);
        } else if (matches.length === 1 && this.isAccountActive(matches[0].id)) {
          activeLines.push(`dòng ${entry.line} (${entry.email})`);
        }
      }

      if (multiMatchLines.length > 0) {
        const msg = `Phát hiện xung đột tài khoản trong cơ sở dữ liệu: ${multiMatchLines.join('; ')}. Vui lòng kiểm tra lại trang Tài khoản.`;
        const err = new AutomationTerminalError('blocked', { code: 'PROVIDER_CONFIG_ERROR' }, msg);
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }

      if (activeLines.length > 0) {
        const msg = `Tài khoản đang được xử lý bởi tác vụ khác: ${activeLines.join(', ')}.`;
        const err = new AutomationTerminalError('blocked', { code: 'PROVIDER_CONFIG_ERROR' }, msg);
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }

      source = this.deps.workSources.create(
        config,
        runId,
        (event) => {
          this.recordEvidence({
            schemaVersion: 1, runId, at: new Date().toISOString(), type: 'purchase',
            provider: event.provider, outcome: event.outcome,
            attempted: event.stats.attempted, confirmed: event.stats.confirmed,
            ambiguous: event.stats.ambiguous, budget: event.stats.budget
          });
        },
        this.deps.mutationContext,
        (message) => {
          this.log('INFO', 'system', 'Email', message);
          this.publish(this.progress.state, message);
        }
      );
      this.sourceForEvidence = source;
      try {
        readiness = await measureStage(
          'source-preflight',
          () => source!.prepare(workerTarget, runSignal),
          (message) => this.log('INFO', 'system', 'Timing', message)
        );
      } catch (err: unknown) {
        runSignal.throwIfAborted();
        if (err instanceof AutomationTerminalError) {
          this.publish(err.state, err.message, { terminalReason: err.reason });
          throw err;
        }
        if (err instanceof ProviderError) {
          const code = err.code === 'AUTH_ERROR' ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_CONFIG_ERROR';
          this.publish('blocked', err.message, { terminalReason: { code } });
          this.log('ERROR', 'system', 'Run', err.message);
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Không chuẩn bị được phiên chạy.';
        const terminalErr = new AutomationTerminalError('failed', { code: 'INTERNAL_ERROR' }, message);
        this.publish('failed', message, { terminalReason: terminalErr.reason });
        this.log('ERROR', 'system', 'Run', message);
        throw terminalErr;
      }
      workerTarget = readiness.workerTarget;
      this.publish(this.progress.state, this.progress.message, { workerTarget });
    }

    if (config.missionTransport === 'http-only') {
      const runner = this.deps.httpOnlyRunner;
      if (!runner) {
        const err = new AutomationTerminalError(
          'blocked',
          { code: 'PROVIDER_CONFIG_ERROR', details: { missionTransport: 'http-only' } },
          'Chưa cấu hình HTTP-only account runner; từ chối chạy browser hoặc mua mailbox.'
        );
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }
      try {
        await runner.preflight(config, runSignal);
      } catch {
        runSignal.throwIfAborted();
        const err = new AutomationTerminalError(
          'blocked',
          { code: 'PROVIDER_CONFIG_ERROR', details: { missionTransport: 'http-only' } },
          'HTTP-only runner chưa sẵn sàng; kiểm tra session, contract và cấu hình provider.'
        );
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }
    }

    if (config.missionTransport === 'http-only' &&
        config.proxy.mode === 'direct' && config.proxy.entries.length === 0) {
      const err = new AutomationTerminalError(
        'blocked',
        { code: 'PROVIDER_CONFIG_ERROR', details: { missionTransport: 'http-only', proxy: 'required' } },
        'HTTP-only yêu cầu một proxy route rõ ràng cho mỗi worker; không chạy bằng IP máy.'
      );
      this.publish('blocked', err.message, { terminalReason: err.reason });
      throw err;
    }

    if (config.module !== 'credit') {
      const err = new AutomationTerminalError(
        'blocked',
        { code: 'PROVIDER_CONFIG_ERROR' },
        'Module "' + config.module + '" chưa được hỗ trợ. Chỉ hỗ trợ module "credit".'
      );
      this.publish('blocked', err.message, { terminalReason: err.reason });
      throw err;
    }

    if (config.missionTransport !== 'http-only' && !isBrowserImplemented(config.browser)) {
      const err = new AutomationTerminalError(
        'blocked',
        { code: 'PROVIDER_CONFIG_ERROR' },
        'Browser "' + config.browser + '" chưa được tích hợp nên không mở được profile nào. ' +
          'Hiện chỉ dùng được: ' + IMPLEMENTED_BROWSER_RUNTIMES.join(', ') + '.'
      );
      this.publish('blocked', err.message, { terminalReason: err.reason });
      throw err;
    }

    let directProxies: BrowserProxySettings[] = [];
    let directProxyPool: DirectProxyPool | undefined;
    try {
      if (config.proxy.mode === 'direct') {
        directProxies = this.parseDirectProxyList(config.proxy.entries, workerTarget);
        if (directProxies.length > 0) {
          directProxyPool = new DirectProxyPool(directProxies);
        }
      }
      if (config.missionTransport !== 'http-only') {
        this.assertLauncherSupportsConfig(config, directProxies);
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        const terminalErr = new AutomationTerminalError(
          'blocked',
          {
            code: 'PROVIDER_CONFIG_ERROR',
            ...(err.serviceName ? { provider: err.serviceName } : {})
          },
          err.message
        );
        this.publish('blocked', err.message, { terminalReason: terminalErr.reason });
      }
      throw err;
    }

    if (config.proxy.mode === 'proxykey') {
      this.deps.proxies.resetIdlePreflightCache?.();
      this.deps.proxies.configure?.({ keys: config.proxy.keys, region: config.proxy.region });
      const readPromise = Promise.resolve(this.deps.proxies.availableSlots?.());
      const slots = await abortable(readPromise, runSignal);
      runSignal.throwIfAborted();
      if (slots !== null && slots !== undefined && slots < workerTarget) {
        const err = new AutomationTerminalError(
          'blocked',
          {
            code: 'PROXY_CAPACITY_UNAVAILABLE',
            provider: 'kiotproxy',
            details: { requestedWorkers: workerTarget, availableSlots: slots }
          },
          'Không đủ proxy key cho toàn bộ số luồng đã cấu hình.'
        );
        this.publish('blocked', err.message, { terminalReason: err.reason });
        throw err;
      }
    }

    this.recordEvidence({
      schemaVersion: 1, runId, at: new Date().toISOString(), type: 'run-start',
      mode: this.evidenceMode, headed: true, stage: this.evidenceStage,
      uiScope: config.headless === false && (config.missionTransport ?? 'ui') === 'ui'
        ? 'session-target'
        : undefined,
      workerTarget, maxBillablePurchases: config.maxBillablePurchases ?? 0
    });
    this.recordResourceSnapshot();

    if (!source) {
      source = this.deps.workSources.create(
        config,
        runId,
        (event) => {
          this.recordEvidence({
            schemaVersion: 1, runId, at: new Date().toISOString(), type: 'purchase',
            provider: event.provider, outcome: event.outcome,
            attempted: event.stats.attempted, confirmed: event.stats.confirmed,
            ambiguous: event.stats.ambiguous, budget: event.stats.budget
          });
        },
        this.deps.mutationContext,
        (message) => {
          this.log('INFO', 'system', 'Email', message);
          this.publish(this.progress.state, message);
        }
      );
      this.sourceForEvidence = source;
      try {
        readiness = await measureStage(
          'source-preflight',
          () => source!.prepare(workerTarget, runSignal),
          (message) => this.log('INFO', 'system', 'Timing', message)
        );
      } catch (err: unknown) {
        runSignal.throwIfAborted();
        if (err instanceof AutomationTerminalError) {
          this.publish(err.state, err.message, { terminalReason: err.reason });
          throw err;
        }
        if (err instanceof ProviderError) {
        const code = err.code === 'AUTH_ERROR' ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_CONFIG_ERROR';
        this.publish('blocked', err.message, { terminalReason: { code } });
        this.log('ERROR', 'system', 'Run', err.message);
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Không chuẩn bị được phiên chạy.';
      const terminalErr = new AutomationTerminalError(
        'failed',
        { code: 'INTERNAL_ERROR' },
        message
      );
      this.publish('failed', message, { terminalReason: terminalErr.reason });
      this.log('ERROR', 'system', 'Run', message);
      throw terminalErr;
    }
  }

    runSignal.throwIfAborted();
    let clearedThrough: number | undefined;
    if (logResetTicket && this.deps.logReset) {
      try {
        const commitRes = this.deps.logReset.commit(logResetTicket);
        clearedThrough = commitRes.clearedThrough;
      } catch (err: unknown) {
        const terminalErr = new AutomationTerminalError(
          'failed',
          { code: 'INTERNAL_ERROR' },
          'Failed to commit log reset: ' + (err instanceof Error ? err.message : String(err)),
          err instanceof Error ? err : undefined
        );
        this.publish('failed', terminalErr.message, { terminalReason: terminalErr.reason });
        throw terminalErr;
      }

    }

    if (!readiness) {
      const err = new AutomationTerminalError(
        'failed',
        { code: 'INTERNAL_ERROR' },
        'Preflight readiness was not established.'
      );
      this.publish('failed', err.message, { terminalReason: err.reason });
      throw err;
    }

    this.publish('running', 'Đang chạy ' + readiness.workerTarget + ' luồng...', {
      workerTarget: readiness.workerTarget
    });

    this.activeDirectProxyPool = directProxyPool ?? null;
    this.activeRun = this.runPrepared(source, readiness, config, directProxyPool)
      .then((summary) => {
        this.lastSummary = summary;
        this.activeRun = null;
        return summary;
      })
      .catch((err: unknown) => {
        this.acceptTerminalError(err);
        this.lastSummary = { ...this.progress, startedProfiles: [...this.startedProfiles] };
        this.activeRun = null;
        return this.lastSummary;
      })
      .finally(() => {
        const hasRetained = Array.from(this.activeThreads.values()).some((t) => Boolean(t.session));
        if (!hasRetained) {
          this.activeDirectProxyPool = null;
        }
      });

    return { runId, ...(clearedThrough !== undefined ? { clearedThrough } : {}) };
  }

  private releaseRunningWaiters(): void {
    this.firstWaveDone = true;
    const waiters = this.runningResolvers;
    this.runningResolvers = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  async waitUntilRunning(): Promise<void> {
    if (this.firstWaveDone || !this.activeRun) return;
    await new Promise<void>((resolve) => {
      this.runningResolvers.push(resolve);
    });
  }

  async waitForCompletion(): Promise<AutomationRunSummary> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.activeRun) {
      return this.activeRun;
    }
    return this.lastSummary ?? { ...this.progress, startedProfiles: [...this.startedProfiles] };
  }

  stop(code: 'USER_STOP' | 'APP_SHUTDOWN' = 'USER_STOP'): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.starting && !this.activeRun && !this.healthRun && this.activeThreads.size === 0) return Promise.resolve();
    this.terminalIntent = { code };
    this.publish('stopping', 'Đang dừng các browser của phiên chạy...');
    this.runAbort?.abort(new Error(code));
    this.acquisitionAbort?.abort(new Error(code));
    this.healthAbort?.abort(new Error(code));
    this.activeDirectProxyPool?.drain(new Error(code));
    this.shutdownAllUiSchedulers({ code: 'RUN_ABORTED', message: code });
    for (const controller of this.iterationAbort.values()) {
      controller.abort(new Error(code));
    }
    this.stopping = Promise.resolve().then(async () => {
      this.log('INFO', 'system', 'Stop', 'Đã nhận yêu cầu dừng; không nhận thêm công việc.');
      await Promise.all(Array.from(this.activeThreads.values()).map(async (thread) => {
        if (thread.session) {
          await this.stopSession(thread, thread.session);
        }
        if (!thread.session) {
          this.activeThreads.delete(thread.accountId);
        }
      }));
      if (this.starting) await this.starting.catch(() => undefined);
      if (this.activeRun) await this.activeRun;
      if (this.healthRun) await this.healthRun.catch(() => undefined);
      if (this.activeThreads.size > 0 || this.terminalState === 'failed' || this.terminalPersistenceFailure || this.proofPersistenceFailure) {
        if (this.terminalPersistenceFailure) {
          const reason: AutomationTerminalReasonDTO = {
            ...this.terminalPersistenceFailure.reason,
            details: {
              ...(this.terminalPersistenceFailure.reason.details ?? {}),
              ...(this.cleanupFailures > 0 ? { cleanupFailures: this.cleanupFailures } : {}),
              ...(this.activeThreads.size > 0 ? { pendingProfiles: this.activeThreads.size } : {})
            }
          };
          this.terminalIntent = reason;
          this.terminalState = 'failed';
          this.publish('failed', this.terminalPersistenceFailure.message, { terminalReason: reason });
          this.lastSummary = {
            ...this.progress,
            state: 'failed',
            terminalReason: reason,
            startedProfiles: [...this.startedProfiles]
          };
          return;
        }
        if (this.proofPersistenceFailure) {
          const reason: AutomationTerminalReasonDTO = {
            ...this.proofPersistenceFailure.reason,
            details: {
              ...(this.proofPersistenceFailure.reason.details ?? {}),
              ...(this.cleanupFailures > 0 ? { cleanupFailures: this.cleanupFailures } : {}),
              ...(this.activeThreads.size > 0 ? { pendingProfiles: this.activeThreads.size } : {})
            }
          };
          this.terminalIntent = reason;
          this.terminalState = 'failed';
          this.publish('failed', this.proofPersistenceFailure.message, { terminalReason: reason });
          this.lastSummary = {
            ...this.progress,
            state: 'failed',
            terminalReason: reason,
            startedProfiles: [...this.startedProfiles]
          };
          return;
        }
        const message = 'Chưa xác nhận dừng được ' + this.activeThreads.size + ' profile. Cần xử lý thủ công trước khi chạy lại.';
        const reason: AutomationTerminalReasonDTO = this.terminalIntent?.code === 'RESOURCE_CLEANUP_FAILED'
          ? this.terminalIntent
          : {
              code: 'RESOURCE_CLEANUP_FAILED',
              details: { cleanupFailures: this.cleanupFailures, pendingProfiles: this.activeThreads.size }
            };
        this.terminalIntent = reason;
        this.terminalState = 'failed';
        this.publish('failed', message, { terminalReason: reason });
        this.lastSummary = {
          ...this.progress,
          state: 'failed',
          terminalReason: reason,
          startedProfiles: [...this.startedProfiles]
        };
        return;
      }
      this.publish('stopped', this.cleanupFailures ? 'Phiên đã dừng; có lỗi thu hồi tài nguyên, xem log Cleanup.' : 'Phiên chạy đã dừng.', {
        terminalReason: { code, ...(this.cleanupFailures ? { details: { cleanupFailures: this.cleanupFailures } } : {}) }
      });
      this.lastSummary = { ...this.progress, startedProfiles: [...this.startedProfiles] };
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}
