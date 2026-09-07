import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IProxyLeaseSource,
  type StartedProfile,
  type HttpOnlyAccountRunner,
  type CapcutTaskRunner,
  type BrowserSessionRuntime
} from '../AutomationRunService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
import { createDirectUiInteraction, type RunUiInteractionScheduler } from '../capcut/uiInteractionScheduler';
import { DomReadTimeoutError } from '../capcut/cancellation';
import { runDeterministicSimulation } from './fixtures/deterministicRunHarness';
import { LogBus, type ILogSink } from '../LogBus';
import { ProviderError } from '../../providers/ProviderError';
import { AutomationRunConfigSchema, type AutomationRunConfigDTO, type AutomationRunProgressDTO } from '../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';
import type { PurchasedEmailDTO, EmailSourceProvider } from '../../../shared/schemas/provider.schema';
import { AutomationTerminalError } from '../AutomationTerminalError';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  AutomationWorkSourceFactory,
  SourceReadiness,
  WorkSourceKind
} from '../AutomationWorkSource';
import type { RunningThreadInfo } from '../AutomationRunService';
import { headlessWorkerStaggerMs } from '../AutomationRunService';
import { createAutomationWorkSourceFactory } from '../AutomationWorkSource';

class CollectingSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void { this.rows.push(...logs); }
}

function purchasedRow(index: number, provider: EmailSourceProvider = 'gmail94'): PurchasedEmailDTO {
  return {
    id: 'pe-' + index,
    provider,
    email: provider === 'customdomain'
      ? 'user' + index + '@oldevlk.com'
      : 'mail' + index + '@gmail.com',
    hasPassword: false,
    hasOauth: false,
    orderId: 'order-' + index,
    service: 'facebook',
    purchasedAt: '2026-09-01T10:00:00.000Z',
    consumedAt: null
  };
}

class StubEmailSource {
  public purchaseCalls: Array<{ provider: string; count: number }> = [];
  public consumed: Array<{ id: string; accountId: string | null }> = [];
  public released: string[] = [];
  public available = 0;
  public failures: string[] = [];

  async purchase(provider: string, count: number): Promise<{ purchased: PurchasedEmailDTO[]; failures: string[] }> {
    this.purchaseCalls.push({ provider, count });
    const rows = Array.from({ length: Math.min(this.available, count) }, (_unused, i) =>
      purchasedRow(i + 1, provider === 'customdomain' ? 'customdomain' : 'gmail94')
    );
    return { purchased: rows, failures: this.failures };
  }

  markConsumed(id: string, accountId: string | null): void {
    this.consumed.push({ id, accountId });
  }

  release(id: string): void {
    this.released.push(id);
  }
}

class StubProxySource implements IProxyLeaseSource {
  public acquired: string[] = [];
  public released: string[] = [];
  public releaseAllCalls = 0;
  public failOnAcquire: Error | null = null;
  /** null = unlimited keys, a number = that many proxy keys on the account. */
  public keyCount: number | null = null;
  public peakConcurrent = 0;
  public configuredKeys: string[][] = [];
  /** Vùng KiotProxy của lượt chạy — trước đây không ai chuyển xuống. */
  public configuredRegions: Array<string | undefined> = [];
  private live = 0;
  private counter = 0;

  configure(options: { keys?: string[]; region?: string }): void {
    this.configuredKeys.push(options.keys ?? []);
    this.configuredRegions.push(options.region);
    // An explicit key list is the ceiling for this run.
    if ((options.keys ?? []).length > 0) {
      this.keyCount = (options.keys ?? []).length;
    }
  }

  async availableSlots(): Promise<number | null> {
    return this.keyCount;
  }

  async acquire(): Promise<AcquiredProxyLease> {
    if (this.failOnAcquire) throw this.failOnAcquire;
    if (this.keyCount !== null && this.live >= this.keyCount) {
      throw new Error('stub: xin proxy khi đã hết key — không được phép');
    }
    this.live += 1;
    this.peakConcurrent = Math.max(this.peakConcurrent, this.live);
    this.counter += 1;
    const ip = '10.0.0.' + this.counter;
    this.acquired.push(ip);
    return {
      leaseId: 'lease-' + this.counter,
      keyValue: 'K' + this.counter,
      ip,
      host: ip,
      port: 20000 + this.counter,
      protocol: 'http',
      username: 'u' + this.counter,
      password: 'p' + this.counter,
      nextChangeSeconds: 60
    };
  }

  async release(lease: AcquiredProxyLease): Promise<void> {
    this.live = Math.max(0, this.live - 1);
    this.released.push(lease.ip);
  }

  async releaseAll(): Promise<void> {
    this.releaseAllCalls += 1;
  }
}

class StubBrowserRuntime implements IBrowserRuntimeApi {
  public startCalls: Array<{ headless: boolean; proxyHost?: string }> = [];
  public stopped: string[] = [];
  public peakOpenProfiles = 0;
  public failAtCall = Number.POSITIVE_INFINITY;
  public failStopFor = new Set<string>();
  private openProfiles = 0;
  private counter = 0;

  async startProfile(params: {
    headless: boolean;
    proxy?: { host: string };
  }): Promise<StartedProfile> {
    this.counter += 1;
    if (this.counter === this.failAtCall) throw new Error('launcher refused');
    this.openProfiles += 1;
    this.peakOpenProfiles = Math.max(this.peakOpenProfiles, this.openProfiles);
    this.startCalls.push({
      headless: params.headless,
      proxyHost: params.proxy?.host
    });
    return {
      profileId: 'profile-' + this.counter,
      port: 50_000 + this.counter,
      browserType: 'mimic'
    };
  }

  async stopProfile(profileId: string): Promise<void> {
    this.openProfiles = Math.max(0, this.openProfiles - 1);
    if (this.failStopFor.has(profileId)) throw new Error('stop failed with token=secret');
    this.stopped.push(profileId);
  }
}

class StubAccounts implements IAccountSink {
  public created: Array<Record<string, unknown>> = [];
  public updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  private counter = 0;

  create(input: Record<string, unknown>): { id: string } {
    this.counter += 1;
    this.created.push(input);
    return { id: 'acc-' + this.counter };
  }

  update(id: string, data: Record<string, unknown>): { success: boolean } {
    this.updates.push({ id, data });
    return { success: true };
  }
}

const HOLD_BLOCK_THRESHOLD_MS = 100_000;

let emailSource: StubEmailSource;
let proxySource: StubProxySource;
let browser: StubBrowserRuntime;
let accounts: StubAccounts;
let logBus: LogBus;
let sink: CollectingSink;
let sleepCalls: number[];
let progressEvents: AutomationRunProgressDTO[];
let idCounter: number;
let workSourceCreateCalls: number;
let workSourcePrepareCalls: number;

function baseConfig(overrides: Partial<AutomationRunConfigDTO> = {}): AutomationRunConfigDTO {
  return AutomationRunConfigSchema.parse({
    threadCount: 2,
    browser: 'multilogin',
    headless: false,
    retryCount: 0,
    stepDelayMinMs: 0,
    stepDelayMaxMs: 0,
    typeDelayMinMs: 0,
    typeDelayMaxMs: 0,
    module: 'credit',
    skipWithoutTrial: false,
    emailSource: { mode: 'api', provider: 'gmail94', service: 'facebook' },
    proxy: { mode: 'proxykey' },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    ...overrides
  });
}

function createService(
  launcher?: BrowserLauncher,
  httpOnlyRunner?: HttpOnlyAccountRunner,
  capcut?: CapcutTaskRunner
): AutomationRunService {
  const workSources: AutomationWorkSourceFactory = {
    create: (config) => {
      workSourceCreateCalls += 1;
      if (config.emailSource.mode === 'manual') {
        const items: AutomationWorkItem[] = config.emailSource.entries.flatMap((entry, i) => {
          const trimmed = entry.trim();
          if (!trimmed) return [];
          const [email, password] = trimmed.split('|');
          return [{
            kind: 'new',
            sourceId: 'man-' + (i + 1),
            email: email.trim(),
            emailPassword: password?.trim(),
            emailProvider: 'manual'
          }];
        });
        return {
          kind: 'finite',
          prepare: async (c) => {
            workSourcePrepareCalls += 1;
            if (items.length === 0) {
              throw new ProviderError('CONFIG_ERROR', 'Danh sách email thủ công đang trống.');
            }
            return { workerTarget: Math.min(c, items.length) };
          },
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }

      const count = emailSource.available;
      const items: AutomationWorkItem[] = Array.from({ length: count }, (_, i) => {
        const provider = config.emailSource.mode === 'custom'
          ? 'customdomain'
          : config.emailSource.mode === 'api'
            ? config.emailSource.provider
            : 'gmail94';
        const row = purchasedRow(i + 1, provider);
        return {
          kind: 'new',
          sourceId: row.id,
          email: row.email,
          emailProvider: row.provider,
          purchasedEmailId: row.id
        };
      });

      return {
        kind: 'finite',
        prepare: async (c) => {
          workSourcePrepareCalls += 1;
          if (emailSource.available === 0 && emailSource.failures.length > 0) {
            throw new ProviderError('CONFIG_ERROR', emailSource.failures[0]);
          }
          if (config.emailSource.mode === 'custom') {
            emailSource.purchaseCalls.push({ provider: 'customdomain', count: c });
          } else if (config.emailSource.mode === 'api') {
            emailSource.purchaseCalls.push({ provider: config.emailSource.provider, count: c });
          }
          return { workerTarget: Math.min(c, count) };
        },
        next: async () => items.shift() ?? null,
        commit: (item, accountId) => {
          const id = item.kind === 'new' && item.purchasedEmailId ? item.purchasedEmailId : item.sourceId;
          emailSource.markConsumed(id, accountId);
        },
        release: (item) => {
          if (item.kind === 'new' && item.purchasedEmailId) {
            emailSource.release(item.purchasedEmailId);
          }
        }
      };
    }
  };

  const service = new AutomationRunService(
    {
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies: proxySource,
      browser,
      accounts,
      logBus,
      ...(launcher ? { launcher: () => launcher } : {}),
      ...(httpOnlyRunner ? { httpOnlyRunner } : {}),
      ...(capcut ? { capcut } : {})
    },
    {
      // A long hold blocks until the test asks the run to stop, so tests can
      // observe threads while they are still running. Short waits resolve at
      // once to keep the suite fast.
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
        if (ms >= HOLD_BLOCK_THRESHOLD_MS) {
          await new Promise<void>(() => {});
        }
      },
      nextId: () => 'id-' + ++idCounter
    }
  );
  service.subscribe((progress) => progressEvents.push(progress));
  return service;
}

beforeEach(() => {
  emailSource = new StubEmailSource();
  proxySource = new StubProxySource();
  browser = new StubBrowserRuntime();
  accounts = new StubAccounts();
  sink = new CollectingSink();
  logBus = new LogBus(sink, { maxBatchSize: 1000 });
  sleepCalls = [];
  progressEvents = [];
  idCounter = 0;
  workSourceCreateCalls = 0;
  workSourcePrepareCalls = 0;
});

describe('headless worker startup scheduling', () => {
  afterEach(() => vi.useRealTimers());
  it('stagger runs only once per worker, including refills', async () => {
    vi.useFakeTimers();
    emailSource.available = 8;
    const launch = browser.startProfile.bind(browser);
    vi.spyOn(browser, 'startProfile').mockImplementation(async params => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return launch(params);
    });
    const logs: string[] = [];
    const unsubscribe = logBus.subscribe(entry => logs.push(entry.message));
    const service = createService();
    await service.start(baseConfig({ threadCount: 3, headless: true }));
    await vi.runAllTimersAsync();
    const result = await service.waitForCompletion();
    unsubscribe();
    expect(result.accountsAccepted).toBe(8);
    expect(logs.filter(m => m.includes('Headless stagger:'))).toHaveLength(2);
    expect(browser.stopped).toHaveLength(8);
  });

  it('Stop cancels delayed workers before they acquire a proxy', async () => {
    vi.useFakeTimers();
    emailSource.available = 3;
    const service = createService();
    await service.start(baseConfig({ threadCount: 3, headless: true }));
    await vi.advanceTimersByTimeAsync(0);
    await service.stop();
    await vi.runAllTimersAsync();
    expect(proxySource.acquired).toHaveLength(1);
    expect(browser.startCalls).toHaveLength(1);
    expect((await service.waitForCompletion()).state).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('staggers headless profiles while headed startup stays immediate', () => {
    expect(headlessWorkerStaggerMs(false, 'worker-1')).toBe(0);
    expect(headlessWorkerStaggerMs(true, 'worker-1')).toBe(0);
    expect(headlessWorkerStaggerMs(true, 'worker-2')).toBe(4_000);
    expect(headlessWorkerStaggerMs(true, 'worker-3')).toBe(8_000);
  });
});

describe('mail-limited runs with the real source factory', () => {
  it.each([3, 2])('drains %i accounts, closes every profile, and never refills past the limit', async (limit) => {
    let orders = 0;
    const factory = createAutomationWorkSourceFactory({
      openAcquisitionSession: async () => ({
        acquireOne: async () => ({ purchasedEmail: purchasedRow(++orders), reservationId: 'r-' + orders }),
        commit: () => {}, release: () => {}
      })
    });
    proxySource.keyCount = limit;
    const service = new AutomationRunService({
      workSources: factory, emailOtp: { readOtp: async () => null },
      proxies: proxySource, browser, accounts, logBus
    }, { sleep: async () => {}, nextId: () => 'limited-run' });
    await service.start(baseConfig({ threadCount: 3, mailLimit: limit }));
    const summary = await service.waitForCompletion();
    expect(summary).toMatchObject({
      state: 'completed', workerTarget: limit, workersActive: 0, accountsAccepted: limit,
      terminalReason: { code: 'MAIL_LIMIT_REACHED' }
    });
    expect(orders).toBe(limit);
    expect(browser.stopped).toHaveLength(limit);
    expect(proxySource.acquired).toHaveLength(limit);
    expect(proxySource.released).toHaveLength(limit);
  });
});

describe('AutomationRunService.start with an API email source', () => {
  it('buys one mailbox per configured thread', async () => {
    emailSource.available = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 2 }));
    await service.waitForCompletion();

    expect(emailSource.purchaseCalls).toEqual([{ provider: 'gmail94', count: 2 }]);
  });

  it('launches exactly one browser per thread with the configured headless flag', async () => {
    vi.useFakeTimers();
    emailSource.available = 3;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3, headless: true }));
    await vi.runAllTimersAsync();
    await service.waitForCompletion();

    expect(browser.startCalls).toHaveLength(3);
    expect(browser.startCalls.every((call) => call.headless)).toBe(true);
    vi.useRealTimers();
  });

  it('gives every thread its own proxy endpoint', async () => {
    emailSource.available = 3;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3 }));
    await service.waitForCompletion();

    const hosts = browser.startCalls.map((call) => call.proxyHost);
    expect(new Set(hosts).size).toBe(3);
    expect(proxySource.acquired).toHaveLength(3);
  });

  it('creates one account row per thread and links the purchased mailbox', async () => {
    emailSource.available = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 2 }));
    await service.waitForCompletion();

    expect(accounts.created).toHaveLength(2);
    expect(accounts.created[0]).toMatchObject({ email: 'mail1@gmail.com', emailProvider: 'gmail94' });
    expect(emailSource.consumed).toEqual([
      { id: 'pe-1', accountId: 'acc-1' },
      { id: 'pe-2', accountId: 'acc-2' }
    ]);
  });

  it('holds the browsers for the configured test duration and then stops them', async () => {
    emailSource.available = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 2, testDurationMs: 10_000 }));
    await service.waitForCompletion();

    expect(sleepCalls).toContain(10_000);
    expect(browser.stopped.sort()).toEqual(['profile-1', 'profile-2']);
  });

  it('stops only the profiles it started, exactly once each', async () => {
    emailSource.available = 3;
    browser.failAtCall = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3 }));
    await service.waitForCompletion();

    // Thread 2 never got a profile, so only the two that launched are stopped —
    // a run must never reach for a profile it did not start.
    expect(browser.stopped.sort()).toEqual(['profile-1', 'profile-3']);
    expect(new Set(browser.stopped).size).toBe(browser.stopped.length);
  });

  it('releases every proxy lease once the run finishes', async () => {
    emailSource.available = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 2 }));
    await service.waitForCompletion();

    expect(proxySource.released.sort()).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(proxySource.releaseAllCalls).toBe(1);
  });

  it('marks the accounts stopped after the connectivity check', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();

    const lastUpdate = accounts.updates[accounts.updates.length - 1];
    expect(lastUpdate.data).toMatchObject({ status: 'done' });
  });
});

describe('AutomationRunService failure handling', () => {
  it('keeps the other threads running when one browser fails to launch', async () => {
    emailSource.available = 3;
    browser.failAtCall = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3 }));
    const summary = await service.waitForCompletion();

    expect(summary.accountsCompleted).toBe(2);
    expect(summary.accountsFailed).toBe(1);
    expect(summary.startedProfiles).toHaveLength(2);
  });

  it('records an error status on the account whose browser failed', async () => {
    emailSource.available = 1;
    browser.failAtCall = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();

    expect(accounts.updates.some((entry) => entry.data.status === 'error')).toBe(true);
  });

  it('releases the proxy of a thread that failed to launch', async () => {
    emailSource.available = 1;
    browser.failAtCall = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();

    expect(proxySource.released).toEqual(['10.0.0.1']);
  });

  /**
   * Hộp thư đã thuê là tiền đã trả. Lượt 04/09/2026: `xcli profile-quick` lỗi vì
   * launcher Multilogin đã tắt, mà `markConsumed` đã chạy từ lúc tạo account —
   * hộp thư bị đánh dấu đã tiêu trong khi chưa dùng gì, nên lượt sau lại đi thuê
   * hộp mới. `order_id` vẫn còn nên hộp cũ hoàn toàn dùng lại được.
   */
  it('nhả lại hộp thư đã thuê khi browser không mở được', async () => {
    emailSource.available = 1;
    browser.failAtCall = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();

    expect(emailSource.released).toEqual(['pe-1']);
  });

  it('refuses to start when no mailbox could be obtained', async () => {
    emailSource.available = 0;
    emailSource.failures = ['hết hàng'];
    const service = createService();

    await expect(service.start(baseConfig())).rejects.toBeInstanceOf(ProviderError);
    expect(browser.startCalls).toHaveLength(0);
  });


  it('reports a proxy shortage as a failed thread rather than a crashed run', async () => {
    emailSource.available = 1;
    proxySource.failOnAcquire = new ProviderError('CONFIG_ERROR', 'không có key rảnh', 'kiotproxy');
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    const summary = await service.waitForCompletion();

    expect(browser.startCalls).toHaveLength(0);
    expect(summary.state).toBe('blocked');
    expect(summary.terminalReason?.code).toBe('PROVIDER_CONFIG_ERROR');
  });

  it('rejects a second start while a run is still active', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig());

    await expect(service.start(baseConfig())).rejects.toBeInstanceOf(ProviderError);
    await service.waitForCompletion();
  });
});

describe('AutomationRunService manual email source', () => {
  it('uses the pasted entries without contacting an email vendor', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      emailSource: { mode: 'manual', entries: ['a@x.com|pass-a', 'b@x.com|pass-b', 'c@x.com|pass-c'] }
    }));
    await service.waitForCompletion();

    expect(emailSource.purchaseCalls).toHaveLength(0);
    expect(accounts.created.map((row) => row.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('fails when the manual list is empty', async () => {
    const service = createService();

    await expect(
      service.start(baseConfig({ emailSource: { mode: 'manual', entries: [] } }))
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('AutomationRunService chặn cấu hình chắc chắn hỏng TRƯỚC khi tiêu tiền', () => {
  /**
   * Audit 04/09/2026: GoLogin/GPM/Camoufox/Patchright không có một file
   * implementation nào (`providerStack.ts:140-143` trả `UnsupportedBrowserRuntime`),
   * nhưng dropdown Dashboard không khoá gì. Tệ hơn là THỨ TỰ: `start()` mua email
   * TRƯỚC rồi `launchThread` mới fail — chọn GoLogin + nguồn API là gọi API mua N
   * hộp thư rồi mới báo lỗi browser.
   */
  it('browser chưa hỗ trợ thì từ chối ngay, KHÔNG mua email', async () => {
    emailSource.available = 3;
    const service = createService();

    await expect(service.start(baseConfig({
      threadCount: 3,
      browser: 'gologin',
      emailSource: { mode: 'api', provider: 'gmail94' }
    }))).rejects.toMatchObject({ reason: { code: 'PROVIDER_CONFIG_ERROR' } });

    expect(emailSource.purchaseCalls).toHaveLength(0);
    expect(browser.startCalls).toHaveLength(0);
  });

  it('nêu đúng tên browser và tên browser đang dùng được', async () => {
    const service = createService();

    await expect(service.start(baseConfig({ browser: 'camoufox' })))
      .rejects.toThrow(/camoufox[\s\S]*multilogin/i);
  });

  it('multilogin vẫn chạy bình thường', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin' }));
    await service.waitForCompletion();

    expect(emailSource.purchaseCalls).toHaveLength(1);
  });
});

describe('AutomationRunService HTTP-only mission transport', () => {
  it('fails closed before source preparation, mailbox purchase, proxy lease, or browser launch when the runner is missing', async () => {
    emailSource.available = 1;
    const service = createService();

    await expect(service.start(baseConfig({
      missionTransport: 'http-only',
      browser: 'gologin',
      emailSource: { mode: 'api', provider: 'gmail94' }
    }))).rejects.toMatchObject({ reason: { code: 'PROVIDER_CONFIG_ERROR' } });

    expect(emailSource.purchaseCalls).toHaveLength(0);
    expect(workSourceCreateCalls).toBe(0);
    expect(workSourcePrepareCalls).toBe(0);
    expect(proxySource.acquired).toHaveLength(0);
    expect(browser.startCalls).toHaveLength(0);
  });

  it('fails closed when HTTP preflight rejects, before source preparation', async () => {
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => { throw new Error('contracts unavailable token=secret-session'); },
      runAccount: async () => { throw new Error('must not run'); }
    };
    const service = createService(undefined, runner);

    const error = await service.start(baseConfig({ missionTransport: 'http-only' }))
      .then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ reason: { code: 'PROVIDER_CONFIG_ERROR' } });
    expect((error as Error).message).not.toContain('secret-session');

    expect(workSourceCreateCalls).toBe(0);
    expect(workSourcePrepareCalls).toBe(0);
    expect(emailSource.purchaseCalls).toHaveLength(0);
    expect(proxySource.acquired).toHaveLength(0);
    expect(browser.startCalls).toHaveLength(0);
  });

  it('rejects HTTP-only direct proxy mode without a route before mailbox purchase', async () => {
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async () => { throw new Error('must not run'); }
    };
    const service = createService(undefined, runner);

    await expect(service.start(baseConfig({
      missionTransport: 'http-only',
      proxy: { mode: 'direct', entries: [] }
    }))).rejects.toMatchObject({ reason: { code: 'PROVIDER_CONFIG_ERROR' } });

    expect(workSourceCreateCalls).toBe(0);
    expect(emailSource.purchaseCalls).toHaveLength(0);
    expect(browser.startCalls).toHaveLength(0);
  });

  it('keeps source, mailbox, proxy, account persistence, and counters owned by the service', async () => {
    emailSource.available = 1;
    const preflight = vi.fn(async () => {});
    const runAccount = vi.fn(async () => ({
      done: 1,
      total: 1,
      credits: 10,
      creditsTotal: 10,
      missing: [],
      tasks: [{ key: 'http-task', title: 'HTTP task', reward: 10, status: 4 }]
    }));
    const runner: HttpOnlyAccountRunner = { preflight, runAccount };
    const launch = vi.fn(async () => { throw new Error('HTTP-only must not launch'); });
    const launcher = {
      name: 'api-v3' as const,
      launch,
      stop: async () => {}
    } as BrowserLauncher;
    const legacyRunAccount = vi.fn();
    const legacyRunner = { runAccount: legacyRunAccount } as unknown as CapcutTaskRunner;
    const service = createService(launcher, runner, legacyRunner);

    await service.start(baseConfig({
      missionTransport: 'http-only',
      browser: 'gologin',
      threadCount: 1,
      emailSource: { mode: 'api', provider: 'gmail94' }
    }));
    const summary = await service.waitForCompletion();

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(runAccount).toHaveBeenCalledTimes(1);
    expect(runAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: 'mail1@gmail.com',
      accountId: 'acc-1',
      isNewAccount: true,
      proxy: expect.objectContaining({ server: 'http://10.0.0.1:20001' })
    }));
    expect(summary).toMatchObject({
      runId: 'id-1',
      accountsAccepted: 1,
      accountsCompleted: 1,
      accountsFailed: 0,
      startedProfiles: []
    });
    expect(emailSource.purchaseCalls).toHaveLength(1);
    expect(emailSource.consumed).toEqual([{ id: 'pe-1', accountId: 'acc-1' }]);
    expect(workSourceCreateCalls).toBe(1);
    expect(workSourcePrepareCalls).toBe(1);
    expect(proxySource.acquired).toEqual(['10.0.0.1']);
    expect(proxySource.released).toEqual(['10.0.0.1']);
    expect(accounts.updates).toContainEqual(expect.objectContaining({
      id: 'acc-1',
      data: expect.objectContaining({ credit: 10 })
    }));
    expect(launch).not.toHaveBeenCalled();
    expect(browser.startCalls).toHaveLength(0);
    expect(legacyRunAccount).not.toHaveBeenCalled();
  });

  it('global Stop aborts in-flight HTTP account work without touching a browser', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async ({ signal }) => {
        entered();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      }
    };
    const service = createService(undefined, runner);

    await service.start(baseConfig({
      missionTransport: 'http-only',
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['existing@x.com|mail-pass'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    await started;
    await service.stop();

    expect((await service.waitForCompletion()).state).toBe('stopped');
    expect(browser.startCalls).toHaveLength(0);
  });

  it('treats an empty HTTP task snapshot as unavailable instead of complete', async () => {
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async () => ({
        done: 0,
        total: 0,
        credits: 0,
        creditsTotal: 0,
        missing: [],
        tasks: []
      })
    };
    const service = createService(undefined, runner);

    await service.start(baseConfig({
      missionTransport: 'http-only',
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['existing@x.com|mail-pass'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    const summary = await service.waitForCompletion();

    expect(summary.accountsCompleted).toBe(0);
    expect(summary.accountsFailed).toBe(1);
    expect(accounts.updates).toContainEqual(expect.objectContaining({
      id: 'acc-1',
      data: expect.objectContaining({ status: 'error' })
    }));
  });

  it('stopThread aborts one in-flight HTTP account without a browser profile', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async ({ signal }) => {
        entered();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      }
    };
    const service = createService(undefined, runner);

    await service.start(baseConfig({
      missionTransport: 'http-only',
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['existing@x.com|mail-pass'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    await started;

    expect(service.getRunningThreads()).toEqual([{
      accountId: 'acc-1',
      email: 'existing@x.com',
      transport: 'http-only'
    }]);
    expect(await service.stopThread('acc-1')).toBe(true);
    const summary = await service.waitForCompletion();
    expect(summary.accountsStopped).toBe(1);
    expect(browser.startCalls).toHaveLength(0);
  });

  it('persists bound partial HTTP evidence before a later fatal result', async () => {
    const recorded: Array<{ accountId: string; rows: unknown[] }> = [];
    let available = true;
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async ({ onTaskProgress }) => {
        onTaskProgress([{ key: 'partial', title: 'Partial', reward: 5, status: 4 }]);
        throw new Error('fatal after checkpoint');
      }
    };
    const service = new AutomationRunService({
      workSources: {
        create: () => ({
          kind: 'finite',
          prepare: async () => ({ workerTarget: 1 }),
          next: async () => {
            if (!available) return null;
            available = false;
            return { kind: 'new' as const, sourceId: 'm-1', email: 'bound@x.com', emailProvider: 'manual' };
          },
          commit: () => {},
          release: () => {}
        })
      },
      emailOtp: { readOtp: async () => null }, proxies: proxySource, browser, accounts, logBus,
      httpOnlyRunner: runner,
      taskProgress: {
        record: async () => {},
        recordLegacy: (accountId, rows) => { recorded.push({ accountId, rows }); }
      }
    }, { sleep: async () => {}, nextId: () => 'checkpoint-run' });

    await service.start(baseConfig({
      missionTransport: 'http-only', threadCount: 1,
      emailSource: { mode: 'manual', entries: ['bound@x.com'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    const summary = await service.waitForCompletion();

    expect(summary.accountsFailed).toBe(1);
    expect(recorded).toEqual([{
      accountId: 'acc-1',
      rows: [{ key: 'partial', title: 'Partial', reward: 5, status: 4 }]
    }]);
  });

  it('retains partial HTTP evidence emitted before global Stop', async () => {
    const recorded: Array<{ accountId: string; rows: unknown[] }> = [];
    let checkpointed!: () => void;
    const checkpoint = new Promise<void>((resolve) => { checkpointed = resolve; });
    let available = true;
    const runner: HttpOnlyAccountRunner = {
      preflight: async () => {},
      runAccount: async ({ signal, onTaskProgress }) => {
        onTaskProgress([{ key: 'partial-stop', title: 'Before stop', reward: 3, status: 2 }]);
        checkpointed();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      }
    };
    const service = new AutomationRunService({
      workSources: {
        create: () => ({
          kind: 'finite', prepare: async () => ({ workerTarget: 1 }),
          next: async () => {
            if (!available) return null;
            available = false;
            return { kind: 'new' as const, sourceId: 'm-1', email: 'stop@x.com', emailProvider: 'manual' };
          },
          commit: () => {}, release: () => {}
        })
      },
      emailOtp: { readOtp: async () => null }, proxies: proxySource, browser, accounts, logBus,
      httpOnlyRunner: runner,
      taskProgress: {
        record: async () => {},
        recordLegacy: (accountId, rows) => { recorded.push({ accountId, rows }); }
      }
    }, { sleep: async () => {}, nextId: () => 'stop-checkpoint-run' });

    await service.start(baseConfig({
      missionTransport: 'http-only', threadCount: 1,
      emailSource: { mode: 'manual', entries: ['stop@x.com'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    await checkpoint;
    await service.stop();

    expect(recorded).toEqual([{
      accountId: 'acc-1',
      rows: [{ key: 'partial-stop', title: 'Before stop', reward: 3, status: 2 }]
    }]);
    expect((await service.waitForCompletion()).accountsStopped).toBe(1);
  });
});

/**
 * `xcli` là launcher MẶC ĐỊNH và nó từ chối proxy có user/pass
 * (`XcliLauncher.ts:139`), trong khi placeholder trên Dashboard lại mời dán đúng
 * `IP:PORT:USER:PASS`. Cấu hình mặc định + gợi ý của UI = 100% chết ở bước mở
 * browser — mà lúc đó email đã mua xong. Phải chặn trước khi tiêu tiền.
 */
describe('AutomationRunService chặn tổ hợp xcli + proxy user/pass', () => {
  function serviceWithLauncher(name: 'xcli' | 'api-v3'): AutomationRunService {
    const launcher = { name, launch: async () => { throw new Error('không dùng'); }, stop: async () => {} };
    const workSources: AutomationWorkSourceFactory = {
      create: (config) => {
        if (config.emailSource.mode === 'manual') {
          const items: AutomationWorkItem[] = config.emailSource.entries.map((entry, i) => {
            const [email, password] = entry.split('|');
            return {
              kind: 'new',
              sourceId: 'man-' + (i + 1),
              email,
              emailPassword: password,
              emailProvider: 'manual'
            };
          });
          return {
            kind: 'finite',
            prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
            next: async () => items.shift() ?? null,
            commit: () => {},
            release: () => {}
          };
        }
        return {
          kind: 'continuous',
          prepare: async (c) => ({ workerTarget: c }),
          next: async () => ({ kind: 'new' as const, sourceId: 's-1', email: 'a@x.com', emailProvider: 'gmail94' }),
          commit: () => {},
          release: () => {}
        };
      }
    };
    return new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => null },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => launcher as never
      },
      { sleep: async () => {}, nextId: () => 'run-1' }
    );
  }

  it('xcli + proxy có user/pass ⇒ từ chối, KHÔNG mua email', async () => {
    emailSource.available = 1;
    const service = serviceWithLauncher('xcli');

    await expect(service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'api', provider: 'gmail94' },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080:bob:secret'] }
    }))).rejects.toMatchObject({ code: 'CONFIG_ERROR' });

    expect(emailSource.purchaseCalls).toHaveLength(0);
  });

  it('lỗi chỉ đúng cách sửa: đổi sang api-v3', async () => {
    const service = serviceWithLauncher('xcli');

    await expect(service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080:bob:secret'] }
    }))).rejects.toThrow(/api-v3/);
  });

  it('xcli + proxy KHÔNG có user/pass thì cho qua', async () => {
    const service = serviceWithLauncher('xcli');

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }));
    await service.waitForCompletion();
  });

  it('xcli + headless bị chặn trước khi bắt đầu work source', async () => {
    const service = serviceWithLauncher('xcli');
    await expect(service.start(baseConfig({
      threadCount: 1,
      headless: true,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080'] }
    }))).rejects.toThrow(/api-v3|headless/i);
    expect(emailSource.purchaseCalls).toHaveLength(0);
  });

  it('api-v3 thì proxy có user/pass là hợp lệ', async () => {
    const service = serviceWithLauncher('api-v3');

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080:bob:secret'] }
    }));
    await service.waitForCompletion();
  });
});

describe('AutomationRunService direct proxy mode', () => {
  /**
   * Hậu quả nặng nhất của bản audit 04/09/2026: dòng proxy không đọc được bị
   * `flatMap` loại KHÔNG LOG GÌ, rồi proxy gán theo index ⇒ luồng thiếu proxy
   * chạy bằng IP THẬT của máy, im lặng. Với công việc này, lộ IP còn tệ hơn là
   * không chạy — nên phải TỪ CHỐI cả lượt, không chạy tiếp với ít proxy hơn.
   */
  it('từ chối cả lượt khi có dòng proxy không đọc được, nêu đúng số dòng', async () => {
    const service = createService();

    await expect(service.start(baseConfig({
      threadCount: 3,
      emailSource: { mode: 'manual', entries: ['a@x.com|p', 'b@x.com|p', 'c@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080', 'ftp://2.2.2.2:21', '3.3.3.3:abc'] }
    }))).rejects.toMatchObject({ code: 'CONFIG_ERROR' });

    expect(browser.startCalls).toHaveLength(0);
  });

  it('từ chối khi số proxy ít hơn số luồng — phần thiếu sẽ chạy bằng IP thật', async () => {
    const service = createService();

    await expect(service.start(baseConfig({
      threadCount: 3,
      emailSource: { mode: 'manual', entries: ['a@x.com|p', 'b@x.com|p', 'c@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080', '2.2.2.2:8081'] }
    }))).rejects.toMatchObject({ code: 'CONFIG_ERROR' });

    expect(browser.startCalls).toHaveLength(0);
  });

  it('nhận proxy có scheme socks5 và chuyển đúng type xuống launcher', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: ['socks5://9.9.9.9:1080:u:p'] }
    }));
    await service.waitForCompletion();

    expect(browser.startCalls[0].proxyHost).toBe('9.9.9.9');
  });

  it('assigns the pasted proxies without touching the proxy key pool', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      emailSource: { mode: 'manual', entries: ['a@x.com|p', 'b@x.com|p'] },
      proxy: { mode: 'direct', entries: ['1.1.1.1:8080:u:p', '2.2.2.2:8081'] }
    }));
    await service.waitForCompletion();

    expect(proxySource.acquired).toHaveLength(0);
    expect(browser.startCalls.map((call) => call.proxyHost)).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('runs without a proxy when direct mode has no entries', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: [] }
    }));
    await service.waitForCompletion();

    expect(browser.startCalls[0].proxyHost).toBeUndefined();
  });
});

describe('AutomationRunService progress and stop', () => {
  it('does not change idle into a permanently stopping run', async () => {
    const service = createService();
    await service.stop();
    expect(service.getProgress().state).toBe('idle');
  });

  it('rejects a second Start while the first is preparing proxy capacity', async () => {
    let release: () => void = () => {};
    proxySource.availableSlots = () => new Promise((resolve) => { release = () => resolve(1); });
    const service = createService();
    const config = baseConfig({ threadCount: 1 });
    const starting = service.start(config);
    const second = service.start(config).then(() => 'accepted', () => 'rejected');
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    expect(await second).toBe('rejected');
    await starting;
    await service.stop();
  });

  it('Stop during capacity preparation prevents a late Start from launching work', async () => {
    emailSource.available = 1;
    let release: () => void = () => {};
    proxySource.availableSlots = () => new Promise((resolve) => { release = () => resolve(1); });
    const service = createService();
    const starting = service.start(baseConfig({ threadCount: 1 }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const stopping = service.stop();
    release();
    await Promise.allSettled([starting, stopping]);
    await service.waitForCompletion();
    expect(browser.startCalls).toHaveLength(0);
    expect(service.getProgress()).toMatchObject({ state: 'stopped', terminalReason: { code: 'USER_STOP' } });
  });

  it('allows retrying a failed profile teardown without forgetting its owner', async () => {
    emailSource.available = 1;
    const service = createService();
    browser.failStopFor.add('profile-1');
    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();
    expect(service.getRunningThreads()).toHaveLength(1);
    browser.failStopFor.clear();
    await service.stop();
    expect(service.getRunningThreads()).toEqual([]);
    expect(browser.stopped).toEqual(['profile-1']);
  });

  it('publishes the full state sequence for a completed run', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['user@example.com|pass'] }
    }));
    await service.waitForCompletion();

    const transitions = progressEvents
      .map((event) => event.state)
      .filter((state, index, all) => state !== all[index - 1]);
    expect(transitions).toEqual(['preparing', 'running', 'completed']);
  });

  it('ends the hold early when stop is requested', async () => {
    emailSource.available = 1;
    const service = createService();
    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stop();
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('stopped');
    expect(browser.stopped).toEqual(['profile-1']);
  });

  it('reports an idle state before any run', () => {
    const service = createService();
    expect(service.getProgress().state).toBe('idle');
  });

  it('writes runtime logs for the launch and the shutdown', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();
    logBus.flush();

    const messages = sink.rows.map((row) => (row as { message: string }).message);
    expect(messages.some((message) => message.includes('profile-1'))).toBe(true);
  });

  it('stops a profile whose id was published while CDP attach is pending', async () => {
    emailSource.available = 1;
    let releaseLaunch: (() => void) | undefined;
    const stopCalls: string[] = [];
    const launcher: BrowserLauncher = {
      name: 'xcli',
      launch: async (options) => {
        const early = options as typeof options & { onProfileStarted?: (profileId: string) => void };
        early.onProfileStarted?.('profile-pending');
        return new Promise<LaunchedProfile>((resolve) => {
          releaseLaunch = () => resolve({
            profileId: 'profile-pending',
            port: 50001,
            page: {} as never,
            context: {} as never
          });
        });
      },
      stop: async (profileId) => {
        stopCalls.push(profileId);
        releaseLaunch?.();
      }
    };

    const service = createService(launcher);
    let earlyThreadPublished = false;
    service.subscribe(() => {
      if (service.getRunningThreads().some((t) => t.profileId === 'profile-pending')) earlyThreadPublished = true;
    });
    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    for (let attempt = 0; attempt < 20 && accounts.created.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const stopping = service.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    let assertionError: unknown;
    try {
      expect(stopCalls).toEqual(['profile-pending']);
    } catch (error: unknown) {
      assertionError = error;
    }
    releaseLaunch?.();
    await stopping;
    await expect(service.waitForCompletion()).resolves.toMatchObject({ state: 'stopped' });
    expect(service.getRunningThreads()).toEqual([]);
    expect(stopCalls).toEqual(['profile-pending']);
    expect(browser.stopped).toEqual([]);
    expect(earlyThreadPublished).toBe(true);
    if (assertionError) throw assertionError;
  });
});

describe('AutomationRunService.stopThread', () => {
  it('reports failed per-row Stop and allows retry for a retained profile', async () => {
    emailSource.available = 1;
    const service = createService();
    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();
    browser.failStopFor.add('profile-1');
    const first = await service.stopThread('acc-1');
    browser.failStopFor.clear();
    const second = await service.stopThread('acc-1');
    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(service.getRunningThreads()).toEqual([]);
  });

  it('keeps proxy cleanup failure details in the final Stop summary', async () => {
    emailSource.available = 1;
    const service = createService();
    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();
    proxySource.release = async () => { throw new Error('proxy release failed'); };
    proxySource.releaseAll = async () => { throw new Error('release all failed'); };
    await service.stop();
    expect(service.getProgress().terminalReason).toMatchObject({ code: 'USER_STOP', details: { cleanupFailures: 2 } });
  });
  it('stops one thread browser and leaves the other threads running', async () => {
    emailSource.available = 3;
    const service = createService();
    await service.start(baseConfig({ threadCount: 3, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const target = accounts.created.length > 0 ? 'acc-2' : 'acc-1';
    const stopped = await service.stopThread(target);

    expect(stopped).toBe(true);
    expect(browser.stopped).toEqual(['profile-2']);

    await service.stop();
    await service.waitForCompletion();
  });

  it('releases only that thread proxy lease', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stopThread('acc-1');

    expect(proxySource.released).toEqual(['10.0.0.1']);

    await service.stop();
    await service.waitForCompletion();
  });

  it('marks only that account as stopped', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stopThread('acc-1');

    const doneUpdates = accounts.updates.filter((entry) => entry.data.status === 'stopped');
    expect(doneUpdates.map((entry) => entry.id)).toEqual(['acc-1']);

    await service.stop();
    await service.waitForCompletion();
  });

  it('does not stop the same profile twice when the run later tears down', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stopThread('acc-1');
    await service.stop();
    await service.waitForCompletion();

    expect(browser.stopped).toEqual(['profile-1', 'profile-2']);
    expect(new Set(browser.stopped).size).toBe(2);
  });

  it('reports the per-thread stop in the progress counters', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stopThread('acc-1');

    expect(service.getProgress().accountsStopped).toBe(1);
    expect(service.getProgress().state).toBe('running');

    await service.stop();
    await service.waitForCompletion();
  });

  it('returns false for an account that is not running', async () => {
    emailSource.available = 1;
    const service = createService();
    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await expect(service.stopThread('acc-999')).resolves.toBe(false);
    expect(browser.stopped).toEqual([]);

    await service.stop();
    await service.waitForCompletion();
  });

  it('lists the running threads so the UI can offer a per-row stop', async () => {
    emailSource.available = 2;
    const service = createService();
    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    expect(service.getRunningThreads()).toEqual([
      { accountId: 'acc-1', email: 'mail1@gmail.com', profileId: 'profile-1' },
      { accountId: 'acc-2', email: 'mail2@gmail.com', profileId: 'profile-2' }
    ]);

    await service.stop();
    await service.waitForCompletion();
  });
});

describe('AutomationRunService queueing when threads outnumber proxy keys', () => {
  it('never holds more proxies than the account has keys', async () => {
    proxySource.keyCount = 2;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      emailSource: {
        mode: 'manual',
        entries: ['1@x.com|p', '2@x.com|p', '3@x.com|p', '4@x.com|p', '5@x.com|p']
      }
    }));
    const summary = await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBeLessThanOrEqual(2);
    expect(summary.accountsFailed).toBe(0);
  });

  it('queues the extra threads and eventually runs every one of them', async () => {
    proxySource.keyCount = 2;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      emailSource: {
        mode: 'manual',
        entries: ['1@x.com|p', '2@x.com|p', '3@x.com|p', '4@x.com|p', '5@x.com|p']
      }
    }));
    const summary = await service.waitForCompletion();

    // Queued threads must actually run, not time out waiting for a key.
    expect(browser.startCalls).toHaveLength(5);
    expect(summary.accountsCompleted).toBe(5);
    expect(summary.state).toBe('completed');
  });

  it('releases each key as its thread finishes so the queue can advance', async () => {
    proxySource.keyCount = 1;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: {
        mode: 'manual',
        entries: ['1@x.com|p', '2@x.com|p', '3@x.com|p', '4@x.com|p']
      }
    }));
    await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBe(1);
    expect(proxySource.released).toHaveLength(4);
  });

  it('runs every thread at once when the account has enough keys', async () => {
    emailSource.available = 3;
    proxySource.keyCount = 10;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3 }));
    await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBe(3);
  });

  it('does not queue at all in direct proxy mode', async () => {
    proxySource.keyCount = 1;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 3,
      emailSource: { mode: 'manual', entries: ['a@x.com|p', 'b@x.com|p', 'c@x.com|p'] },
      proxy: { mode: 'direct', entries: [] }
    }));
    await service.waitForCompletion();

    expect(browser.startCalls).toHaveLength(3);
    expect(proxySource.acquired).toHaveLength(0);
  });
});

describe('AutomationRunService với nguồn email domain tự sở hữu', () => {
  it('xin đúng số địa chỉ trên domain khi chọn chế độ custom', async () => {
    emailSource.available = 3;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3, emailSource: { mode: 'custom' } }));
    await service.waitForCompletion();

    expect(emailSource.purchaseCalls).toEqual([{ provider: 'customdomain', count: 3 }]);
    expect(accounts.created.map((row) => row.email)).toEqual([
      'user1@oldevlk.com', 'user2@oldevlk.com', 'user3@oldevlk.com'
    ]);
  });

  it('gắn provider customdomain vào tài khoản để đọc OTP về sau', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1, emailSource: { mode: 'custom' } }));
    await service.waitForCompletion();

    expect(accounts.created[0]).toMatchObject({ emailProvider: 'customdomain' });
    expect(emailSource.consumed).toEqual([{ id: 'pe-1', accountId: 'acc-1' }]);
  });

  it('báo lỗi rõ ràng khi không sinh được địa chỉ nào', async () => {
    emailSource.available = 0;
    emailSource.failures = ['trùng địa chỉ'];
    const service = createService();

    await expect(
      service.start(baseConfig({ emailSource: { mode: 'custom' } }))
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('AutomationRunService báo cho người dùng biết đang chờ proxy', () => {
  it('ghi log trước khi xin proxy để lúc chờ key không trông như treo', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1, proxy: { mode: 'proxykey', keys: ['K1'] } }));
    await service.waitForCompletion();
    logBus.flush();

    const messages = sink.rows.map((row) => (row as { message: string }).message);
    const waitIndex = messages.findIndex((message) => message.includes('Đang xin proxy key'));
    const gotIndex = messages.findIndex((message) => message.includes('Đã nhận proxy'));

    expect(waitIndex).toBeGreaterThanOrEqual(0);
    expect(gotIndex).toBeGreaterThanOrEqual(0);
    expect(waitIndex).toBeLessThan(gotIndex);
  });

  it('không ghi log xin proxy khi chạy Direct IP', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: [] }
    }));
    await service.waitForCompletion();
    logBus.flush();

    const messages = sink.rows.map((row) => (row as { message: string }).message);
    expect(messages.some((message) => message.includes('Đang xin proxy key'))).toBe(false);
  });
});

describe('AutomationRunService giới hạn theo danh sách proxy key của phiên', () => {
  it('truyền đúng danh sách key người dùng nhập xuống nguồn proxy', async () => {
    emailSource.available = 2;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      proxy: { mode: 'proxykey', keys: ['K1', 'K2'] }
    }));
    await service.waitForCompletion();

    expect(proxySource.configuredKeys).toEqual([['K1', 'K2']]);
  });

  it('chuyển vùng KiotProxy đã chọn xuống nguồn proxy', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      proxy: { mode: 'proxykey', keys: ['K1'], region: 'bac' }
    }));
    await service.waitForCompletion();

    expect(proxySource.configuredRegions).toEqual(['bac']);
  });

  it('không chọn vùng thì không gửi khoá region', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1, proxy: { mode: 'proxykey', keys: ['K1'] } }));
    await service.waitForCompletion();

    expect(proxySource.configuredRegions).toEqual([undefined]);
  });

  it('chỉ chạy song song bằng số key được nhập, phần còn lại xếp hàng', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 2,
      proxy: { mode: 'proxykey', keys: ['K1', 'K2'] },
      emailSource: {
        mode: 'manual',
        entries: ['1@x.com|p', '2@x.com|p', '3@x.com|p', '4@x.com|p', '5@x.com|p']
      }
    }));
    const summary = await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBeLessThanOrEqual(2);
    expect(browser.startCalls).toHaveLength(5);
    expect(summary.accountsFailed).toBe(0);
  });

  it('danh sách rỗng thì vẫn dùng toàn bộ key của tài khoản', async () => {
    emailSource.available = 3;
    proxySource.keyCount = 10;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3, proxy: { mode: 'proxykey', keys: [] } }));
    await service.waitForCompletion();

    expect(proxySource.configuredKeys).toEqual([[]]);
    expect(proxySource.peakConcurrent).toBe(3);
  });

  it('không cấu hình nguồn proxy khi chạy Direct IP', async () => {
    const service = createService();

    await service.start(baseConfig({
      threadCount: 1,
      emailSource: { mode: 'manual', entries: ['a@x.com|p'] },
      proxy: { mode: 'direct', entries: [] }
    }));
    await service.waitForCompletion();

    expect(proxySource.configuredKeys).toEqual([]);
  });
});

describe('AutomationRunService continuous cancellable worker lifecycle', () => {
  class StubWorkSource implements AutomationWorkSource {
    public prepareCalls = 0;
    public nextCalls = 0;
    public maxConcurrentNext = 0;
    public committed: string[] = [];
    public released: string[] = [];
    public terminalError: Error | null = null;
    public terminalThrown = false;
    public gatedNextCall: number | null = null;
    public nextGate: Promise<void> | null = null;
    private activeNext = 0;
    private readonly queue: AutomationWorkItem[];

    constructor(
      public readonly kind: WorkSourceKind,
      items: AutomationWorkItem[],
      private readonly workerTarget: number
    ) {
      this.queue = [...items];
    }

    async prepare(
      _initialConcurrency: number,
      _signal: AbortSignal
    ): Promise<SourceReadiness> {
      this.prepareCalls += 1;
      return { workerTarget: this.workerTarget };
    }

    async next(_workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null> {
      this.nextCalls += 1;
      const callNumber = this.nextCalls;
      this.activeNext += 1;
      this.maxConcurrentNext = Math.max(this.maxConcurrentNext, this.activeNext);
      try {
        if (this.gatedNextCall === callNumber && this.nextGate) {
          await Promise.race([
            this.nextGate,
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(signal.reason ?? new Error('Aborted')),
                { once: true }
              );
            })
          ]);
        }
        const item = this.queue.shift();
        if (item) return item;
        if (this.kind === 'finite') return null;
        if (this.terminalError) {
          this.terminalThrown = true;
          throw this.terminalError;
        }
        return await new Promise<AutomationWorkItem>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(signal.reason ?? new Error('Aborted')),
            { once: true }
          );
        });
      } finally {
        this.activeNext -= 1;
      }
    }

    commit(item: AutomationWorkItem, _accountId: string): void {
      this.committed.push(item.sourceId);
    }

    release(item: AutomationWorkItem): void {
      this.released.push(item.sourceId);
    }
  }

  function makeItems(count: number, provider = 'gmail94'): AutomationWorkItem[] {
    return Array.from({ length: count }, (_value, index) => ({
      kind: 'new',
      sourceId: 'source-' + (index + 1),
      email: 'mail' + (index + 1) + '@gmail.com',
      emailProvider: provider,
      purchasedEmailId: 'pe-' + (index + 1),
      reservationId: 'reservation-' + (index + 1)
    }));
  }

  async function waitFor(
    predicate: () => boolean,
    description: string
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('Timed out waiting for ' + description);
  }

  class WorkloadGate {
    public callCount = 0;
    private readonly releases: Array<() => void> = [];

    constructor(private readonly holdFromCall: number | null) {}

    readonly sleep = async (ms: number): Promise<void> => {
      if (ms < 100_000) return;
      this.callCount += 1;
      if (this.holdFromCall === null || this.callCount < this.holdFromCall) return;
      await new Promise<void>((resolve) => this.releases.push(resolve));
    };

    releaseAll(): void {
      for (const release of this.releases.splice(0)) release();
    }
  }

  interface HarnessOptions {
    kind: WorkSourceKind;
    threadCount: number;
    items: AutomationWorkItem[];
    holdFromWorkload?: number;
    emailSource: AutomationRunConfigDTO['emailSource'];
    proxy?: AutomationRunConfigDTO['proxy'];
  }

  function createHarness(options: HarnessOptions) {
    const source = new StubWorkSource(
      options.kind,
      options.items,
      options.kind === 'finite'
        ? Math.min(options.threadCount, options.items.length)
        : options.threadCount
    );
    const accounts = new StubAccounts();
    const browser = new StubBrowserRuntime();
    const proxies = new StubProxySource();
    const sink = new CollectingSink();
    const logBus = new LogBus(sink, { maxBatchSize: 1000 });
    const workloads = new WorkloadGate(options.holdFromWorkload ?? null);
    let id = 0;
    const config = baseConfig({
      threadCount: options.threadCount,
      module: 'credit',
      emailSource: options.emailSource,
      proxy: options.proxy ?? { mode: 'direct', entries: [] },
      testDurationMs: options.holdFromWorkload === undefined ? 0 : 100_000
    });
    const service = new AutomationRunService(
      {
        workSources: { create: () => source },
        emailOtp: { readOtp: async () => '123456' },
        proxies,
        browser,
        accounts,
        logBus
      },
      {
        nextId: () => 'id-' + ++id,
        sleep: workloads.sleep
      }
    );

    return {
      service,
      source,
      accounts,
      browser,
      proxies,
      sink,
      logBus,
      workloads,
      config,
      waitForAccepted: (count: number) =>
        waitFor(
          () => (service.getProgress().accountsAccepted ?? 0) >= count,
          count + ' accepted accounts'
        ),
      waitForRunningAccount: async (excludeId?: string) => {
        await waitFor(
          () => service.getRunningThreads().some((row) => row.accountId !== excludeId),
          'running account'
        );
        return service.getRunningThreads().find((row) => row.accountId !== excludeId) as RunningThreadInfo;
      }
    };
  }

  function createContinuousHarness(options: {
    threadCount: number;
    items: number;
    holdFromWorkload?: number;
    proxy?: AutomationRunConfigDTO['proxy'];
  }) {
    return createHarness({
      kind: 'continuous',
      threadCount: options.threadCount,
      items: makeItems(options.items),
      holdFromWorkload: options.holdFromWorkload,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' },
      proxy: options.proxy
    });
  }

  function createManualHarness(options: {
    threadCount: number;
    entries: string[];
  }) {
    const items = options.entries.map((email, index) => ({
      kind: 'new' as const,
      sourceId: 'manual:' + (index + 1),
      email,
      emailProvider: 'manual'
    }));
    return createHarness({
      kind: 'finite',
      threadCount: options.threadCount,
      items,
      emailSource: { mode: 'manual', entries: options.entries },
      proxy: { mode: 'direct', entries: [] }
    });
  }

  it('threadCount one refills the slot with a second API account', async () => {
    const harness = createContinuousHarness({ threadCount: 1, items: 2 });
    await harness.service.start(harness.config);
    await harness.waitForAccepted(2);

    expect(harness.source.maxConcurrentNext).toBe(1);
    expect(harness.accounts.created.map((row) => row.email)).toEqual([
      'mail1@gmail.com',
      'mail2@gmail.com'
    ]);

    await harness.service.stop();
  });

  it('never exceeds threadCount active API worker iterations', async () => {
    const harness = createContinuousHarness({
      threadCount: 2,
      items: 5,
      holdFromWorkload: 1
    });
    await harness.service.start(harness.config);
    await harness.waitForAccepted(2);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.browser.peakOpenProfiles).toBe(2);
    expect(harness.service.getProgress().workersActive).toBe(2);
    expect(harness.service.getProgress().accountsAccepted).toBe(2);

    await harness.service.stop();
  });

  it('does not let a fast worker consume refill work before the initial API wave is acquired', async () => {
    const harness = createContinuousHarness({ threadCount: 2, items: 3 });
    let releaseSecond: () => void = () => {};
    harness.source.gatedNextCall = 2;
    harness.source.nextGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const starting = harness.service.start(harness.config);
    await waitFor(() => harness.source.nextCalls === 2, 'two initial acquisitions');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.source.nextCalls).toBe(2);
    expect(harness.service.getProgress().workerTarget).toBe(2);

    releaseSecond();
    await starting;
    await harness.waitForAccepted(3);
    await harness.service.stop();
  });

  it('manual mode processes every entry with threadCount only as concurrency', async () => {
    const harness = createManualHarness({
      threadCount: 2,
      entries: [
        'one@example.com',
        'two@example.com',
        'three@example.com',
        'four@example.com',
        'five@example.com'
      ]
    });

    await harness.service.start(harness.config);
    const summary = await harness.service.waitForCompletion();

    expect(harness.accounts.created).toHaveLength(5);
    expect(harness.browser.peakOpenProfiles).toBe(2);
    expect(summary.state).toBe('completed');
    expect(summary.terminalReason).toEqual({ code: 'MANUAL_EXHAUSTED' });
    expect(summary.accountsAccepted).toBe(5);
    expect(summary.accountsCompleted).toBe(5);
  });

  it('stopThread stops one account and refills that worker while the run stays active', async () => {
    const harness = createContinuousHarness({
      threadCount: 1,
      items: 3,
      holdFromWorkload: 1
    });
    await harness.service.start(harness.config);
    const first = await harness.waitForRunningAccount();

    await expect(harness.service.stopThread(first.accountId)).resolves.toBe(true);
    const second = await harness.waitForRunningAccount(first.accountId);

    expect(second.accountId).not.toBe(first.accountId);
    expect(harness.service.getProgress().state).toBe('running');
    expect(harness.service.getProgress().accountsStopped).toBe(1);
    await harness.service.stop();
  });

  it('global Stop prevents another source.next after the active account', async () => {
    const harness = createContinuousHarness({
      threadCount: 1,
      items: 2,
      holdFromWorkload: 1
    });
    await harness.service.start(harness.config);
    await harness.waitForAccepted(1);

    await harness.service.stop();

    expect(harness.source.nextCalls).toBe(1);
    expect(harness.service.getProgress()).toMatchObject({
      state: 'stopped',
      terminalReason: { code: 'USER_STOP' }
    });
  });

  it('stops only unfinished work and preserves an earlier completed account', async () => {
    const harness = createContinuousHarness({
      threadCount: 1,
      items: 2,
      holdFromWorkload: 2
    });
    await harness.service.start(harness.config);
    await harness.waitForAccepted(2);

    await harness.service.stop();
    const summary = await harness.service.waitForCompletion();
    const lastStatus = new Map<string, unknown>();
    for (const update of harness.accounts.updates) {
      if (update.data.status) lastStatus.set(update.id, update.data.status);
    }

    expect(summary.accountsCompleted).toBe(1);
    expect(summary.accountsStopped).toBe(1);
    expect(lastStatus.get('acc-1')).toBe('done');
    expect(lastStatus.get('acc-2')).toBe('stopped');
  });

  it('blocks a short proxy-key wave before requesting an email', async () => {
    const harness = createContinuousHarness({
      threadCount: 2,
      items: 2,
      proxy: { mode: 'proxykey', keys: ['only-one-key'] }
    });
    harness.proxies.keyCount = 1;

    await expect(harness.service.start(harness.config)).rejects.toMatchObject({
      state: 'blocked',
      reason: {
        code: 'PROXY_CAPACITY_UNAVAILABLE',
        details: { requestedWorkers: 2, availableSlots: 1 }
      }
    });
    expect(harness.source.nextCalls).toBe(0);
    expect(harness.browser.startCalls).toHaveLength(0);
  });

  it.each([
    { module: 'trial' as const, browser: 'multilogin' as const },
    { module: 'credit' as const, browser: 'gologin' as const }
  ])('rejects unsupported work before preparing an email source', async (unsupported) => {
    const harness = createContinuousHarness({ threadCount: 1, items: 1 });

    await expect(harness.service.start({
      ...harness.config,
      module: unsupported.module,
      browser: unsupported.browser
    })).rejects.toBeInstanceOf(Error);

    expect(harness.source.prepareCalls).toBe(0);
    expect(harness.source.nextCalls).toBe(0);
    expect(harness.browser.startCalls).toHaveLength(0);
  });

  it('releases an uncommitted mailbox when browser launch fails', async () => {
    const harness = createContinuousHarness({ threadCount: 1, items: 1 });
    harness.browser.failAtCall = 1;
    await harness.service.start(harness.config);
    await waitFor(
      () => harness.source.released.includes('source-1'),
      'released mailbox reservation'
    );

    expect(harness.source.committed).toEqual([]);
    expect(harness.source.released).toEqual(['source-1']);
    await harness.service.stop();
  });

  it('assigns exactly one terminal counter to every accepted account', async () => {
    const harness = createManualHarness({
      threadCount: 2,
      entries: ['one@example.com', 'two@example.com', 'three@example.com']
    });
    harness.browser.failAtCall = 2;

    await harness.service.start(harness.config);
    const summary = await harness.service.waitForCompletion();

    expect(summary.accountsAccepted).toBe(3);
    expect(summary.accountsCompleted).toBe(2);
    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsStopped).toBe(0);
    expect(
      summary.accountsCompleted + summary.accountsFailed + summary.accountsStopped
    ).toBe(summary.accountsAccepted);
  });

  it('retains the workload outcome when cleanup fails and reports the cleanup count', async () => {
    const harness = createManualHarness({
      threadCount: 1,
      entries: ['one@example.com']
    });
    harness.browser.failStopFor.add('profile-1');

    await harness.service.start(harness.config);
    const summary = await harness.service.waitForCompletion();

    expect(summary.accountsCompleted).toBe(1);
    expect(summary.accountsFailed).toBe(0);
    expect(summary.state).toBe('failed');
    expect(summary.terminalReason).toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      details: { cleanupFailures: 1 }
    });
    expect(harness.accounts.updates.at(-1)?.data.status).toBe('done');
  });

  it('reports a partial initial API wave as blocked without lowering workerTarget', async () => {
    const harness = createContinuousHarness({ threadCount: 2, items: 1 });
    harness.source.terminalError = new AutomationTerminalError(
      'blocked',
      { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' },
      'Số dư Gmail94 không đủ.'
    );

    await harness.service.start(harness.config);
    const summary = await harness.service.waitForCompletion();

    expect(summary.workerTarget).toBe(2);
    expect(summary.state).toBe('blocked');
    expect(summary.terminalReason).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      provider: 'gmail94'
    });
    expect(summary.state).not.toBe('completed');
  });

  it('lets an in-flight workload settle before publishing a provider block', async () => {
    const harness = createContinuousHarness({
      threadCount: 2,
      items: 2,
      holdFromWorkload: 2
    });
    harness.source.terminalError = new AutomationTerminalError(
      'blocked',
      { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' },
      'Số dư Gmail94 không đủ.'
    );
    await harness.service.start(harness.config);
    const completion = harness.service.waitForCompletion();
    let settled = false;
    void completion.then(() => { settled = true; });

    await waitFor(() => harness.source.terminalThrown, 'provider terminal error');
    expect(settled).toBe(false);
    expect(harness.browser.stopped).toHaveLength(1);

    harness.workloads.releaseAll();
    const summary = await completion;
    expect(summary.state).toBe('blocked');
    expect(summary.terminalReason).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      provider: 'gmail94'
    });
    expect(summary.accountsCompleted).toBe(2);
  });

  it('keeps waitForCompletion pending for a continuous source until Stop', async () => {
    const harness = createContinuousHarness({ threadCount: 1, items: 1 });
    await harness.service.start(harness.config);
    await harness.waitForAccepted(1);
    const completion = harness.service.waitForCompletion();
    let settled = false;
    void completion.then(() => { settled = true; });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    await harness.service.stop();
    await expect(completion).resolves.toMatchObject({
      state: 'stopped',
      terminalReason: { code: 'USER_STOP' }
    });
  });

  it('publishes failed for an unexpected continuous-source invariant', async () => {
    const harness = createContinuousHarness({ threadCount: 1, items: 0 });
    harness.source.terminalError = new Error('unexpected invariant');

    await harness.service.start(harness.config);
    const summary = await harness.service.waitForCompletion();

    expect(summary).toMatchObject({
      state: 'failed',
      terminalReason: { code: 'INTERNAL_ERROR' },
      accountsAccepted: 0,
      accountsFailed: 0
    });
  });

  it('logs every orchestration stage with an integer elapsed time', async () => {
    const harness = createManualHarness({
      threadCount: 1,
      entries: ['one@example.com']
    });

    await harness.service.start(harness.config);
    await harness.service.waitForCompletion();
    harness.logBus.flush();

    const timing = harness.sink.rows
      .map((row) => (row as { message: string }).message)
      .filter((message) => message.startsWith('stage='));
    for (const stage of [
      'source-preflight',
      'email-acquisition',
      'browser-launch',
      'cleanup',
      'account-total'
    ]) {
      expect(timing.some((message) => message.startsWith('stage=' + stage + ' ')))
        .toBe(true);
    }
    expect(timing.every((message) =>
      /^stage=[a-z0-9:_-]+ elapsedMs=\d+ outcome=(success|error)$/.test(message)
    )).toBe(true);
  });

  it('logs a failed browser stage without copying the launcher exception', async () => {
    const harness = createManualHarness({
      threadCount: 1,
      entries: ['one@example.com']
    });
    harness.browser.failAtCall = 1;

    await harness.service.start(harness.config);
    await harness.service.waitForCompletion();
    harness.logBus.flush();

    const browserTiming = harness.sink.rows
      .map((row) => (row as { message: string }).message)
      .find((message) => message.startsWith('stage=browser-launch '));
    expect(browserTiming).toMatch(
      /^stage=browser-launch elapsedMs=\d+ outcome=error$/
    );
    expect(browserTiming).not.toContain('launcher refused');
  });
});

describe('session-scoped browser ownership', () => {
  interface InternalThreadSessionRef {
    accountId: string;
    session?: BrowserSessionRuntime;
  }

  interface ServiceOwnershipAccessor {
    activeThreads: Map<string, InternalThreadSessionRef>;
    stopSession(thread: InternalThreadSessionRef, session: BrowserSessionRuntime): Promise<boolean>;
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function createStubFactory(entries: string[] = ['user@example.com|pass']): AutomationWorkSourceFactory {
    return {
      create: () => {
        const items = entries.map((entry, idx) => ({
          kind: 'new' as const,
          sourceId: 'man-' + (idx + 1),
          email: entry.split('|')[0],
          emailProvider: 'manual'
        }));
        return {
          kind: 'finite' as const,
          prepare: async (c: number) => ({ workerTarget: Math.min(c, items.length) }),
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }
    };
  }

  it('stops the exact session once when Stop races final cleanup', async () => {
    emailSource.available = 1;
    const defStop = createDeferred<void>();
    const stoppedProfiles: string[] = [];

    const customBrowser = new StubBrowserRuntime();
    customBrowser.stopProfile = vi.fn(async (id: string) => {
      stoppedProfiles.push(id);
      await defStop.promise;
    });

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser: customBrowser,
        accounts,
        logBus
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const thread = (service as unknown as ServiceOwnershipAccessor).activeThreads.get('acc-1');
    expect(thread).toBeDefined();
    const session = thread!.session;
    expect(session).toBeDefined();

    // Race global stop and direct stopSession
    const stop1 = service.stopThread('acc-1');
    const stop2 = (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, session!);

    expect(stoppedProfiles).toEqual(['profile-1']);

    defStop.resolve();
    const [res1, res2] = await Promise.all([stop1, stop2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(stoppedProfiles).toEqual(['profile-1']);

    await service.stop();
    await service.waitForCompletion();
  });

  it('does not reuse the old stop promise for a replacement session', async () => {
    emailSource.available = 1;
    const stoppedProfiles: string[] = [];
    const customBrowser = new StubBrowserRuntime();
    customBrowser.stopProfile = vi.fn(async (id: string) => {
      stoppedProfiles.push(id);
    });

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser: customBrowser,
        accounts,
        logBus
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const thread = (service as unknown as ServiceOwnershipAccessor).activeThreads.get('acc-1');
    expect(thread).toBeDefined();
    const sessionA = thread!.session;
    expect(sessionA).toBeDefined();
    expect(sessionA!.profileId).toBe('profile-1');

    // Stop session A
    await (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, sessionA!);
    expect(stoppedProfiles).toEqual(['profile-1']);

    // Install replacement session B
    const sessionB: BrowserSessionRuntime = {
      alias: 'worker-1-session-2',
      startedAt: Date.now(),
      stopRequested: false,
      profileId: 'profile-2',
      ui: createDirectUiInteraction(new AbortController().signal)
    };
    thread!.session = sessionB;

    // Final cleanup / stop session B
    await (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, sessionB);
    expect(stoppedProfiles).toEqual(['profile-1', 'profile-2']);

    await service.stop();
    await service.waitForCompletion();
  });

  it('retains ownership when profile id is published before attach rejects', async () => {
    const stoppedProfiles: string[] = [];
    const fakeLauncher: BrowserLauncher = {
      name: 'api-v3',
      launch: vi.fn(async (opts) => {
        opts.onProfileStarted?.('profile-attached-fails');
        throw new Error('CDP attachment failed');
      }),
      stop: vi.fn(async (id) => {
        stoppedProfiles.push(id);
      })
    };

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => fakeLauncher
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin' }));
    await service.waitForCompletion();

    expect(stoppedProfiles).toEqual(['profile-attached-fails']);
    expect(service.getRunningThreads()).toHaveLength(0);
  });

  it('removes a session only after its profile stop succeeds', async () => {
    emailSource.available = 1;
    const defStop = createDeferred<void>();
    const customBrowser = new StubBrowserRuntime();
    customBrowser.stopProfile = vi.fn(async () => defStop.promise);

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser: customBrowser,
        accounts,
        logBus
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const thread = (service as unknown as ServiceOwnershipAccessor).activeThreads.get('acc-1');
    expect(thread).toBeDefined();
    const session = thread!.session;
    expect(session).toBeDefined();

    const stopPromise = (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, session!);
    await Promise.resolve();

    // Session must still be present on thread while stop is in flight
    expect(thread!.session).toBe(session);

    defStop.resolve();
    await stopPromise;

    // Session is cleared after success
    expect(thread!.session).toBeUndefined();

    await service.stop();
    await service.waitForCompletion();
  });

  it('keeps a failed-stop session addressable and does not confirm scheduler cleanup', async () => {
    emailSource.available = 1;
    let schedulerConfirmed = 0;
    let stopCallCount = 0;

    const customBrowser = new StubBrowserRuntime();
    customBrowser.stopProfile = vi.fn(async () => {
      stopCallCount++;
      throw new Error('CDP stop crashed');
    });

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser: customBrowser,
        accounts,
        logBus
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const thread = (service as unknown as ServiceOwnershipAccessor).activeThreads.get('acc-1');
    expect(thread).toBeDefined();
    const session = thread!.session;
    expect(session).toBeDefined();
    session!.scheduler = {
      confirmProfileStopped: () => { schedulerConfirmed++; },
      shutdown: () => {}
    } as unknown as RunUiInteractionScheduler;

    const stopped = await (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, session!);
    expect(stopped).toBe(false);

    // Remains addressable
    expect(thread!.session).toBe(session);
    expect(session!.stopFailed).toBe(true);
    expect(schedulerConfirmed).toBe(0);

    // No second automated stop call
    await (service as unknown as ServiceOwnershipAccessor).stopSession(thread!, session!);
    expect(stopCallCount).toBe(1);

    await service.stop();
    await service.waitForCompletion();
  });

  it('defers Stop requested before profile id and stops the late profile exactly once', async () => {
    const stoppedProfiles: string[] = [];
    const defStart = createDeferred<void>();

    const fakeLauncher: BrowserLauncher = {
      name: 'api-v3',
      launch: vi.fn(async (opts) => {
        await defStart.promise;
        opts.onProfileStarted?.('late-profile-a');
        return {
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context'],
          port: 9222,
          profileId: 'late-profile-a'
        };
      }),
      stop: vi.fn(async (id) => {
        stoppedProfiles.push(id);
      })
    };

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => fakeLauncher
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin', testDurationMs: 600_000 }));
    await Promise.resolve();

    // Stop before profile ID
    const stopPromise = service.stop();

    // Now profile is published late
    defStart.resolve();
    await stopPromise;
    await service.waitForCompletion();

    expect(stoppedProfiles).toEqual(['late-profile-a']);
  });

  it('settles pre-id Stop when launch fails without creating a profile', async () => {
    const stoppedProfiles: string[] = [];
    const defStart = createDeferred<void>();

    const fakeLauncher: BrowserLauncher = {
      name: 'api-v3',
      launch: vi.fn(async () => {
        await defStart.promise;
        throw new Error('Quick profile API rejected before ID');
      }),
      stop: vi.fn(async (id) => {
        stoppedProfiles.push(id);
      })
    };

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => fakeLauncher
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin', testDurationMs: 600_000 }));
    await Promise.resolve();

    const stopPromise = service.stop();
    defStart.resolve();

    await stopPromise;
    await service.waitForCompletion();

    expect(stoppedProfiles).toHaveLength(0);
  });

  it('fails closed when pre-id launch never settles after Stop', async () => {
    const fakeLauncher: BrowserLauncher = {
      name: 'api-v3',
      launch: vi.fn(async () => new Promise<never>(() => {})), // Never settles
      stop: vi.fn(async () => {})
    };

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => fakeLauncher
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1',
        sessionLaunchStopGraceMs: 20
      }
    );

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin', testDurationMs: 600_000 }));
    await Promise.resolve();

    const stopPromise = service.stop();
    await stopPromise;
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
  });

  it('fails closed when the exact profile stop never settles', async () => {
    const fakeLauncher: BrowserLauncher = {
      name: 'api-v3',
      launch: vi.fn(async (opts) => {
        opts.onProfileStarted?.('hang-stop-profile');
        return {
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context'],
          port: 9222,
          profileId: 'hang-stop-profile'
        };
      }),
      stop: vi.fn(async () => new Promise<never>(() => {})) // Never settles
    };

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['user@example.com|pass']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser,
        accounts,
        logBus,
        launcher: () => fakeLauncher
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1',
        profileStopTimeoutMs: 20
      }
    );

    await service.start(baseConfig({ threadCount: 1, browser: 'multilogin', testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    await service.stop();
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
  });

  it('turns failed profile stop into run-terminal scheduler shutdown', async () => {
    let shutdownReason: { reason: { code?: string } } | undefined;
    const customBrowser = new StubBrowserRuntime();
    customBrowser.stopProfile = vi.fn(async () => {
      throw new Error('teardown broken');
    });

    const service = new AutomationRunService(
      {
        workSources: createStubFactory(['u1@example.com|p1', 'u2@example.com|p2']),
        emailOtp: { readOtp: async () => '123456' },
        proxies: proxySource,
        browser: customBrowser,
        accounts,
        logBus
      },
      {
        sleep: async () => {},
        nextId: () => 'run-1'
      }
    );

    await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
    await service.waitUntilRunning();

    const thread1 = (service as unknown as ServiceOwnershipAccessor).activeThreads.get('acc-1');
    expect(thread1).toBeDefined();
    const session1 = thread1!.session;
    expect(session1).toBeDefined();

    // Attach mock scheduler
    session1!.scheduler = {
      confirmProfileStopped: () => {},
      shutdown: (reason: unknown) => { shutdownReason = reason as { reason: { code?: string } }; }
    } as unknown as RunUiInteractionScheduler;

    await (service as unknown as ServiceOwnershipAccessor).stopSession(thread1!, session1!);

    expect(shutdownReason).toBeDefined();
    expect(shutdownReason!.reason.code).toBe('RESOURCE_CLEANUP_FAILED');

    const summary = await service.waitForCompletion();
    expect(summary.state).toBe('failed');
  });

  describe('Task 10: Deterministic 1/3/5/10-worker stress and resource invariants', () => {
    describe.each([1, 3, 5, 10])('Worker cap %i', (count) => {
      it(`keeps workers, profiles, proxies, reservations, and accepted accounts within cap ${count}`, async () => {
        const { peaks, counters, final } = await runDeterministicSimulation({
          count,
          seed: 42
        });

        expect(peaks.workers).toBeLessThanOrEqual(count);
        expect(peaks.profiles).toBeLessThanOrEqual(count);
        expect(peaks.proxies).toBeLessThanOrEqual(count);
        expect(peaks.mailReservations).toBeLessThanOrEqual(count);
        expect(counters.accepted).toBeLessThanOrEqual(count);
        expect(counters.completed + counters.failed + counters.stopped).toBe(counters.accepted);
        expect(final.activeThreads).toBe(0);
        expect(final.schedulerForegroundWaiting).toBe(0);
        expect(final.schedulerEditorWaiting).toBe(0);
      });

      it(`settles 100 seeded completion orders without leaks at ${count} workers`, async () => {
        for (let seed = 1; seed <= 100; seed++) {
          const { peaks, counters, final } = await runDeterministicSimulation({
            count,
            seed
          });

          expect(peaks.workers, `seed ${seed} workers peak`).toBeLessThanOrEqual(count);
          expect(peaks.profiles, `seed ${seed} profiles peak`).toBeLessThanOrEqual(count);
          expect(peaks.proxies, `seed ${seed} proxies peak`).toBeLessThanOrEqual(count);
          expect(peaks.mailReservations, `seed ${seed} mailReservations peak`).toBeLessThanOrEqual(count);
          expect(counters.accepted, `seed ${seed} accepted`).toBeLessThanOrEqual(count);
          expect(counters.completed + counters.failed + counters.stopped, `seed ${seed} terminal sum`).toBe(counters.accepted);
          expect(final.activeThreads, `seed ${seed} activeThreads`).toBe(0);
          expect(final.schedulerForegroundWaiting, `seed ${seed} fg waiting`).toBe(0);
          expect(final.schedulerEditorWaiting, `seed ${seed} editor waiting`).toBe(0);
        }
      });
    });

    describe('Injected fault matrix', () => {
      it('never admits another foreground action before quarantined profile stop', async () => {
        const events: string[] = [];
        let resolveStop1: () => void = () => {};
        const stop1Promise = new Promise<void>((r) => { resolveStop1 = r; });

        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            const profileId = 'prof-' + ((fakeLauncher.launch as ReturnType<typeof vi.fn>).mock.calls.length);
            opts.onProfileStarted?.(profileId);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId
            };
          }),
          stop: vi.fn(async (id) => {
            if (id === 'prof-1') {
              await stop1Promise;
            }
            events.push('stop:' + id);
          })
        };

        let acc1Attempts = 0;
        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            if (input.accountId === 'acc-1') {
              acc1Attempts++;
              if (acc1Attempts === 1) {
                try {
                  await input.ui?.foreground('act-1', async () => {
                    events.push('fg:acc-1:start');
                    throw new DomReadTimeoutError('canvas-mouse');
                  });
                } catch {
                  return {
                    authenticated: true,
                    done: 0,
                    total: 1,
                    credits: 0,
                    creditsTotal: 10,
                    missing: ['task-1'],
                    tasks: [],
                    unsettledProofs: [],
                    verification: null,
                    fatalCode: 'DOM_READ_TIMEOUT',
                    fatalError: 'DOM_READ_TIMEOUT'
                  };
                }
              }
            } else {
              await input.ui?.foreground('act-2', async () => {
                events.push('fg:acc-2:start');
              });
            }
            return {
              authenticated: true,
              done: 1,
              total: 1,
              credits: 10,
              creditsTotal: 10,
              missing: [],
              tasks: [],
              unsettledProofs: [],
              verification: null
            };
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1', 'u2@example.com|p2']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
        await service.waitUntilRunning();

        // Give worker 1 time to fault and quarantine
        await new Promise((r) => setTimeout(r, 50));
        expect(events).toContain('fg:acc-1:start');
        expect(events).not.toContain('fg:acc-2:start');

        // Now release worker 1's profile stop
        resolveStop1();
        await service.waitForCompletion();

        expect(events).toContain('stop:prof-1');
        expect(events).toContain('fg:acc-2:start');
        expect(events.indexOf('stop:prof-1')).toBeLessThan(events.indexOf('fg:acc-2:start'));
      });

      it('never starts replacement after an uncertain old-profile stop', async () => {
        let launchCount = 0;
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            launchCount++;
            const profileId = 'prof-' + launchCount;
            opts.onProfileStarted?.(profileId);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId
            };
          }),
          stop: vi.fn(async () => {
            throw new Error('Stop failed irrevocably');
          })
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async () => {
            return {
              authenticated: true,
              done: 0,
              total: 1,
              credits: 0,
              creditsTotal: 10,
              missing: ['task-1'],
              tasks: [],
              unsettledProofs: [],
              verification: null,
              fatalCode: 'DOM_READ_TIMEOUT',
              fatalError: 'DOM_READ_TIMEOUT: mouse-hang'
            };
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(launchCount).toBe(1); // Never launched replacement
        expect(summary.state).toBe('failed');
        expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
      });

      it('drains every scheduler waiter after an uncertain old-profile stop', async () => {
        let waiterRejected = false;
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            const profileId = 'prof-' + ((fakeLauncher.launch as ReturnType<typeof vi.fn>).mock.calls.length);
            opts.onProfileStarted?.(profileId);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId
            };
          }),
          stop: vi.fn(async (id) => {
            if (id === 'prof-1') throw new Error('Uncertain stop on worker 1');
          })
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            if (input.accountId === 'acc-1') {
              return {
                authenticated: true,
                done: 0,
                total: 1,
                credits: 0,
                creditsTotal: 10,
                missing: ['task-1'],
                tasks: [],
                unsettledProofs: [],
                verification: null,
                fatalCode: 'DOM_READ_TIMEOUT',
                fatalError: 'DOM_READ_TIMEOUT'
              };
            } else {
              // Worker 2 tries foreground which should be queued then drained
              try {
                await input.ui?.foreground('w2-action', async () => {
                  await new Promise<void>((_, reject) => {
                    if (input.signal.aborted) {
                      reject(input.signal.reason);
                      return;
                    }
                    input.signal.addEventListener('abort', () => reject(input.signal.reason));
                  });
                });
              } catch {
                waiterRejected = true;
                throw new Error('Waiter drained');
              }
              return {
                authenticated: true,
                done: 1,
                total: 1,
                credits: 10,
                creditsTotal: 10,
                missing: [],
                tasks: [],
                unsettledProofs: [],
                verification: null
              };
            }
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1', 'u2@example.com|p2']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 2, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(summary.state).toBe('failed');
        expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
        expect(waiterRejected).toBe(true);
      });

      it('stops a profile published after a pre-id Stop', async () => {
        const stoppedProfiles: string[] = [];
        let engineCalls = 0;
        const defStart = createDeferred<void>();

        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            await defStart.promise;
            opts.onProfileStarted?.('late-profile-task10');
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: 'late-profile-task10'
            };
          }),
          stop: vi.fn(async (id) => {
            stoppedProfiles.push(id);
          })
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async () => {
            engineCalls++;
            return {
              authenticated: true,
              done: 1,
              total: 1,
              credits: 10,
              creditsTotal: 10,
              missing: [],
              tasks: [],
              unsettledProofs: [],
              verification: null
            };
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, browser: 'multilogin', testDurationMs: 600_000 }));
        await Promise.resolve();

        // Stop before profile ID published
        const stopPromise = service.stop();

        // Publish profile ID
        defStart.resolve();
        await stopPromise;
        await service.waitForCompletion();

        expect(stoppedProfiles).toEqual(['late-profile-task10']);
        expect(engineCalls).toBe(0);
      });

      it('never recycles after a failed durable checkpoint', async () => {
        let launchCount = 0;
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            launchCount++;
            opts.onProfileStarted?.('prof-' + launchCount);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: 'prof-' + launchCount
            };
          }),
          stop: vi.fn(async () => {})
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            await input.onTaskCheckpoint?.({
              rows: [{ key: 'task-1', title: 'Task 1', reward: 10, status: 4 }],
              receipt: {
                runId: input.runId ?? 'run-1',
                sessionAlias: input.sessionAlias ?? 's1',
                observedAt: new Date().toISOString(),
                requiredAfter: new Date().toISOString(),
                fresh: true,
                final: false,
                serverTotal: 1,
                serverDone: 1,
                complete: false
              }
            });
            return {
              authenticated: true,
              done: 1,
              total: 2,
              credits: 10,
              creditsTotal: 20,
              missing: ['task-2'],
              tasks: [],
              unsettledProofs: [],
              verification: null,
              fatalCode: 'DOM_READ_TIMEOUT',
              fatalError: 'DOM_READ_TIMEOUT'
            };
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut,
            taskProgress: {
              record: vi.fn(async () => {
                throw new AutomationTerminalError(
                  'failed',
                  { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' },
                  'DB checkpoint failure'
                );
              })
            }
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(launchCount).toBe(1); // No second launch
        expect(summary.state).toBe('failed');
        expect(summary.terminalReason?.code).toBe('TASK_CHECKPOINT_PERSISTENCE_FAILED');
      });

      it('never replays an unsettled same-run action', async () => {
        let launchCount = 0;
        const actionsExecuted: string[] = [];
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            launchCount++;
            opts.onProfileStarted?.('prof-' + launchCount);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: 'prof-' + launchCount
            };
          }),
          stop: vi.fn(async () => {})
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            if (launchCount === 1) {
              actionsExecuted.push('action:A:session-1');
              return {
                authenticated: true,
                done: 0,
                total: 1,
                credits: 0,
                creditsTotal: 10,
                missing: ['task-A'],
                tasks: [{ key: 'task-A', title: 'Task A', reward: 10, status: 1 }],
                unsettledProofs: [{ key: 'task-A', proof: { actionKey: 'task-A', opId: 'op-1', errNo: 0, errTips: '', at: 100 } }],
                verification: null,
                fatalCode: 'DOM_READ_TIMEOUT',
                fatalError: 'DOM_READ_TIMEOUT'
              };
            } else {
              // Replacement session receives unsettledProofs and must NOT re-execute action A
              if (!input.unsettledProofs || !input.unsettledProofs.some((p) => p.key === 'task-A')) {
                actionsExecuted.push('action:A:session-2-replayed');
              }
              return {
                authenticated: true,
                done: 1,
                total: 1,
                credits: 10,
                creditsTotal: 10,
                missing: [],
                tasks: [{ key: 'task-A', title: 'Task A', reward: 10, status: 4 }],
                unsettledProofs: [],
                verification: {
                  runId: input.runId ?? 'run-1',
                  sessionAlias: input.sessionAlias ?? 's2',
                  observedAt: new Date().toISOString(),
                  requiredAfter: new Date().toISOString(),
                  fresh: true,
                  final: true,
                  serverTotal: 1,
                  serverDone: 1,
                  complete: true
                }
              };
            }
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(summary.state).toBe('completed');
        expect(launchCount).toBe(2);
        expect(actionsExecuted).toEqual(['action:A:session-1']);
      });

      it('never acquires another mailbox during session recovery', async () => {
        let launchCount = 0;
        let acquiredMailboxes = 0;

        const customWorkSources: AutomationWorkSourceFactory = {
          create: () => ({
            kind: 'finite',
            prepare: async () => ({ workerTarget: 1 }),
            next: async () => {
              if (acquiredMailboxes > 0) return null;
              acquiredMailboxes++;
              return {
                kind: 'new',
                sourceId: 'src-1',
                email: 'user1@example.com',
                emailProvider: 'manual'
              };
            },
            commit: () => {},
            release: () => {}
          })
        };

        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            launchCount++;
            opts.onProfileStarted?.('prof-' + launchCount);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: 'prof-' + launchCount
            };
          }),
          stop: vi.fn(async () => {})
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            if (launchCount === 1) {
              return {
                authenticated: true,
                done: 0,
                total: 1,
                credits: 0,
                creditsTotal: 10,
                missing: ['task-1'],
                tasks: [],
                unsettledProofs: [],
                verification: null,
                fatalCode: 'DOM_READ_TIMEOUT',
                fatalError: 'DOM_READ_TIMEOUT'
              };
            } else {
              return {
                authenticated: true,
                done: 1,
                total: 1,
                credits: 10,
                creditsTotal: 10,
                missing: [],
                tasks: [],
                unsettledProofs: [],
                verification: {
                  runId: input.runId ?? 'run-1',
                  sessionAlias: input.sessionAlias ?? 's2',
                  observedAt: new Date().toISOString(),
                  requiredAfter: new Date().toISOString(),
                  fresh: true,
                  final: true,
                  serverTotal: 1,
                  serverDone: 1,
                  complete: true
                }
              };
            }
          }
        };

        const service = new AutomationRunService(
          {
            workSources: customWorkSources,
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(summary.state).toBe('completed');
        expect(launchCount).toBe(2);
        expect(acquiredMailboxes).toBe(1); // Only 1 mailbox acquisition
      });

      it('counts one terminal outcome per accepted account under Stop races', async () => {
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            const id = 'prof-' + ((fakeLauncher.launch as ReturnType<typeof vi.fn>).mock.calls.length);
            opts.onProfileStarted?.(id);
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: id
            };
          }),
          stop: vi.fn(async () => {})
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            if (input.accountId === 'acc-1') {
              return {
                authenticated: true,
                done: 1,
                total: 1,
                credits: 10,
                creditsTotal: 10,
                missing: [],
                tasks: [],
                unsettledProofs: [],
                verification: {
                  runId: input.runId ?? 'run-1',
                  sessionAlias: input.sessionAlias ?? 's1',
                  observedAt: new Date().toISOString(),
                  requiredAfter: new Date().toISOString(),
                  fresh: true,
                  final: true,
                  serverTotal: 1,
                  serverDone: 1,
                  complete: true
                }
              };
            } else {
              await new Promise<void>((_, reject) => {
                if (input.signal.aborted) {
                  reject(input.signal.reason);
                  return;
                }
                input.signal.addEventListener('abort', () => reject(input.signal.reason));
              });
              return {
                authenticated: true,
                done: 0,
                total: 1,
                credits: 0,
                creditsTotal: 0,
                missing: [],
                tasks: [],
                unsettledProofs: [],
                verification: null
              };
            }
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1', 'u2@example.com|p2', 'u3@example.com|p3']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 3, testDurationMs: 600_000 }));
        await service.waitUntilRunning();

        await service.stopThread('acc-2');
        await service.stop();
        const summary = await service.waitForCompletion();

        expect(summary.accountsCompleted + summary.accountsFailed + summary.accountsStopped).toBe(summary.accountsAccepted);
        expect(summary.accountsAccepted).toBe(3);
        expect(summary.accountsCompleted).toBe(1);
      });

      it('fails the run when any cleanup remains uncertain', async () => {
        const fakeLauncher: BrowserLauncher = {
          name: 'api-v3',
          launch: vi.fn(async (opts) => {
            opts.onProfileStarted?.('p-clean-fail');
            return {
              page: {} as unknown as LaunchedProfile['page'],
              context: {} as unknown as LaunchedProfile['context'],
              port: 9222,
              profileId: 'p-clean-fail'
            };
          }),
          stop: vi.fn(async () => {
            throw new Error('Profile teardown crashed unexpectedly');
          })
        };

        const customCapcut: CapcutTaskRunner = {
          runAccount: async (input) => {
            return {
              authenticated: true,
              done: 1,
              total: 1,
              credits: 10,
              creditsTotal: 10,
              missing: [],
              tasks: [],
              unsettledProofs: [],
              verification: {
                runId: input.runId ?? 'run-1',
                sessionAlias: input.sessionAlias ?? 's1',
                observedAt: new Date().toISOString(),
                requiredAfter: new Date().toISOString(),
                fresh: true,
                final: true,
                serverTotal: 1,
                serverDone: 1,
                complete: true
              }
            };
          }
        };

        const service = new AutomationRunService(
          {
            workSources: createStubFactory(['u1@example.com|p1']),
            emailOtp: { readOtp: async () => '123456' },
            proxies: proxySource,
            browser,
            accounts,
            logBus,
            launcher: () => fakeLauncher,
            capcut: customCapcut
          },
          {
            sleep: async () => {},
            nextId: () => 'run-1'
          }
        );

        await service.start(baseConfig({ threadCount: 1, testDurationMs: 600_000 }));
        const summary = await service.waitForCompletion();

        expect(summary.state).toBe('failed');
        expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
        expect((service as unknown as { cleanupFailures: number }).cleanupFailures).toBeGreaterThan(0);
      });
    });
  });

  describe('Task 11: Non-purchasing existing-account resume source', () => {
    it('does not create or commit an account row for an existing work item', async () => {
      let commitCalled = false;
      const customWorkSources: AutomationWorkSourceFactory = {
        create: () => {
          let delivered = false;
          return {
            kind: 'finite',
            prepare: async () => ({ workerTarget: 1 }),
            next: async () => {
              if (delivered) return null;
              delivered = true;
              return {
                kind: 'existing',
                sourceId: 'existing:acc-existing-1',
                accountId: 'acc-existing-1',
                email: 'existing@example.com',
                emailProvider: 'manual',
                capcutPassword: 'existingPass123'
              };
            },
            commit: () => { commitCalled = true; },
            release: () => {}
          };
        }
      };

      const fakeLauncher: BrowserLauncher = {
        name: 'api-v3',
        launch: vi.fn(async (opts) => {
          opts.onProfileStarted?.('prof-existing');
          return {
            page: {} as unknown as LaunchedProfile['page'],
            context: {} as unknown as LaunchedProfile['context'],
            port: 9222,
            profileId: 'prof-existing'
          };
        }),
        stop: vi.fn(async () => {})
      };

      const customCapcut: CapcutTaskRunner = {
        runAccount: async (input) => ({
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: [],
          unsettledProofs: [],
          verification: {
            runId: input.runId ?? 'run-1',
            sessionAlias: input.sessionAlias ?? 's1',
            observedAt: new Date().toISOString(),
            requiredAfter: new Date().toISOString(),
            fresh: true,
            final: true,
            serverTotal: 1,
            serverDone: 1,
            complete: true
          }
        })
      };

      const service = new AutomationRunService(
        {
          workSources: customWorkSources,
          emailOtp: { readOtp: async () => '123456' },
          proxies: proxySource,
          browser,
          accounts,
          logBus,
          launcher: () => fakeLauncher,
          capcut: customCapcut
        },
        {
          sleep: async () => {},
          nextId: () => 'run-1'
        }
      );

      await service.start(baseConfig({ threadCount: 1 }));
      const summary = await service.waitForCompletion();

      expect(summary.state).toBe('completed');
      expect(accounts.created.length).toBe(0);
      expect(commitCalled).toBe(false);
      expect(accounts.updates.some((u) => u.id === 'acc-existing-1')).toBe(true);
    });

    it('uses existing-only auth from the first session', async () => {
      let firstRunAccountInput: Parameters<CapcutTaskRunner['runAccount']>[0] | null = null;
      const customWorkSources: AutomationWorkSourceFactory = {
        create: () => {
          let delivered = false;
          return {
            kind: 'finite',
            prepare: async () => ({ workerTarget: 1 }),
            next: async () => {
              if (delivered) return null;
              delivered = true;
              return {
                kind: 'existing',
                sourceId: 'existing:acc-existing-2',
                accountId: 'acc-existing-2',
                email: 'existing2@example.com',
                emailProvider: 'manual',
                capcutPassword: 'existingPass456'
              };
            },
            commit: () => {},
            release: () => {}
          };
        }
      };

      const fakeLauncher: BrowserLauncher = {
        name: 'api-v3',
        launch: vi.fn(async (opts) => {
          opts.onProfileStarted?.('prof-existing-2');
          return {
            page: {} as unknown as LaunchedProfile['page'],
            context: {} as unknown as LaunchedProfile['context'],
            port: 9222,
            profileId: 'prof-existing-2'
          };
        }),
        stop: vi.fn(async () => {})
      };

      const customCapcut: CapcutTaskRunner = {
        runAccount: async (input) => {
          if (!firstRunAccountInput) {
            firstRunAccountInput = input;
          }
          return {
            authenticated: true,
            done: 1,
            total: 1,
            credits: 10,
            creditsTotal: 10,
            missing: [],
            tasks: [],
            unsettledProofs: [],
            verification: {
              runId: input.runId ?? 'run-1',
              sessionAlias: input.sessionAlias ?? 's1',
              observedAt: new Date().toISOString(),
              requiredAfter: new Date().toISOString(),
              fresh: true,
              final: true,
              serverTotal: 1,
              serverDone: 1,
              complete: true
            }
          };
        }
      };

      const service = new AutomationRunService(
        {
          workSources: customWorkSources,
          emailOtp: { readOtp: async () => '123456' },
          proxies: proxySource,
          browser,
          accounts,
          logBus,
          launcher: () => fakeLauncher,
          capcut: customCapcut
        },
        {
          sleep: async () => {},
          nextId: () => 'run-1'
        }
      );

      await service.start(baseConfig({ threadCount: 1 }));
      await service.waitForCompletion();

      expect(firstRunAccountInput).not.toBeNull();
      const input = firstRunAccountInput!;
      expect(input.authAttempt).toBe('existing-only');
      expect(input.isNewAccount).toBe(false);
      expect(input.getOtp).toBeUndefined();
    });
  });
});


