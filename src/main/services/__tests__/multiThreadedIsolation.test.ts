import { describe, it, expect } from 'vitest';
import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IProxyLeaseSource,
  type CapcutTaskRunner,
  type StartedProfile
} from '../AutomationRunService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
import { LogBus, type ILogSink } from '../LogBus';
import {
  AutomationRunConfigSchema,
  type AutomationRunConfigDTO
} from '../../../shared/schemas/automation.schema';
import { AutomationTerminalError } from '../AutomationTerminalError';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  SourceReadiness,
  WorkSourceKind
} from '../AutomationWorkSource';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';

class MemoryLogSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void {
    this.rows.push(...logs);
  }
}

class TestAccounts implements IAccountSink {
  public created: Array<{ id: string; email: string }> = [];
  public updated: Array<{ id: string; updates: Record<string, unknown> }> = [];
  private counter = 0;

  create(data: { email: string; emailProvider?: string }): { id: string } {
    const id = 'acc-' + (++this.counter);
    this.created.push({ id, email: data.email });
    return { id };
  }

  update(id: string, updates: Record<string, unknown>): { success: boolean } {
    this.updated.push({ id, updates });
    return { success: true };
  }

  findByEmail(): [] {
    return [];
  }
}

class TestBrowserRuntime implements IBrowserRuntimeApi {
  public started: string[] = [];
  public stopped: string[] = [];
  private counter = 0;

  async startProfile(): Promise<StartedProfile> {
    const profileId = 'prof-' + (++this.counter);
    this.started.push(profileId);
    return { profileId, port: 9000 + this.counter, browserType: 'chrome' };
  }

  async stopProfile(profileId: string): Promise<void> {
    this.stopped.push(profileId);
  }
}

class TestProxySource implements IProxyLeaseSource {
  async acquire(): Promise<AcquiredProxyLease> {
    return {
      leaseId: 'l1',
      keyValue: 'k1',
      host: '127.0.0.1',
      ip: '127.0.0.1',
      port: 8080,
      protocol: 'http',
      username: null,
      password: null,
      nextChangeSeconds: null
    };
  }
  async release(): Promise<void> {}
  async releaseAll(): Promise<void> {}
}

class MockWorkSource implements AutomationWorkSource {
  readonly kind: WorkSourceKind;
  private queue: AutomationWorkItem[];
  public nextCalls = 0;
  public terminalError?: Error;
  private readonly limit: number;
  private acquired = 0;

  constructor(kind: WorkSourceKind, items: AutomationWorkItem[], limit = 0) {
    this.kind = kind;
    this.queue = [...items];
    this.limit = limit;
  }

  async prepare(workerTarget: number): Promise<SourceReadiness> {
    const target = this.limit > 0 ? Math.min(workerTarget, this.limit) : workerTarget;
    return { workerTarget: target };
  }

  async next(_workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null> {
    this.nextCalls += 1;
    if (signal.aborted) throw signal.reason ?? new Error('Aborted');
    if (this.terminalError) {
      throw this.terminalError;
    }
    if (this.limit > 0 && this.acquired >= this.limit) {
      return null;
    }
    const item = this.queue.shift();
    if (item) {
      this.acquired += 1;
      return item;
    }
    if (this.kind === 'finite') return null;
    return null;
  }

  commit(): void {}
  release(): void {}
  bind(): void {}
  purchaseStats() {
    return { attempted: 0, confirmed: 0, ambiguous: 0, budget: 0 };
  }
}

function makeItems(count: number): AutomationWorkItem[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'new',
    sourceId: 'item-' + (i + 1),
    email: 'user' + (i + 1) + '@gmail.com',
    emailProvider: 'gmail94',
    purchasedEmailId: 'p-' + (i + 1)
  }));
}

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
    emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' },
    proxy: { mode: 'direct', entries: [] },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    ...overrides,
    maxBillablePurchases: (overrides.emailSource?.mode ?? 'api') === 'api' ? (overrides.maxBillablePurchases ?? 20) : 0
  });
}

async function waitFor(predicate: () => boolean, desc: string, maxMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out waiting for: ' + desc);
}

describe('Multi-threaded Fast Worker Renew and Isolation', () => {
  it('each concurrent worker receives an isolated proxy, profile, and email without collisions', async () => {
    const items = makeItems(4);
    const workSource = new MockWorkSource('finite', items);
    const accounts = new TestAccounts();
    const browser = new TestBrowserRuntime();
    const logBus = new LogBus(new MemoryLogSink(), { maxBatchSize: 100 });

    const directProxies = [
      'http://10.0.0.1:8081',
      'http://10.0.0.2:8082',
      'http://10.0.0.3:8083',
      'http://10.0.0.4:8084'
    ];

    const launches: Array<{ profileId: string; proxy: string }> = [];
    const recordedAssignments: Array<{ proxy: string; profileId: string; email: string }> = [];

    let resolveWorker1Hold: () => void;
    const worker1Hold = new Promise<void>((r) => {
      resolveWorker1Hold = r;
    });

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const started = await browser.startProfile();
        options.onProfileStarted?.(started.profileId);
        const proxyStr = options.proxy ? `${options.proxy.host}:${options.proxy.port}` : 'none';
        launches.push({ profileId: started.profileId, proxy: proxyStr });
        return {
          profileId: started.profileId,
          port: started.port ?? 0,
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context']
        };
      },
      stop: (id) => browser.stopProfile(id)
    };

    let callCount = 0;
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        callCount += 1;
        const currentCall = callCount;
        const currentEmail = input.email;

        const running = service.getRunningThreads().find((t) => t.email === currentEmail);
        const currentProfile = running?.profileId ?? '';
        const launch = launches.find((l) => l.profileId === currentProfile);
        const proxyStr = launch?.proxy ?? 'none';

        recordedAssignments.push({
          proxy: proxyStr,
          profileId: currentProfile,
          email: currentEmail
        });

        // Worker 1 holds to let Worker 2 also be launched concurrently
        if (currentCall === 1) {
          await worker1Hold;
        }

        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: [{ key: 'capcut_web_newbie_register', title: 'Register', reward: 10, status: 4 }],
          unsettledProofs: [],
          verification: {
            runId: input.runId ?? 'r1',
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

    const service = new AutomationRunService({
      workSources: { create: () => workSource },
      emailOtp: { readOtp: async () => '123456' },
      proxies: new TestProxySource(),
      browser,
      accounts,
      logBus,
      launcher: () => launcher,
      capcut
    });

    const config = baseConfig({
      threadCount: 2,
      proxy: { mode: 'direct', entries: directProxies }
    });

    await service.start(config);

    // Wait until both workers have started their first account concurrently
    await waitFor(
      () => recordedAssignments.length >= 2,
      'two concurrent workers active'
    );

    // Verify worker-1 and worker-2 have DIFFERENT proxies, DIFFERENT profiles, and DIFFERENT emails
    const firstTwo = recordedAssignments.slice(0, 2);
    expect(firstTwo[0].proxy).not.toEqual(firstTwo[1].proxy);
    expect(firstTwo[0].profileId).not.toEqual(firstTwo[1].profileId);
    expect(firstTwo[0].email).not.toEqual(firstTwo[1].email);

    // Release worker 1 hold to let both complete and renew
    resolveWorker1Hold!();

    await service.waitForCompletion();

    // Verify all 4 items processed
    expect(recordedAssignments.length).toBe(4);

    // All 4 profiles used were cleanly stopped
    expect(browser.stopped.length).toBe(4);
  });

  it('worker that finishes early renews immediately with a fresh proxy, profile, and email', async () => {
    const items = makeItems(3);
    const workSource = new MockWorkSource('finite', items);
    const accounts = new TestAccounts();
    const browser = new TestBrowserRuntime();
    const logBus = new LogBus(new MemoryLogSink(), { maxBatchSize: 100 });

    const directProxies = [
      'http://10.0.0.1:8081',
      'http://10.0.0.2:8082',
      'http://10.0.0.3:8083'
    ];

    const timeline: Array<{ email: string; event: string; proxy: string; time: number }> = [];
    const launches: Array<{ profileId: string; proxy: string }> = [];
    const startTime = Date.now();

    let resolveSlowWorker: () => void;
    const slowWorkerPromise = new Promise<void>((r) => {
      resolveSlowWorker = r;
    });

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const started = await browser.startProfile();
        options.onProfileStarted?.(started.profileId);
        const proxyStr = options.proxy ? `${options.proxy.host}:${options.proxy.port}` : 'none';
        launches.push({ profileId: started.profileId, proxy: proxyStr });
        return {
          profileId: started.profileId,
          port: started.port ?? 0,
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context']
        };
      },
      stop: (id) => browser.stopProfile(id)
    };

    let callCount = 0;
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        callCount += 1;
        const currentCall = callCount;
        const email = input.email;
        const running = service.getRunningThreads().find((t) => t.email === email);
        const currentProfile = running?.profileId ?? '';
        const launch = launches.find((l) => l.profileId === currentProfile);
        const proxy = launch?.proxy ?? '';

        timeline.push({ email, event: 'start', proxy, time: Date.now() - startTime });

        if (currentCall === 2) {
          // Worker 2 (call 2) is slow
          await slowWorkerPromise;
        } else {
          // Worker 1 (call 1 and 3) is fast
          await new Promise((r) => setTimeout(r, 20));
        }

        timeline.push({ email, event: 'finish', proxy, time: Date.now() - startTime });

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
            runId: input.runId ?? 'r1',
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

    const service = new AutomationRunService({
      workSources: { create: () => workSource },
      emailOtp: { readOtp: async () => '123456' },
      proxies: new TestProxySource(),
      browser,
      accounts,
      logBus,
      launcher: () => launcher,
      capcut
    });

    const config = baseConfig({
      threadCount: 2,
      proxy: { mode: 'direct', entries: directProxies }
    });

    await service.start(config);

    // Wait until fast worker has started call 3 (renewed) while call 2 is STILL running!
    await waitFor(
      () => timeline.filter((t) => t.event === 'start').length >= 3,
      'fast worker renewed and started 3rd account before slow worker finished'
    );

    // Verify call 2 has NOT finished yet
    const call2Finished = timeline.some((t) => t.email === items[1].email && t.event === 'finish');
    expect(call2Finished).toBe(false);

    // Now release slow worker
    resolveSlowWorker!();

    await service.waitForCompletion();

    // Check that all 3 accounts completed
    expect(timeline.filter((t) => t.event === 'finish').length).toBe(3);
  });

  it('stops all workers safely when INSUFFICIENT_FUNDS is encountered', async () => {
    const items = makeItems(10);
    const workSource = new MockWorkSource('continuous', items);
    const accounts = new TestAccounts();
    const browser = new TestBrowserRuntime();
    const logBus = new LogBus(new MemoryLogSink(), { maxBatchSize: 100 });

    const directProxies = [
      'http://10.0.0.1:8081',
      'http://10.0.0.2:8082'
    ];

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const started = await browser.startProfile();
        options.onProfileStarted?.(started.profileId);
        return {
          profileId: started.profileId,
          port: started.port ?? 0,
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context']
        };
      },
      stop: (id) => browser.stopProfile(id)
    };

    let accountsStarted = 0;
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        accountsStarted += 1;
        // Trigger INSUFFICIENT_FUNDS on work source next calls
        workSource.terminalError = new AutomationTerminalError('blocked', {
          code: 'INSUFFICIENT_FUNDS',
          provider: 'gmail94'
        }, 'Số dư tài khoản Gmail94 không đủ.');

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
            runId: input.runId ?? 'r1',
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

    const service = new AutomationRunService({
      workSources: { create: () => workSource },
      emailOtp: { readOtp: async () => '123456' },
      proxies: new TestProxySource(),
      browser,
      accounts,
      logBus,
      launcher: () => launcher,
      capcut
    });

    const config = baseConfig({
      threadCount: 2,
      proxy: { mode: 'direct', entries: directProxies }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('blocked');
    expect(summary.terminalReason?.code).toBe('INSUFFICIENT_FUNDS');
    // Ensure all started profiles are cleaned up
    expect(browser.stopped.length).toBe(accountsStarted);
  });

  it('stops all workers cleanly when mailLimit is reached', async () => {
    const items = makeItems(10);
    const mailLimit = 3;
    const workSource = new MockWorkSource('continuous', items, mailLimit);
    const accounts = new TestAccounts();
    const browser = new TestBrowserRuntime();
    const logBus = new LogBus(new MemoryLogSink(), { maxBatchSize: 100 });

    const directProxies = [
      'http://10.0.0.1:8081',
      'http://10.0.0.2:8082'
    ];

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const started = await browser.startProfile();
        options.onProfileStarted?.(started.profileId);
        return {
          profileId: started.profileId,
          port: started.port ?? 0,
          page: {} as unknown as LaunchedProfile['page'],
          context: {} as unknown as LaunchedProfile['context']
        };
      },
      stop: (id) => browser.stopProfile(id)
    };

    const processedEmails: string[] = [];
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        processedEmails.push(input.email);
        await new Promise((r) => setTimeout(r, 15));
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: [{ key: 'capcut_web_newbie_register', title: 'Register', reward: 10, status: 4 }],
          unsettledProofs: [],
          verification: {
            runId: input.runId ?? 'r1',
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

    const service = new AutomationRunService({
      workSources: { create: () => workSource },
      emailOtp: { readOtp: async () => '123456' },
      proxies: new TestProxySource(),
      browser,
      accounts,
      logBus,
      launcher: () => launcher,
      capcut
    });

    const config = baseConfig({
      threadCount: 2,
      mailLimit,
      proxy: { mode: 'direct', entries: directProxies }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('completed');
    expect(summary.terminalReason?.code).toBe('MAIL_LIMIT_REACHED');
    expect(processedEmails.length).toBe(mailLimit);
    expect(summary.accountsCompleted).toBe(mailLimit);
    // All started profiles must be cleanly stopped
    expect(browser.stopped.length).toBe(mailLimit);
  });
});
