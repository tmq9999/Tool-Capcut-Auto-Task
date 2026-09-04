import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IEmailSourceApi,
  type IProxyLeaseSource,
  type StartedProfile
} from '../AutomationRunService';
import { LogBus, type ILogSink } from '../LogBus';
import { ProviderError } from '../../providers/ProviderError';
import { AutomationRunConfigSchema, type AutomationRunConfigDTO, type AutomationRunProgressDTO } from '../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';
import type { EmailPurchaseResult } from '../EmailPurchaseService';
import type { PurchasedEmailDTO } from '../../../shared/schemas/provider.schema';

class CollectingSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void { this.rows.push(...logs); }
}

function purchasedRow(index: number, provider: 'gmail94' | 'customdomain' = 'gmail94'): PurchasedEmailDTO {
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

class StubEmailSource implements IEmailSourceApi {
  public purchaseCalls: Array<{ provider: string; count: number }> = [];
  public consumed: Array<{ id: string; accountId: string | null }> = [];
  public released: string[] = [];
  public available = 0;
  public failures: string[] = [];

  async purchase(provider: string, count: number): Promise<EmailPurchaseResult> {
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
  public failAtCall = Number.POSITIVE_INFINITY;
  private counter = 0;

  async startProfile(params: { headless: boolean; proxy?: { host: string } }): Promise<StartedProfile> {
    this.counter += 1;
    if (this.counter === this.failAtCall) throw new Error('launcher refused');
    this.startCalls.push({ headless: params.headless, proxyHost: params.proxy?.host });
    return { profileId: 'profile-' + this.counter, port: 50000 + this.counter, browserType: 'mimic' };
  }

  async stopProfile(profileId: string): Promise<void> {
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
    module: 'trial',
    skipWithoutTrial: false,
    emailSource: { mode: 'api', provider: 'gmail94', service: 'facebook' },
    proxy: { mode: 'proxykey' },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    ...overrides
  });
}

function createService(): AutomationRunService {
  const service = new AutomationRunService(
    { emails: emailSource, proxies: proxySource, browser, accounts, logBus },
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

    expect(summary.threadsStarted).toBe(2);
    expect(summary.threadsFailed).toBe(1);
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

  it('runs with fewer threads when the vendor supplied fewer mailboxes', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 3 }));
    const summary = await service.waitForCompletion();

    expect(summary.threadTotal).toBe(1);
    expect(browser.startCalls).toHaveLength(1);
  });

  it('reports a proxy shortage as a failed thread rather than a crashed run', async () => {
    emailSource.available = 1;
    proxySource.failOnAcquire = new ProviderError('CONFIG_ERROR', 'không có key rảnh', 'kiotproxy');
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    const summary = await service.waitForCompletion();

    expect(summary.threadsFailed).toBe(1);
    expect(browser.startCalls).toHaveLength(0);
    expect(summary.state).toBe('stopped');
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
    expect(accounts.created.map((row) => row.email)).toEqual(['a@x.com', 'b@x.com']);
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
    }))).rejects.toMatchObject({ code: 'CONFIG_ERROR' });

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
    return new AutomationRunService(
      {
        emails: emailSource,
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
  it('publishes the full state sequence for a completed run', async () => {
    emailSource.available = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 1 }));
    await service.waitForCompletion();

    const transitions = progressEvents
      .map((event) => event.state)
      .filter((state, index, all) => state !== all[index - 1]);
    expect(transitions).toEqual(['preparing', 'running', 'stopping', 'stopped']);
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
});

describe('AutomationRunService.stopThread', () => {
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

    const doneUpdates = accounts.updates.filter((entry) => entry.data.status === 'done');
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

    expect(service.getProgress().threadsStopped).toBe(1);
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
    emailSource.available = 5;
    proxySource.keyCount = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 5 }));
    const summary = await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBeLessThanOrEqual(2);
    expect(summary.threadsFailed).toBe(0);
  });

  it('queues the extra threads and eventually runs every one of them', async () => {
    emailSource.available = 5;
    proxySource.keyCount = 2;
    const service = createService();

    await service.start(baseConfig({ threadCount: 5 }));
    const summary = await service.waitForCompletion();

    // Queued threads must actually run, not time out waiting for a key.
    expect(browser.startCalls).toHaveLength(5);
    expect(summary.threadsStarted).toBe(5);
    expect(summary.threadsStopped).toBe(5);
    expect(summary.state).toBe('stopped');
  });

  it('releases each key as its thread finishes so the queue can advance', async () => {
    emailSource.available = 4;
    proxySource.keyCount = 1;
    const service = createService();

    await service.start(baseConfig({ threadCount: 4 }));
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
    emailSource.available = 5;
    const service = createService();

    await service.start(baseConfig({
      threadCount: 5,
      proxy: { mode: 'proxykey', keys: ['K1', 'K2'] }
    }));
    const summary = await service.waitForCompletion();

    expect(proxySource.peakConcurrent).toBeLessThanOrEqual(2);
    expect(browser.startCalls).toHaveLength(5);
    expect(summary.threadsFailed).toBe(0);
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
