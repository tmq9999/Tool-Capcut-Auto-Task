import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IProxyLeaseSource,
  type StartedProfile
} from '../AutomationRunService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
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

function createService(launcher?: BrowserLauncher): AutomationRunService {
  const workSources: AutomationWorkSourceFactory = {
    create: (config) => {
      if (config.emailSource.mode === 'manual') {
        const items: AutomationWorkItem[] = config.emailSource.entries.flatMap((entry, i) => {
          const trimmed = entry.trim();
          if (!trimmed) return [];
          const [email, password] = trimmed.split('|');
          return [{
            sourceId: 'man-' + (i + 1),
            email: email.trim(),
            emailPassword: password?.trim(),
            emailProvider: 'manual'
          }];
        });
        return {
          kind: 'finite',
          prepare: async (c) => {
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
          sourceId: row.id,
          email: row.email,
          emailProvider: row.provider,
          purchasedEmailId: row.id
        };
      });

      return {
        kind: 'finite',
        prepare: async (c) => {
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
          emailSource.markConsumed(item.purchasedEmailId ?? item.sourceId, accountId);
        },
        release: (item) => {
          if (item.purchasedEmailId) {
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
      ...(launcher ? { launcher: () => launcher } : {})
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
    emailSource.available = 3;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3, headless: true }));
    await service.waitForCompletion();

    expect(browser.startCalls).toHaveLength(3);
    expect(browser.startCalls.every((call) => call.headless)).toBe(true);
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
          next: async () => ({ sourceId: 's-1', email: 'a@x.com', emailProvider: 'gmail94' }),
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
    expect(summary.state).toBe('completed');
    expect(summary.terminalReason).toMatchObject({
      code: 'MANUAL_EXHAUSTED',
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
