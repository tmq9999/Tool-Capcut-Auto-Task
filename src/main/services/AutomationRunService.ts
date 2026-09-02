import crypto from 'node:crypto';
import type { BrowserContext as CapcutContext, Page as CapcutPage } from 'playwright-core';
import { ProviderError } from '../providers/ProviderError';
import { generateCapcutPassword } from './passwordGenerator';
import type { BrowserLauncher, LauncherProxy } from './capcut/launcher';
import type { LogBus } from './LogBus';
import type { AcquiredProxyLease } from './ProxyLeaseManager';
import type { EmailPurchaseResult } from './EmailPurchaseService';
import type { EmailSourceProvider } from '../../shared/schemas/provider.schema';
import type {
  AutomationRunConfigDTO,
  AutomationRunProgressDTO,
  AutomationRunState,
  BrowserRuntime
} from '../../shared/schemas/automation.schema';
import type {
  AccountCreateInputDTO,
  AccountUpdateInputDTO
} from '../../shared/schemas/account.schema';

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
  }): Promise<StartedProfile>;
  stopProfile(profileId: string): Promise<void>;
}

export interface IEmailSourceApi {
  purchase(
    provider: EmailSourceProvider,
    count: number,
    options?: { service?: string }
  ): Promise<EmailPurchaseResult>;
  markConsumed(purchasedEmailId: string, accountId: string | null): void;
  /**
   * Đọc OTP của mailbox đã mua. Tuỳ chọn để test cũ không phải khai thêm; thiếu
   * nó thì đường ĐĂNG KÝ không chạy được và engine sẽ báo lỗi rõ thay vì treo.
   */
  readOtp?(purchasedEmailId: string, type?: string): Promise<string | null>;
}

export interface IProxyLeaseSource {
  acquire(): Promise<AcquiredProxyLease>;
  release(lease: AcquiredProxyLease): Promise<void>;
  releaseAll(): Promise<void>;
  /**
   * How many threads can hold a proxy at the same time — the account's key
   * count. null means no known ceiling.
   */
  availableSlots?(): Promise<number | null>;
  /** Narrows the source to the keys this run may use. */
  configure?(options: { keys?: string[] }): void;
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
  /** Account bị bỏ qua có chủ ý (ví dụ không có ưu đãi trial), không phải lỗi. */
  skipped?: boolean;
  /**
   * Tiến độ TỪNG nhiệm vụ, để lưu xuống SQLite (`docs/MERGE-PLAN.md` §4 Pha 5).
   *
   * `status` là `task_status` của CHÍNH CapCut (1 chưa xong · 2 chờ nhận · 4 xong)
   * chứ không phải cờ nội bộ: bộ đếm nội bộ của bản CLI đã đo được là báo THỪA,
   * nên chỉ con số của CapCut mới so sánh được với lượt sau.
   *
   * `opId` là `op_id` của `do_action` (`<task_key>_<userId>_<YYYY-MM-DD>`) — giữ
   * nguyên khái niệm chống ghi trùng của `ledger.ts` bên engine CLI.
   */
  tasks: Array<{
    key: string;
    title: string;
    reward: number;
    status: number;
    opId?: string;
    provedAt?: string;
  }>;
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
    /** Nguồn OTP của riêng luồng này; chỉ đường ĐĂNG KÝ cần. */
    getOtp?: () => Promise<string>;
    /** `retryCount` của Dashboard, đã đổi sang số lượt quét lại nhiệm vụ. */
    maxRounds?: number;
    /**
     * Hai ô delay của Dashboard, đã đổi tên sang thuật ngữ của engine. Engine chỉ
     * dùng chúng để CHẬM HƠN nhịp đã đo (có sàn ở `humanType`), nên đặt 0 không
     * làm bot gõ nhanh hơn khoảng an toàn.
     */
    pace?: { stepMinMs: number; stepMaxMs: number; typeMinMs: number; typeMaxMs: number };
    log: (status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', step: string, message: string) => void;
  }): Promise<CapcutAccountResult>;
}

/**
 * Nơi lưu tiến độ từng nhiệm vụ xuống SQLite.
 *
 * Khai như một collaborator (không import repository) vì AGENTS.md §11 buộc mọi
 * SQL nằm sau tầng repository, và §7 buộc phụ thuộc chảy vào trong: service chỉ
 * biết "đưa rows vào", chỗ wiring mới biết bảng nào.
 */
export interface ICapcutTaskProgressSink {
  record(accountId: string, rows: CapcutAccountResult['tasks']): void;
}

export interface AutomationRunCollaborators {
  emails: IEmailSourceApi;
  proxies: IProxyLeaseSource;
  browser: IBrowserRuntimeApi;
  accounts: IAccountSink;
  logBus: Pick<LogBus, 'emit'>;
  /**
   * Mở profile KÈM phiên Playwright. Có thì Multilogin đi đường này (xcli hoặc
   * api-v3 tuỳ `app_settings.browser.multilogin.launcher`); không có thì rơi về
   * `browser.startProfile` như trước — nhờ vậy các browser chưa hỗ trợ vẫn báo
   * `PROVIDER_NOT_IMPLEMENTED` y như cũ.
   */
  launcher?: () => BrowserLauncher | null;
  /** Không có thì luồng chỉ giữ browser `testDurationMs` như trước khi gộp. */
  capcut?: CapcutTaskRunner;
  /**
   * Nơi lưu tiến độ từng nhiệm vụ. Tuỳ chọn để mọi test/script cũ không phải khai
   * thêm; không có thì luồng chạy y như trước, chỉ là lượt sau không biết nhiệm vụ
   * nào đã xong.
   *
   * Service này KHÔNG tự viết SQL (AGENTS.md §11): chỗ wiring cắm vào
   * `AccountTaskRepository`.
   */
  taskProgress?: ICapcutTaskProgressSink;
}

export interface AutomationRunDeps {
  sleep?: (ms: number) => Promise<void>;
  nextId?: () => string;
}

export interface AutomationRunSummary extends AutomationRunProgressDTO {
  startedProfiles: string[];
}

/** One live thread, addressable so the UI can stop just this one. */
export interface RunningThreadInfo {
  accountId: string;
  email: string;
  profileId: string;
}

interface ThreadPlan {
  email: string;
  emailProvider: string;
  emailPassword?: string;
  purchasedEmailId?: string;
  directProxy?: BrowserProxySettings;
}

interface ThreadRuntime {
  accountId: string;
  email: string;
  /** Mật khẩu CapCut đã sinh cho account này; bước làm nhiệm vụ cần để đăng nhập. */
  capcutPassword: string;
  /** Mailbox đã mua cho luồng này; cần để đọc OTP ở đường đăng ký. */
  purchasedEmailId?: string;
  profileId?: string;
  /**
   * Cổng remote-debugging của profile. Launcher chỉ publish cổng này khi profile
   * được start kèm automation type, nên giữ lại đây để bước làm nhiệm vụ
   * `connectOverCDP` vào đúng browser của luồng này.
   */
  port?: number | null;
  lease?: AcquiredProxyLease;
  /** Phiên Playwright của luồng này, chỉ có khi profile mở qua `BrowserLauncher`. */
  page?: CapcutPage;
  context?: CapcutContext;
  /** Ai đã mở thì người đó đóng — không để hai đường tranh nhau tắt một profile. */
  launcher?: BrowserLauncher;
}

function parseManualEntry(entry: string): { email: string; password?: string } | null {
  const parts = entry.split('|').map((part) => part.trim());
  const email = parts[0];
  if (!email || !email.includes('@')) return null;
  return { email, password: parts[1] || undefined };
}

/** Accepts host:port, host:port:user:pass. */
function parseDirectProxy(entry: string): BrowserProxySettings | null {
  const parts = entry.split(':').map((part) => part.trim());
  const host = parts[0];
  const port = Number(parts[1]);
  if (!host || !Number.isFinite(port) || port <= 0) return null;
  const settings: BrowserProxySettings = { host, port, type: 'http' };
  if (parts[2]) settings.username = parts[2];
  if (parts[3]) settings.password = parts[3];
  return settings;
}

/**
 * Proxy của app (`{host, port: number, type}`) sang dạng launcher cần
 * (`{scheme, host, port: string}`). Giữ nguyên user/pass nếu có — `XcliLauncher`
 * sẽ tự từ chối bằng `CONFIG_ERROR` vì engine chưa từng đo cờ user/pass cho
 * `xcli`, thà báo rõ hơn là vỡ giữa phiên bằng ERR_PROXY_CONNECTION_FAILED.
 */
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

/**
 * Executes one Dashboard run: obtain a mailbox per thread, give each thread its
 * own proxy, launch the configured number of browsers, hold them for the
 * connectivity window, then shut everything down. There is no automation script
 * yet, so the hold is deliberate: it proves the browser, proxy and mailbox
 * plumbing works end to end.
 */
export class AutomationRunService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nextId: () => string;
  private readonly listeners = new Set<(progress: AutomationRunProgressDTO) => void>();

  private progress: AutomationRunProgressDTO = {
    runId: 'none',
    state: 'idle',
    threadTotal: 0,
    threadsStarted: 0,
    threadsStopped: 0,
    threadsFailed: 0,
    message: 'Chưa chạy'
  };

  private activeRun: Promise<AutomationRunSummary> | null = null;
  private lastSummary: AutomationRunSummary | null = null;
  private stopRequested = false;
  /** Resolved once when a stop is requested; every worker races its hold against it. */
  private stopSignal: Promise<void> | null = null;
  private fireStop: (() => void) | null = null;
  private startedProfiles: string[] = [];
  /** Live threads keyed by account id. A thread leaves the map as soon as it stops. */
  private readonly activeThreads = new Map<string, ThreadRuntime>();
  private runningResolvers: Array<() => void> = [];
  /** True once the first wave of threads has finished launching. */
  private firstWaveDone = false;

  constructor(
    private readonly deps: AutomationRunCollaborators,
    runtime: AutomationRunDeps = {}
  ) {
    this.sleep = runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nextId = runtime.nextId ?? (() => crypto.randomUUID());
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
    return this.activeRun !== null;
  }

  private publish(state: AutomationRunState, message: string, patch: Partial<AutomationRunProgressDTO> = {}): void {
    this.progress = { ...this.progress, ...patch, state, message };
    for (const listener of this.listeners) {
      listener(this.progress);
    }
  }

  private log(status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', email: string, step: string, message: string, accountId?: string): void {
    this.deps.logBus.emit({ accountId, email, step, status, message });
  }

  private async buildThreadPlans(config: AutomationRunConfigDTO): Promise<ThreadPlan[]> {
    const directProxies = config.proxy.mode === 'direct'
      ? config.proxy.entries.flatMap((entry) => {
          const parsed = parseDirectProxy(entry);
          return parsed ? [parsed] : [];
        })
      : [];

    let plans: ThreadPlan[];
    const source = config.emailSource;

    if (source.mode === 'api' || source.mode === 'custom') {
      const isCustomDomain = source.mode === 'custom';
      const provider: EmailSourceProvider = source.mode === 'custom'
        ? 'customdomain'
        : source.provider;

      this.log(
        'INFO',
        'system',
        'Email',
        isCustomDomain
          ? 'Đang tạo ' + config.threadCount + ' email trên domain tự sở hữu...'
          : 'Đang mua ' + config.threadCount + ' email từ ' + provider + '...'
      );

      const result = await this.deps.emails.purchase(provider, config.threadCount, {
        service: source.mode === 'custom' ? undefined : source.service
      });

      for (const failure of result.failures) {
        this.log('WARNING', 'system', 'Email', 'Lấy email thất bại: ' + failure);
      }

      if (result.purchased.length === 0) {
        throw new ProviderError(
          'CONFIG_ERROR',
          isCustomDomain
            ? 'Không tạo được email nào trên domain tự sở hữu. Kiểm tra domain trong Settings.'
            : 'Không mua được email nào từ ' + provider + '. Kiểm tra API key và số dư.',
          provider
        );
      }

      plans = result.purchased.map((row) => ({
        email: row.email,
        emailProvider: row.provider,
        purchasedEmailId: row.id
      }));
    } else {
      const parsed = source.entries.flatMap((entry) => {
        const row = parseManualEntry(entry);
        return row ? [row] : [];
      });

      if (parsed.length === 0) {
        throw new ProviderError(
          'CONFIG_ERROR',
          'Danh sách email thủ công đang trống hoặc không đúng định dạng email|password.'
        );
      }

      plans = parsed.slice(0, config.threadCount).map((row) => ({
        email: row.email,
        emailProvider: 'manual',
        emailPassword: row.password
      }));
    }

    return plans.slice(0, config.threadCount).map((plan, index) => ({
      ...plan,
      directProxy: config.proxy.mode === 'direct' ? directProxies[index] : undefined
    }));
  }

  private async launchThread(
    plan: ThreadPlan,
    config: AutomationRunConfigDTO
  ): Promise<ThreadRuntime | null> {
    const capcutPassword = generateCapcutPassword(config.password);
    const created = this.deps.accounts.create({
      email: plan.email,
      emailProvider: plan.emailProvider,
      emailPassword: plan.emailPassword,
      passwordCapcut: capcutPassword,
      credit: 0,
      status: 'processing',
      automationStep: 'Đang khởi chạy browser',
      browserProvider: config.browser
    });

    if (plan.purchasedEmailId) {
      this.deps.emails.markConsumed(plan.purchasedEmailId, created.id);
    }

    const runtime: ThreadRuntime = {
      accountId: created.id,
      email: plan.email,
      capcutPassword,
      purchasedEmailId: plan.purchasedEmailId
    };

    let proxy: BrowserProxySettings | undefined = plan.directProxy;
    if (config.proxy.mode === 'proxykey') {
      // Acquiring can block while every key is busy or still inside its rotation
      // window, so say so before waiting — otherwise a queued thread looks hung.
      this.log('INFO', plan.email, 'Proxy', 'Đang xin proxy key rảnh...', created.id);
      try {
        const lease = await this.deps.proxies.acquire();
        runtime.lease = lease;
        proxy = leaseToProxySettings(lease);
        this.log('INFO', plan.email, 'Proxy', 'Đã nhận proxy ' + lease.host + ':' + lease.port, created.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Không lấy được proxy.';
        this.log('ERROR', plan.email, 'Proxy', message, created.id);
        this.deps.accounts.update(created.id, { status: 'error', automationStep: 'Không lấy được proxy' });
        return null;
      }
    }

    try {
      /**
       * Multilogin đi qua `BrowserLauncher` để có luôn phiên Playwright — đó là
       * điều kiện để làm nhiệm vụ. Browser khác vẫn đi `deps.browser` nên
       * GoLogin/GPM/Camoufox/Patchright tiếp tục báo `PROVIDER_NOT_IMPLEMENTED`
       * rõ ràng thay vì fail âm thầm.
       */
      const launcher = config.browser === 'multilogin' ? this.deps.launcher?.() ?? null : null;
      let profileId: string;
      let port: number | null;

      if (launcher) {
        const session = await launcher.launch({
          proxy: toLauncherProxy(proxy),
          headless: config.headless
        });
        profileId = session.profileId;
        port = session.port;
        runtime.page = session.page;
        runtime.context = session.context;
        runtime.launcher = launcher;
      } else {
        const profile = await this.deps.browser.startProfile({
          headless: config.headless,
          proxy,
          browser: config.browser
        });
        profileId = profile.profileId;
        port = profile.port;
      }

      runtime.profileId = profileId;
      runtime.port = port;
      this.startedProfiles.push(profileId);
      this.activeThreads.set(runtime.accountId, runtime);
      this.deps.accounts.update(created.id, {
        status: 'processing',
        automationStep: 'Browser đang chạy',
        browserProfileId: profileId,
        proxy: proxy ? proxy.host + ':' + proxy.port : null
      });
      this.log(
        'SUCCESS',
        plan.email,
        'Browser',
        'Đã mở ' + config.browser + ' profile ' + profileId +
          (port !== null ? ' (port ' + port + ')' : ''),
        created.id
      );
      return runtime;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Không mở được browser.';
      this.log('ERROR', plan.email, 'Browser', message, created.id);
      this.deps.accounts.update(created.id, { status: 'error', automationStep: 'Không mở được browser' });
      if (runtime.lease) {
        await this.deps.proxies.release(runtime.lease);
      }
      return null;
    }
  }

  /**
   * Shuts down exactly one thread: its own browser profile, its own proxy lease,
   * its own account row. Never touches another thread.
   */
  private async shutdownThread(thread: ThreadRuntime, step: string): Promise<boolean> {
    let stoppedProfile = false;

    if (thread.profileId) {
      try {
        // Ai mở thì người đó đóng: profile mở qua launcher phải do launcher tắt
        // vì handle CDP nằm trong launcher; trộn hai đường sẽ để lại profile mồ côi.
        if (thread.launcher) {
          await thread.launcher.stop(thread.profileId);
        } else {
          await this.deps.browser.stopProfile(thread.profileId);
        }
        stoppedProfile = true;
        this.log('INFO', thread.email, 'Browser', 'Đã dừng profile ' + thread.profileId, thread.accountId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Không dừng được browser.';
        this.log('WARNING', thread.email, 'Browser', message, thread.accountId);
      }
    }

    if (thread.lease) {
      await this.deps.proxies.release(thread.lease);
    }

    this.deps.accounts.update(thread.accountId, { status: 'done', automationStep: step });
    return stoppedProfile;
  }

  /** Threads currently running, so the UI can stop one row at a time. */
  getRunningThreads(): RunningThreadInfo[] {
    return Array.from(this.activeThreads.values()).flatMap((thread) =>
      thread.profileId
        ? [{ accountId: thread.accountId, email: thread.email, profileId: thread.profileId }]
        : []
    );
  }

  /**
   * Stops a single thread by account id and leaves every other thread running.
   * Returns false when that account is not currently running.
   */
  async stopThread(accountId: string): Promise<boolean> {
    const thread = this.activeThreads.get(accountId);
    if (!thread) return false;

    this.activeThreads.delete(accountId);
    const stoppedProfile = await this.shutdownThread(thread, 'Đã dừng riêng luồng này');

    this.publish(this.progress.state, 'Đã dừng luồng ' + thread.email, {
      threadsStopped: this.progress.threadsStopped + (stoppedProfile ? 1 : 0)
    });
    return true;
  }

  private async teardown(): Promise<number> {
    let stopped = 0;

    // Drain the live threads. Anything already stopped one-by-one has left the
    // map, so it is never stopped twice.
    for (const thread of Array.from(this.activeThreads.values())) {
      this.activeThreads.delete(thread.accountId);
      if (await this.shutdownThread(thread, 'Đã dừng sau khi kiểm tra kết nối')) {
        stopped += 1;
      }
    }

    await this.deps.proxies.releaseAll();
    return stopped;
  }

  /**
   * How many threads may hold a browser at the same time. In proxy-key mode the
   * account's key count is the hard ceiling, because two profiles never share an
   * IP; the remaining threads queue and start as keys are released.
   */
  private async resolveConcurrency(
    config: AutomationRunConfigDTO,
    planCount: number
  ): Promise<number> {
    if (config.proxy.mode !== 'proxykey' || !this.deps.proxies.availableSlots) {
      return planCount;
    }

    let slots: number | null;
    try {
      slots = await this.deps.proxies.availableSlots();
    } catch {
      return planCount;
    }

    if (slots === null) return planCount;
    return Math.max(1, Math.min(planCount, slots));
  }

  /** Waits out this thread's connectivity window, cut short by a stop request. */
  private async holdForThread(durationMs: number): Promise<void> {
    if (durationMs <= 0 || this.stopRequested) return;
    await Promise.race([this.sleep(durationMs), this.stopSignal ?? Promise.resolve()]);
  }

  /**
   * Phần việc thật của một luồng.
   *
   * Có engine VÀ có phiên Playwright thì làm nhiệm vụ CapCut; thiếu một trong hai
   * thì giữ browser `testDurationMs` như trước khi gộp — cách đó vẫn chứng minh
   * được browser + proxy + mailbox nối đúng, và giữ nguyên hành vi cho những
   * browser chưa hỗ trợ.
   *
   * Kết luận đủ/thiếu nhiệm vụ KHÔNG do đây quyết: nó đến từ snapshot `task_list`
   * của chính CapCut (xem `docs/AUTOMATION-ENGINE.md` §3).
   */
  /**
   * Nguồn OTP cho đường ĐĂNG KÝ, buộc vào đúng mailbox của luồng này.
   *
   * Mã không tới ngay: engine CLI phải poll. Ở đây poll 5 giây/lần trong 90 giây
   * rồi bỏ cuộc bằng lỗi rõ ràng — thà báo "không lấy được OTP" còn hơn để bước
   * đăng ký treo chờ một mã không bao giờ đến.
   */
  private buildOtpReader(thread: ThreadRuntime): (() => Promise<string>) | undefined {
    const read = this.deps.emails.readOtp;
    const purchasedEmailId = thread.purchasedEmailId;
    if (!read || !purchasedEmailId) return undefined;

    return async () => {
      const deadline = Date.now() + 90_000;
      let lastError = '';
      while (Date.now() < deadline && !this.stopRequested) {
        try {
          const code = await read.call(this.deps.emails, purchasedEmailId);
          if (code) return code;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
        await this.sleep(5_000);
      }
      throw new Error(
        'Không lấy được OTP cho ' + thread.email + ' sau 90 giây' + (lastError ? ': ' + lastError : '')
      );
    };
  }

  /**
   * Lưu tiến độ từng nhiệm vụ của luồng này.
   *
   * Bọc try/catch có chủ ý: đây là GHI CHÚ bên lề một phiên browser đang sống,
   * không phải kết quả của lượt chạy. DB đang khoá (WAL busy), `account_id` vừa
   * bị xoá khỏi `accounts`, hay đĩa đầy — không lý do nào trong số đó được phép
   * làm mất cả phiên đang chạy nhiệm vụ. Nên lỗi ghi chỉ thành một dòng WARNING
   * (AGENTS.md §27: không nuốt lỗi im lặng, nhưng cũng không leo thang quá mức).
   */
  private recordTaskProgress(thread: ThreadRuntime, rows: CapcutAccountResult['tasks']): void {
    const sink = this.deps.taskProgress;
    if (!sink || rows.length === 0) return;

    try {
      sink.record(thread.accountId, rows);
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

  private async runThreadWorkload(thread: ThreadRuntime, config: AutomationRunConfigDTO): Promise<void> {
    /**
     * Chỉ module `credit` có engine thật (đăng ký/đăng nhập + 12 nhiệm vụ free
     * credits). `trial` và `team` chưa implement — KHÔNG được âm thầm chạy luồng
     * credit thay thế, vì như thế người dùng tưởng đã làm đúng việc họ chọn.
     * UI đã khoá hai lựa chọn đó; đây là chốt thứ hai cho cấu hình cũ trong DB
     * hoặc cho ai gọi IPC trực tiếp.
     */
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
      await this.holdForThread(config.testDurationMs);
      return;
    }

    const runner = this.deps.capcut;
    if (!runner || !thread.page || !thread.context) {
      await this.holdForThread(config.testDurationMs);
      return;
    }

    const password = thread.capcutPassword;
    if (!password) {
      this.log('WARNING', thread.email, 'Nhiệm vụ', 'Không đọc được mật khẩu CapCut của account — giữ browser thay vì làm nhiệm vụ.', thread.accountId);
      await this.holdForThread(config.testDurationMs);
      return;
    }

    this.deps.accounts.update(thread.accountId, { automationStep: 'Đang làm nhiệm vụ' });
    try {
      const result = await runner.runAccount({
        page: thread.page,
        context: thread.context,
        email: thread.email,
        password,
        accountId: thread.accountId,
        getOtp: this.buildOtpReader(thread),
        // Dashboard `retryCount` → số LƯỢT quét lại nhiệm vụ còn thiếu. Chặn trên
        // ở 4 để một account hỏng không giữ profile và proxy key cả tiếng.
        maxRounds: Math.max(1, Math.min(1 + config.retryCount, 4)),
        // Hai ô delay của Dashboard. Engine coi đây là mức TỐI THIỂU của người
        // dùng và tự kẹp lên trên khoảng đã đo, nên giá trị nhỏ (kể cả 0) không
        // làm bot gõ nhanh hơn ngưỡng an toàn của Shark Risk Control.
        pace: {
          stepMinMs: config.stepDelayMinMs,
          stepMaxMs: config.stepDelayMaxMs,
          typeMinMs: config.typeDelayMinMs,
          typeMaxMs: config.typeDelayMaxMs
        },
        log: (status, step, message) => this.log(status, thread.email, step, message, thread.accountId)
      });

      // Lưu tiến độ NGAY khi engine trả kết quả, trước mọi nhánh kết luận: kể cả
      // lượt còn thiếu nhiệm vụ thì phần đã xong vẫn phải được ghi, nhờ vậy lượt
      // sau không làm lại nhiệm vụ mà CapCut đã ghi nhận.
      this.recordTaskProgress(thread, result.tasks);

      if (result.skipped) {
        this.deps.accounts.update(thread.accountId, { automationStep: 'Bỏ qua — không đủ điều kiện' });
        return;
      }

      const full = result.missing.length === 0;
      this.deps.accounts.update(thread.accountId, {
        credit: result.credits,
        automationStep: full
          ? 'Đủ ' + result.done + '/' + result.total + ' nhiệm vụ'
          : 'Còn thiếu ' + result.missing.length + ' nhiệm vụ'
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi làm nhiệm vụ.';
      this.log('ERROR', thread.email, 'Nhiệm vụ', message, thread.accountId);
      this.deps.accounts.update(thread.accountId, { status: 'error', automationStep: 'Lỗi khi làm nhiệm vụ' });
    }
  }

  private async runPrepared(
    plans: ThreadPlan[],
    config: AutomationRunConfigDTO,
    runId: string
  ): Promise<AutomationRunSummary> {
    this.publish('running', 'Đang khởi chạy ' + plans.length + ' browser...', {
      runId,
      threadTotal: plans.length,
      threadsStarted: 0,
      threadsStopped: 0,
      threadsFailed: 0
    });

    // Narrow the proxy pool to the keys this run may use before asking how many
    // slots exist, so the ceiling reflects the operator's selection.
    if (config.proxy.mode === 'proxykey' && this.deps.proxies.configure) {
      this.deps.proxies.configure({ keys: config.proxy.keys });
    }

    const concurrency = await this.resolveConcurrency(config, plans.length);
    const queued = plans.length - concurrency;
    if (queued > 0) {
      this.log(
        'INFO',
        'system',
        'Proxy',
        'Chỉ có ' + concurrency + ' proxy key khả dụng nên chạy ' + concurrency +
          ' luồng song song, ' + queued + ' luồng còn lại xếp hàng chờ.'
      );
    }

    const queue = [...plans];
    const firstWaveTarget = Math.max(1, Math.min(concurrency, plans.length));
    let launchedOrFailed = 0;
    let started = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.stopRequested) return;

        const plan = queue.shift();
        if (!plan) return;

        const thread = await this.launchThread(plan, config);
        launchedOrFailed += 1;

        if (!thread) {
          failed += 1;
          this.publish('running', 'Đang chạy ' + started + '/' + plans.length + ' browser', {
            threadsFailed: failed
          });
          if (launchedOrFailed >= firstWaveTarget) this.releaseRunningWaiters();
          continue;
        }

        started += 1;
        this.publish('running', 'Đang chạy ' + started + '/' + plans.length + ' browser', {
          threadsStarted: started
        });
        if (launchedOrFailed >= firstWaveTarget) this.releaseRunningWaiters();

        await this.runThreadWorkload(thread, config);

        // stopThread may have taken this thread already; only the owner shuts it down.
        if (this.activeThreads.delete(thread.accountId)) {
          const didStop = await this.shutdownThread(thread, 'Đã dừng sau khi kiểm tra kết nối');
          this.publish(this.progress.state, 'Đã dừng luồng ' + thread.email, {
            threadsStopped: this.progress.threadsStopped + (didStop ? 1 : 0)
          });
        }
      }
    };

    await Promise.all(Array.from({ length: firstWaveTarget }, () => worker()));
    this.releaseRunningWaiters();

    this.publish('stopping', 'Đang dừng các browser của phiên chạy...');
    const stoppedInTeardown = await this.teardown();
    const totalStopped = this.progress.threadsStopped + stoppedInTeardown;

    this.publish('stopped', 'Đã dừng ' + totalStopped + '/' + started + ' browser.', {
      threadsStopped: totalStopped
    });

    return { ...this.progress, startedProfiles: [...this.startedProfiles] };
  }

  /**
   * Validates the request, prepares mailboxes, then runs the batch in the
   * background. Resolves once the run has been accepted so IPC does not block
   * for the whole hold window; progress arrives through subscribe().
   */
  async start(config: AutomationRunConfigDTO): Promise<{ runId: string }> {
    if (this.activeRun) {
      throw new ProviderError('CONFIG_ERROR', 'Đang có một phiên chạy khác, hãy dừng trước khi bắt đầu.');
    }

    const runId = this.nextId();
    this.stopRequested = false;
    this.startedProfiles = [];
    this.activeThreads.clear();
    this.firstWaveDone = false;
    this.stopSignal = new Promise<void>((resolve) => {
      this.fireStop = resolve;
    });
    this.publish('preparing', 'Đang chuẩn bị dữ liệu cho phiên chạy...', {
      runId,
      threadTotal: config.threadCount,
      threadsStarted: 0,
      threadsStopped: 0,
      threadsFailed: 0
    });

    let plans: ThreadPlan[];
    try {
      plans = await this.buildThreadPlans(config);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Không chuẩn bị được phiên chạy.';
      this.publish('failed', message);
      this.log('ERROR', 'system', 'Run', message);
      throw err;
    }

    this.activeRun = this.runPrepared(plans, config, runId)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Phiên chạy thất bại.';
        this.publish('failed', message);
        this.log('ERROR', 'system', 'Run', message);
        return { ...this.progress, startedProfiles: [...this.startedProfiles] };
      })
      .then((summary) => {
        this.lastSummary = summary;
        this.activeRun = null;
        return summary;
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

  /** Resolves once the first wave of threads of the current run has launched. */
  async waitUntilRunning(): Promise<void> {
    if (this.firstWaveDone || !this.activeRun) return;
    await new Promise<void>((resolve) => {
      this.runningResolvers.push(resolve);
    });
  }

  /** Resolves with the summary of the run that is in flight, or the last one. */
  async waitForCompletion(): Promise<AutomationRunSummary> {
    if (this.activeRun) {
      return this.activeRun;
    }
    return this.lastSummary ?? { ...this.progress, startedProfiles: [...this.startedProfiles] };
  }

  /** Ends the connectivity hold immediately and tears the run down. */
  /** Stops the whole run: no queued thread starts, and every live hold ends now. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.fireStop) {
      this.fireStop();
      this.fireStop = null;
    }
    if (this.activeRun) {
      await this.activeRun;
    }
  }
}
