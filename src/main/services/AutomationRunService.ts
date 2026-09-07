import crypto from 'node:crypto';
import type { BrowserContext as CapcutContext, Page as CapcutPage } from 'playwright-core';
import { ProviderError } from '../providers/ProviderError';
import { AutomationTerminalError } from './AutomationTerminalError';
import { generateCapcutPassword } from './passwordGenerator';
import { measureStage } from './stageTiming';
import type { BrowserLauncher, LauncherProxy } from './capcut/launcher';
import { abortableDelay } from './capcut/cancellation';
import {
  RunUiInteractionScheduler,
  createDirectUiInteraction,
  mapUiSchedulerEventToEvidence
} from './capcut/uiInteractionScheduler';
import { createRunTelemetry, type RunTelemetry } from './capcut/runTelemetry';
import type { AutomationEvidenceTerminalEvent } from '../../shared/schemas/automation-evidence.schema';
import type {
  AccountUiInteraction,
  CapcutAuthAttempt,
  CapcutUiAccountResult,
  CapcutVerificationReceipt,
  UnsettledTaskProof
} from './capcut/types';
import type { LogBus } from './LogBus';
import type { AcquiredProxyLease } from './ProxyLeaseManager';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  AutomationWorkSourceFactory,
  SourceReadiness
} from './AutomationWorkSource';
import type {
  AutomationRunConfigDTO,
  AutomationRunCountersDTO,
  AutomationRunProgressDTO,
  AutomationRunState,
  AutomationTerminalCode,
  AutomationTerminalReasonDTO,
  BrowserRuntime
} from '../../shared/schemas/automation.schema';
import {
  IMPLEMENTED_BROWSER_RUNTIMES,
  isBrowserImplemented
} from '../../shared/schemas/automation.schema';
import type {
  AccountCreateInputDTO,
  AccountUpdateInputDTO
} from '../../shared/schemas/account.schema';

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
}

export interface IAccountSink {
  create(input: AccountCreateInputDTO): { id: string };
  update(id: string, data: AccountUpdateInputDTO): { success: boolean };
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
    ui?: AccountUiInteraction;
    /** Nguồn OTP của riêng luồng này; chỉ đường ĐĂNG KÝ cần. */
    getOtp?: () => Promise<string>;
    /** `retryCount` của Dashboard, đã đổi sang số lượt quét lại nhiệm vụ. */
    maxRounds?: number;
    pace?: { stepMinMs: number; stepMaxMs: number; typeMinMs: number; typeMaxMs: number };
    skipWithoutTrial: boolean;
    unsettledProofs: readonly UnsettledTaskProof[];
    onTaskCheckpoint: (checkpoint: {
      rows: CapcutAccountResult['tasks'];
      receipt: CapcutVerificationReceipt;
    }) => Promise<void>;
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
  }): Promise<void>;
  recordLegacy?(accountId: string, rows: CapcutAccountResult['tasks']): void;
}

export interface AutomationRunCollaborators {
  workSources: AutomationWorkSourceFactory;
  emailOtp: IEmailOtpSource;
  proxies: IProxyLeaseSource;
  browser: IBrowserRuntimeApi;
  accounts: IAccountSink;
  logBus: Pick<LogBus, 'emit'>;
  launcher?: () => BrowserLauncher | null;
  capcut?: CapcutTaskRunner;
  httpOnlyRunner?: HttpOnlyAccountRunner;
  taskProgress?: ICapcutTaskProgressSink;
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
}

type ThreadOutcome =
  | { kind: 'completed'; status: 'done'; step: string }
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
}

interface ThreadRuntime {
  runId: string;
  workerAlias: string;
  accountId: string;
  email: string;
  capcutPassword: string;
  purchasedEmailId?: string;
  lease?: AcquiredProxyLease;
  directProxy?: BrowserProxySettings;
  session?: BrowserSessionRuntime;
  sessionSequence: number;
  sessionRecycleCount: number;
  outcomeStep?: string;
  outcome?: ThreadOutcome;
  completionPromise?: Promise<void>;
  notifyDone?: () => void;
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
    rest = schemeMatch[2];
  }

  const parts = rest.split(':').map((part) => part.trim());
  const host = parts[0];
  const port = Number(parts[1]);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const settings: BrowserProxySettings = { host, port, type };
  if (parts[2]) settings.username = parts[2];
  if (parts[3]) settings.password = parts[3];
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
  private uiScheduler: RunUiInteractionScheduler | null = null;
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
  private starting: Promise<{ runId: string }> | null = null;
  private stopping: Promise<void> | null = null;
  private lastSummary: AutomationRunSummary | null = null;
  private runAbort: AbortController | null = null;
  private acquisitionAbort: AbortController | null = null;
  private terminalIntent: AutomationTerminalReasonDTO | null = null;
  private terminalState: 'blocked' | 'failed' | 'stopped' | null = null;
  private readonly iterationAbort = new Map<string, AbortController>();
  private cleanupFailures = 0;
  private startedProfiles: string[] = [];
  private readonly activeThreads = new Map<string, ThreadRuntime>();
  private runningResolvers: Array<() => void> = [];
  private firstWaveDone = false;

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
    return this.activeRun !== null || this.starting !== null || this.stopping !== null;
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
    for (const listener of this.listeners) listener(this.progress);
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

    entries.forEach((entry, index) => {
      const proxy = parseDirectProxy(entry);
      if (proxy) parsed.push(proxy);
      else badLines.push('dòng ' + (index + 1));
    });

    if (badLines.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không đọc được ' + badLines.length + ' dòng proxy (' + badLines.join(', ') + '). ' +
          'Định dạng: ip:port[:user:pass] hoặc socks5://ip:port[:user:pass] ' +
          '(scheme: http, https, socks4, socks5). Không chạy tiếp để tránh luồng đi bằng IP thật.'
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

  private recordOutcome(thread: ThreadRuntime, outcome: ThreadOutcome): void {
    if (thread.outcome) return;
    thread.outcome = outcome;
    this.deps.accounts.update(thread.accountId, {
      status: outcome.status,
      automationStep: outcome.step
    });
    if (outcome.kind === 'completed') this.increment('accountsCompleted');
    if (outcome.kind === 'failed') this.increment('accountsFailed');
    if (outcome.kind === 'stopped') this.increment('accountsStopped');
  }

  private acceptTerminalError(error: unknown): void {
    if (this.terminalIntent) return;

    if (error instanceof AutomationTerminalError) {
      this.terminalIntent = error.reason;
      this.terminalState = error.state;
      this.acquisitionAbort?.abort(error);
      if (error.state === 'failed') {
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

  private startProfileStop(session: BrowserSessionRuntime, profileId: string): Promise<boolean> {
    if (session.profileStopPromise) return session.profileStopPromise;
    const stopOp = (async (): Promise<boolean> => {
      try {
        if (session.launcher) {
          await session.launcher.stop(profileId);
        } else {
          await this.deps.browser.stopProfile(profileId);
        }
        session.stopFailed = false;
        return true;
      } catch {
        session.stopFailed = true;
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
      if (thread.session === session) {
        thread.session = undefined;
      }
      return true;
    }

    // 2. We have a profileId. Start profile stop if not already started.
    const profileId = session.profileId;
    const stopOp = this.startProfileStop(session, profileId);

    // 3. Await profile stop with profileStopTimeoutMs
    let stopSuccess = false;
    try {
      stopSuccess = await withTimeout(
        stopOp,
        this.profileStopTimeoutMs,
        new Error('Profile stop timeout')
      );
    } catch {
      stopSuccess = false;
    }

    if (stopSuccess) {
      session.stopFailed = false;
      session.scheduler?.confirmProfileStopped(session.alias);
      try {
        this.telemetry?.record({
          schemaVersion: 1,
          runId: thread.runId,
          workerAlias: thread.workerAlias,
          sessionAlias: session.alias,
          at: new Date().toISOString(),
          type: 'profile-stop',
          outcome: 'confirmed'
        });
      } catch {
        // Telemetry error ignored
      }
      if (thread.session === session) {
        thread.session = undefined;
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
    this.noteCleanupFailure(thread, 'browser-profile');
    try {
      this.telemetry?.record({
        schemaVersion: 1,
        runId: thread.runId,
        workerAlias: thread.workerAlias,
        sessionAlias: session.alias,
        at: new Date().toISOString(),
        type: 'profile-stop',
        outcome: 'failed',
        code: 'RESOURCE_CLEANUP_FAILED'
      });
    } catch {
      // Telemetry error ignored
    }

    const terminalError = new AutomationTerminalError(
      'failed',
      {
        code: 'RESOURCE_CLEANUP_FAILED',
        details: { cleanupFailures: this.cleanupFailures }
      },
      message
    );

    if (session.scheduler) {
      session.scheduler.shutdown(terminalError);
    } else if (this.uiScheduler) {
      this.uiScheduler.shutdown(terminalError);
    }

    if (this.stopping || this.activeThreads.size > 1 || thread.outcome?.kind !== 'completed') {
      for (const controller of this.iterationAbort.values()) {
        controller.abort(terminalError);
      }
      this.acceptTerminalError(terminalError);
    }

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
    lease: AcquiredProxyLease | undefined
  ): Promise<void> {
    if (item && !committed) {
      try {
        source.release(item);
      } catch {
        this.noteCleanupFailure(thread, 'mailbox-reservation');
      }
    }

    if (thread) {
      if (thread.session) {
        await this.stopSession(thread, thread.session);
      }
      if (!thread.session) {
        this.activeThreads.delete(thread.accountId);
      }
      this.iterationAbort.delete(thread.accountId);
    }

    if (lease) {
      try {
        await this.deps.proxies.release(lease);
      } catch {
        this.noteCleanupFailure(thread, 'proxy-lease');
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
    const capcutPassword = generateCapcutPassword(config.password);
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

    const threadController = new AbortController();
    this.iterationAbort.set(created.id, threadController);

    let notifyDone: () => void = () => {};
    const completionPromise = new Promise<void>((resolve) => {
      notifyDone = resolve;
    });

    const runtime: ThreadRuntime = {
      runId,
      workerAlias,
      accountId: created.id,
      email: item.email,
      capcutPassword,
      purchasedEmailId: item.purchasedEmailId,
      lease,
      directProxy: slotProxy,
      sessionSequence: 0,
      sessionRecycleCount: 0,
      completionPromise,
      notifyDone
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
        const started = await launcher.launch({
          proxy: toLauncherProxy(proxy),
          headless: config.headless,
          signal,
          ui: session.ui,
          onProfileStarted: (profileId: string) => {
            session.profileId = profileId;
            if (!this.startedProfiles.includes(profileId)) {
              this.startedProfiles.push(profileId);
            }
            if (session.stopRequested) {
              void this.startProfileStop(session, profileId);
            }
          }
        });
        if (session.stopRequested) {
          if (started.profileId) {
            session.profileId = started.profileId;
            void this.startProfileStop(session, started.profileId);
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
        const started = await this.deps.browser.startProfile({
          headless: config.headless,
          proxy,
          browser: config.browser,
          signal,
          onProfileStarted: (profileId: string) => {
            session.profileId = profileId;
            if (!this.startedProfiles.includes(profileId)) {
              this.startedProfiles.push(profileId);
            }
            if (session.stopRequested) {
              void this.startProfileStop(session, profileId);
            }
          }
        });
        if (session.stopRequested) {
          if (started.profileId) {
            session.profileId = started.profileId;
            void this.startProfileStop(session, started.profileId);
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
        attempt += 1;
        try {
          const code = await this.deps.emailOtp.readOtp(purchasedEmailId);
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
        await this.holdForThread(5_000, signal);
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
    const alias = `${thread.workerAlias}-session-${++thread.sessionSequence}`;
    const session: BrowserSessionRuntime = {
      alias,
      startedAt: Date.now(),
      stopRequested: false,
      ui: this.uiScheduler
        ? this.uiScheduler.forSession({ sessionAlias: alias, signal })
        : createDirectUiInteraction(signal),
      scheduler: this.uiScheduler ?? undefined
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

    return await uiRunner.runAccount({
      page: session.page,
      context: session.context,
      email: thread.email,
      password,
      accountId: thread.accountId,
      isNewAccount: authAttempt === 'existing-only' ? false : thread.purchasedEmailId !== undefined,
      authAttempt,
      runId: thread.runId,
      sessionAlias: session.alias,
      sessionStartedAt: session.startedAt,
      signal,
      ui: session.ui,
      getOtp: authAttempt === 'existing-only' ? undefined : this.buildOtpReader(thread, signal),
      maxRounds: Math.max(1, Math.min(1 + config.retryCount, 4)),
      pace: {
        stepMinMs: config.stepDelayMinMs,
        stepMaxMs: config.stepDelayMaxMs,
        typeMinMs: config.typeDelayMinMs,
        typeMaxMs: config.typeDelayMaxMs
      },
      skipWithoutTrial: config.skipWithoutTrial,
      unsettledProofs,
      onTaskCheckpoint: async (checkpoint: {
        rows: CapcutAccountResult['tasks'];
        receipt: CapcutVerificationReceipt;
      }) => {
        if (thread.session !== session) {
          this.log(
            'WARNING',
            thread.email,
            'Nhiệm vụ',
            `Bỏ qua checkpoint muộn từ session cũ ${session.alias} (hiện tại: ${thread.session?.alias ?? 'none'}).`,
            thread.accountId
          );
          return;
        }

        const uniqueTasks = new Map<string, { key: string; status: number }>();
        for (const r of checkpoint.rows) {
          uniqueTasks.set(r.key, { key: r.key, status: r.status });
        }
        try {
          this.telemetry?.record({
            schemaVersion: 1,
            runId: thread.runId,
            workerAlias: thread.workerAlias,
            sessionAlias: session.alias,
            at: new Date().toISOString(),
            type: 'task-checkpoint',
            fresh: checkpoint.receipt.fresh,
            final: checkpoint.receipt.final,
            observedAt: checkpoint.receipt.observedAt,
            requiredAfter: checkpoint.receipt.requiredAfter,
            serverTotal: checkpoint.receipt.serverTotal,
            serverDone: checkpoint.receipt.serverDone,
            tasks: Array.from(uniqueTasks.values())
          });
        } catch {
          // Telemetry error ignored
        }

        if (this.deps.taskProgress) {
          await this.deps.taskProgress.record(thread.accountId, checkpoint);
        }
      },
      log: (status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', step: string, message: string) =>
        this.log(status, thread.email, step, message, thread.accountId)
    });
  }

  private classifyUiResult(
    thread: ThreadRuntime,
    result: CapcutAccountResult | CapcutUiAccountResult,
    config: AutomationRunConfigDTO
  ): ThreadOutcome {
    if (result.skipped) {
      thread.outcomeStep = 'Bỏ qua — không đủ điều kiện';
      this.deps.accounts.update(thread.accountId, {
        automationStep: thread.outcomeStep,
        ...(result.subscription ? { subscription: result.subscription } : {})
      });
      return {
        kind: 'completed',
        status: 'done',
        step: thread.outcomeStep
      };
    }

    const uiResult = result as Partial<CapcutUiAccountResult>;
    if (uiResult.verification === undefined) {
      this.recordTaskProgress(thread, result.tasks);
    }
    const full = config.missionTransport === 'http-only' || uiResult.verification === undefined
      ? result.missing.length === 0
      : Boolean(
          uiResult.verification &&
          uiResult.verification.complete &&
          uiResult.verification.fresh &&
          uiResult.verification.final
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

    if (result.fatalError) {
      this.log('ERROR', thread.email, 'Nhiệm vụ', result.fatalError, thread.accountId);
      return { kind: 'failed', status: 'error', step: 'Lỗi khi làm nhiệm vụ: ' + result.fatalError };
    }

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
      await this.holdForThread(config.testDurationMs, iterationSignal);
      return { kind: 'completed', status: 'done', step: thread.outcomeStep ?? 'Hoàn tất' };
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
      await this.holdForThread(config.testDurationMs, iterationSignal);
      return { kind: 'completed', status: 'done', step: thread.outcomeStep ?? 'Hoàn tất' };
    }

    this.deps.accounts.update(thread.accountId, { automationStep: 'Đang làm nhiệm vụ' });
    try {
      if (config.missionTransport === 'http-only') {
        const httpRunner = this.deps.httpOnlyRunner;
        if (!httpRunner) throw new Error('HTTP-only account runner ownership was lost.');
        const proxy = thread.lease ? leaseToProxySettings(thread.lease) : thread.directProxy;
        const result = await httpRunner.runAccount({
          email: thread.email,
          password,
          accountId: thread.accountId,
          isNewAccount: thread.purchasedEmailId !== undefined,
          signal: iterationSignal,
          getOtp: this.buildOtpReader(thread, iterationSignal),
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

      let authAttempt: CapcutAuthAttempt = 'initial';
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
            try {
              this.telemetry?.record({
                schemaVersion: 1,
                runId: thread.runId,
                workerAlias: thread.workerAlias,
                sessionAlias: currentSession.alias,
                at: new Date().toISOString(),
                type: 'persistence-failure',
                code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED'
              });
            } catch {
              // Telemetry error ignored
            }
            const stopped = await this.stopSession(thread, currentSession);
            if (stopped) {
              this.acceptTerminalError(error);
            }
            return {
              kind: 'failed',
              status: 'error',
              step: 'Không lưu được checkpoint nhiệm vụ'
            };
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
                step: 'Đã dừng theo yêu cầu'
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
      if (iterationSignal.aborted || this.runAbort?.signal.aborted) {
        return {
          kind: 'stopped',
          status: 'stopped',
          step: 'Đã dừng theo yêu cầu'
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
    slotProxy: BrowserProxySettings | undefined,
    acquisitionSignal: AbortSignal,
    initialWave: InitialWaveBarrier | null
  ): Promise<void> {
    let firstIteration = true;
    while (!acquisitionSignal.aborted && !this.terminalIntent) {
      if (source.isExhausted?.()) {
        if (firstIteration) this.releaseRunningWaiters();
        return;
      }
      let item: AutomationWorkItem | null =
        source.kind === 'finite'
          ? await measureStage(
              'email-acquisition',
              () => source.next(workerId, acquisitionSignal),
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
            () => this.deps.proxies.acquire(acquisitionSignal),
            (message) =>
              this.log(
                'INFO',
                item?.email ?? workerId,
                'Timing',
                message,
                thread?.accountId
              )
          );
          this.log('SUCCESS', item?.email ?? workerId, 'Proxy', 'Đã nhận proxy ' + lease.ip + ':' + lease.port);
        }
        if (source.kind === 'continuous') {
          item = await measureStage(
            'email-acquisition',
            () => source.next(workerId, acquisitionSignal),
            (message) => this.log('INFO', workerId, 'Timing', message)
          );
        }
        if (!item) {
          if (firstIteration) this.releaseRunningWaiters();
          await this.cleanupIteration(source, item, committed, thread, lease);
          this.publish(this.progress.state, this.progress.message, {
            workersActive: Math.max(0, this.progress.workersActive - 1)
          });
          return;
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
              slotProxy,
              lease,
              this.progress.runId,
              workerId
            );
            this.increment('accountsAccepted');
            const iterationSignal = this.iterationAbort.get(thread.accountId)?.signal;
            if (!iterationSignal) throw new Error('Iteration cancellation owner was lost.');
            try {
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
              if (item!.purchasedEmailId) {
                source.commit(item!, thread.accountId);
                committed = true;
              }
              const outcome = await this.runThreadWorkload(thread!, config, iterationSignal);
              this.recordOutcome(thread!, outcome);
            } catch (err: unknown) {
              if (firstIteration) {
                this.releaseRunningWaiters();
              }
              if (err instanceof AutomationTerminalError) {
                throw err;
              }
              this.recordOutcome(
                thread!,
                this.runAbort?.signal.aborted === true ||
                    this.iterationAbort.get(thread!.accountId)?.signal.aborted === true
                  ? { kind: 'stopped', status: 'stopped', step: 'Đã dừng theo yêu cầu' }
                  : { kind: 'failed', status: 'error', step: 'Lỗi khi khởi chạy hoặc xử lý' }
              );
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
                  await this.cleanupIteration(source, item, committed, thread, lease);
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
          (message) =>
            this.log(
              'INFO',
              thread?.email ?? item?.email ?? 'system',
              'Timing',
              message,
              thread?.accountId
            )
        );
      } catch (error: unknown) {
        if (firstIteration) {
          this.releaseRunningWaiters();
        }
        if (!acquisitionSignal.aborted) {
          this.acceptTerminalError(error);
        }
        if (!thread) {
          await this.cleanupIteration(source, item, committed, thread, lease);
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
    directProxies: BrowserProxySettings[]
  ): Promise<AutomationRunSummary> {
    const missionTransport = config.missionTransport ?? 'ui';
    this.uiScheduler = missionTransport !== 'http-only' && !config.headless
      ? new RunUiInteractionScheduler({
          editorLaneLimit: 1,
          onEvent: (event) => {
            try {
              this.telemetry?.record(mapUiSchedulerEventToEvidence(this.progress.runId, event));
            } catch {
              // Telemetry error ignored
            }
          }
        })
      : null;

    try {
      try {
        this.telemetry?.record({
          schemaVersion: 1,
          runId: this.progress.runId,
          at: new Date().toISOString(),
          type: 'run-start',
          mode: 'new',
          headed: true,
          stage: 1,
          workerTarget: readiness.workerTarget,
          maxBillablePurchases: config.mailLimit ?? 0
        });
      } catch {
        // Telemetry record error ignored
      }

      const workerTarget = readiness.workerTarget;
      const initialWave = source.kind === 'continuous' ? new InitialWaveBarrier(workerTarget) : null;
      const acquisitionSignal = this.acquisitionAbort!.signal;

      const workers = Array.from({ length: workerTarget }, (_, i) => {
        const slotProxy = config.proxy.mode === 'direct' ? directProxies[i] : undefined;
        return this.workerLoop(
          'worker-' + (i + 1),
          source,
          config,
          slotProxy,
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

      try {
        await this.deps.proxies.releaseAll();
      } catch {
        this.noteCleanupFailure(undefined, 'proxy-lease');
      }

      let finalReason: AutomationTerminalReasonDTO | undefined = this.terminalIntent ?? undefined;
      if (!finalReason) {
        if ((config.mailLimit ?? 0) > 0 && this.progress.accountsAccepted >= config.mailLimit!) {
          finalReason = { code: 'MAIL_LIMIT_REACHED', details: { mailLimit: config.mailLimit! } };
        } else if (source.kind === 'finite') {
          finalReason = { code: 'MANUAL_EXHAUSTED' };
        } else {
          finalReason = { code: 'INTERNAL_ERROR' };
        }
      }

      const hasCleanupFailure = this.cleanupFailures > 0 || this.activeThreads.size > 0;
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

      if (this.terminalIntent?.code === 'USER_STOP' || this.terminalIntent?.code === 'APP_SHUTDOWN') {
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
      this.uiScheduler = null;
      if (this.telemetry) {
        const finalState: 'completed' | 'failed' | 'stopped' | 'blocked' =
          this.progress.state === 'completed' || this.progress.state === 'failed' ||
          this.progress.state === 'stopped' || this.progress.state === 'blocked'
            ? this.progress.state
            : (this.terminalState ?? 'failed');

        const terminalCode: AutomationTerminalCode =
          this.terminalIntent?.code ?? (
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
          state: finalState,
          code: terminalCode,
          accepted: this.progress.accountsAccepted,
          completed: this.progress.accountsCompleted,
          failed: this.progress.accountsFailed,
          stopped: this.progress.accountsStopped,
          skipped: 0,
          cleanupFailures: this.cleanupFailures,
          purchaseAttempted: 0,
          purchaseConfirmed: 0,
          purchaseAmbiguous: 0
        };

        await this.telemetry.close(terminalEvent).catch(() => {});
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

  async stopThread(accountId: string): Promise<boolean> {
    const thread = this.activeThreads.get(accountId);
    const controller = this.iterationAbort.get(accountId);
    if (!thread) return false;

    controller?.abort(new Error('stopThread requested'));
    let stopped = true;
    if (thread.session) {
      if (thread.session.stopFailed) {
        thread.session.profileStopPromise = undefined;
        thread.session.stopPromise = undefined;
      }
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

  start(config: AutomationRunConfigDTO): Promise<{ runId: string }> {
    if (this.isRunning() || this.activeThreads.size > 0) {
      return Promise.reject(new ProviderError('CONFIG_ERROR', 'Đang có phiên hoặc profile chưa dừng, hãy dừng trước khi bắt đầu.'));
    }
    this.uiScheduler = null;
    const runId = this.nextId();
    this.telemetry = this.runtime.createTelemetry?.(runId) ?? (
      this.runtime.userDataDir
        ? createRunTelemetry({ userDataDir: this.runtime.userDataDir, runId })
        : null
    );
    this.runAbort = new AbortController();
    this.acquisitionAbort = new AbortController();
    this.terminalIntent = null;
    this.terminalState = null;
    this.iterationAbort.clear();
    this.cleanupFailures = 0;
    this.startedProfiles = [];
    this.firstWaveDone = false;
    const runSignal = this.runAbort.signal;
    const operation = Promise.resolve().then(async () => {
      try {
        return await this.prepareRun(config, runId, runSignal);
      } catch (error: unknown) {
        if (!runSignal.aborted) throw error;
        this.publish('stopped', 'Đã dừng trước khi khởi chạy.', { terminalReason: this.terminalIntent ?? { code: 'USER_STOP' } });
        this.lastSummary = { ...this.progress, startedProfiles: [...this.startedProfiles] };
        if (this.telemetry) {
          await this.telemetry.close({
            schemaVersion: 1,
            runId,
            at: new Date().toISOString(),
            type: 'terminal',
            state: 'stopped',
            code: 'USER_STOP',
            accepted: 0,
            completed: 0,
            failed: 0,
            stopped: 0,
            skipped: 0,
            cleanupFailures: 0,
            purchaseAttempted: 0,
            purchaseConfirmed: 0,
            purchaseAmbiguous: 0
          }).catch(() => {});
        }
        return { runId };
      } finally {
        this.starting = null;
      }
    });
    this.starting = operation;
    return operation;
  }

  private async prepareRun(config: AutomationRunConfigDTO, runId: string, runSignal: AbortSignal): Promise<{ runId: string }> {
    const workerTarget = (config.mailLimit ?? 0) > 0 ? Math.min(config.threadCount, config.mailLimit!) : config.threadCount;
    this.publish('preparing', 'Đang chuẩn bị dữ liệu cho phiên chạy...', {
      runId, workerTarget, workersActive: 0,
      accountsAccepted: 0, accountsCompleted: 0, accountsFailed: 0, accountsStopped: 0,
      terminalReason: undefined
    });
    runSignal.throwIfAborted();

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
    try {
      directProxies = config.proxy.mode === 'direct'
        ? this.parseDirectProxyList(config.proxy.entries, workerTarget)
        : [];
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
      this.deps.proxies.configure?.({ keys: config.proxy.keys, region: config.proxy.region });
      const slots = await this.deps.proxies.availableSlots?.();
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

    const source = this.deps.workSources.create(config, runId);
    let readiness: SourceReadiness;
    try {
      readiness = await measureStage(
        'source-preflight',
        () => source.prepare(workerTarget, runSignal),
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

    runSignal.throwIfAborted();
    this.publish('running', 'Đang chạy ' + readiness.workerTarget + ' luồng...', {
      workerTarget: readiness.workerTarget
    });

    this.activeRun = this.runPrepared(source, readiness, config, directProxies)
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
      });

    return { runId };
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
    if (!this.starting && !this.activeRun && this.activeThreads.size === 0) return Promise.resolve();
    this.terminalIntent = { code };
    this.publish('stopping', 'Đang dừng các browser của phiên chạy...');
    this.runAbort?.abort(new Error(code));
    this.acquisitionAbort?.abort(new Error(code));
    for (const controller of this.iterationAbort.values()) {
      controller.abort(new Error(code));
    }
    this.stopping = Promise.resolve().then(async () => {
      this.log('INFO', 'system', 'Stop', 'Đã nhận yêu cầu dừng; không nhận thêm công việc.');
      await Promise.all(Array.from(this.activeThreads.values()).map(async (thread) => {
        if (thread.session) {
          if (thread.session.stopFailed) {
            thread.session.profileStopPromise = undefined;
            thread.session.stopPromise = undefined;
          }
          await this.stopSession(thread, thread.session);
        }
        if (!thread.session) {
          this.activeThreads.delete(thread.accountId);
        }
      }));
      if (this.starting) await this.starting.catch(() => undefined);
      if (this.activeRun) await this.activeRun;
      if (this.activeThreads.size > 0 || this.terminalState === 'failed') {
        const message = 'Chưa dừng được ' + this.activeThreads.size + ' profile. Bấm Dừng để thử lại.';
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
