import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { ProxyLeaseRepository } from '../../repositories/ProxyLeaseRepository';
import { ProxyLeaseManager, type IKiotProxyLeaseApi } from '../ProxyLeaseManager';
import { ProxyKeyUnavailableError, type KiotProxyKeySummary, type KiotProxyLease } from '../../providers/KiotProxyProvider';
import { AutomationRunService, type IAccountSink, type IBrowserRuntimeApi, type StartedProfile } from '../AutomationRunService';
import { LogBus, type ILogSink } from '../LogBus';
import { AutomationRunConfigSchema } from '../../../shared/schemas/automation.schema';
import type { AutomationWorkItem, AutomationWorkSourceFactory } from '../AutomationWorkSource';

/**
 * Queueing verified through the REAL ProxyLeaseManager and a real SQLite lease
 * table, not a stubbed proxy source: more threads than keys must still all run,
 * one at a time per key, with no thread starved and every lease released.
 */
class StubKiotApi implements IKiotProxyLeaseApi {
  public released: string[] = [];
  public getNewCalls: string[] = [];
  private readonly currentIp = new Map<string, string>();
  private counter = 0;

  constructor(private readonly keys: string[]) {}

  async listKeys(): Promise<KiotProxyKeySummary[]> {
    return this.keys.map((keyValue, index) => ({ id: index + 1, keyValue, expiredAt: null }));
  }

  async getCurrentProxy(keyValue: string): Promise<KiotProxyLease> {
    const ip = this.currentIp.get(keyValue);
    if (!ip) throw new ProxyKeyUnavailableError('key chưa được gán IP');
    return this.toLease(keyValue, ip);
  }

  async getNewProxy(keyValue: string): Promise<KiotProxyLease> {
    this.getNewCalls.push(keyValue);
    this.counter += 1;
    const ip = '10.1.0.' + this.counter;
    this.currentIp.set(keyValue, ip);
    return this.toLease(keyValue, ip);
  }

  async releaseKey(keyValue: string): Promise<void> {
    this.released.push(keyValue);
  }

  private toLease(keyValue: string, ip: string): KiotProxyLease {
    return {
      keyValue, ip, host: ip, port: 20000,
      protocol: 'http', username: null, password: null, nextChangeSeconds: 60
    };
  }
}

const stubWorkSources: AutomationWorkSourceFactory = {
  create: (config) => {
    const items: AutomationWorkItem[] = config.emailSource.mode === 'manual'
      ? config.emailSource.entries.map((entry, i) => {
          const [email, password] = entry.split('|');
          return {
            sourceId: 'man-' + (i + 1),
            email,
            emailPassword: password,
            emailProvider: 'manual'
          };
        })
      : [];
    return {
      kind: 'finite',
      prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
      next: async () => items.shift() ?? null,
      commit: () => {},
      release: () => {}
    };
  }
};

class StubAccounts implements IAccountSink {
  public created = 0;
  public doneIds: string[] = [];
  create(): { id: string } {
    this.created += 1;
    return { id: 'acc-' + this.created };
  }
  update(id: string, data: { status?: string }): { success: boolean } {
    if (data.status === 'done') this.doneIds.push(id);
    return { success: true };
  }
}

class CollectingSink implements ILogSink {
  insertBatch(): void {}
}

let tmpDir: string;
let db: Database.Database;
let leaseRepo: ProxyLeaseRepository;
let now: number;
let leaseIds: number;

/** Records how many leases were live at each browser launch. */
class PeakTrackingBrowser implements IBrowserRuntimeApi {
  public startCalls = 0;
  public stopped: string[] = [];
  public peakActiveLeases = 0;

  async startProfile(): Promise<StartedProfile> {
    this.startCalls += 1;
    this.peakActiveLeases = Math.max(this.peakActiveLeases, leaseRepo.listActive().length);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { profileId: 'profile-' + this.startCalls, port: 50000 + this.startCalls, browserType: 'mimic' };
  }

  async stopProfile(profileId: string): Promise<void> {
    this.stopped.push(profileId);
  }
}

function manualConfig(threadCount: number, emailCount: number = threadCount) {
  return AutomationRunConfigSchema.parse({
    threadCount,
    browser: 'multilogin',
    headless: false,
    retryCount: 0,
    stepDelayMinMs: 0,
    stepDelayMaxMs: 0,
    typeDelayMinMs: 0,
    typeDelayMaxMs: 0,
    module: 'credit',
    skipWithoutTrial: false,
    emailSource: {
      mode: 'manual',
      entries: Array.from({ length: emailCount }, (_unused, i) => 'w' + (i + 1) + '@x.com|p')
    },
    proxy: { mode: 'proxykey' },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    testDurationMs: 0
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-queue-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  leaseRepo = new ProxyLeaseRepository(db);
  now = 1_000_000;
  leaseIds = 0;
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildStack(keys: string[]) {
  const api = new StubKiotApi(keys);
  const proxies = new ProxyLeaseManager(
    api,
    leaseRepo,
    { apiToken: 'TOKEN', waitIntervalMs: 10, acquireTimeoutMs: 5_000, keyCooldownMs: 5 },
    {
      now: () => now,
      sleep: async (ms: number) => { now += ms; },
      nextId: () => 'lease-' + ++leaseIds
    }
  );
  const browser = new PeakTrackingBrowser();
  const accounts = new StubAccounts();
  const service = new AutomationRunService(
    {
      workSources: stubWorkSources,
      emailOtp: { readOtp: async () => null },
      proxies,
      browser,
      accounts,
      logBus: new LogBus(new CollectingSink())
    },
    { sleep: async () => {}, nextId: () => 'run-1' }
  );
  return { api, proxies, browser, accounts, service };
}

describe('xếp hàng chờ khi số luồng vượt số proxy key', () => {
  it('chạy hết 5 luồng với 2 key, không luồng nào bị bỏ rơi', async () => {
    const { service, browser } = buildStack(['K1', 'K2']);

    await service.start(manualConfig(2, 5));
    const summary = await service.waitForCompletion();

    expect(browser.startCalls).toBe(5);
    expect(summary.workerTarget).toBe(2);
    expect(summary.accountsAccepted).toBe(5);
    expect(summary.accountsFailed).toBe(0);
    expect(summary.state).toBe('completed');
  });

  it('không bao giờ giữ nhiều lease hơn số key', async () => {
    const { service, browser } = buildStack(['K1', 'K2']);

    await service.start(manualConfig(2, 6));
    await service.waitForCompletion();

    expect(browser.peakActiveLeases).toBeLessThanOrEqual(2);
  });

  it('với đúng 1 key thì các luồng chạy lần lượt', async () => {
    const { service, browser } = buildStack(['K1']);

    await service.start(manualConfig(1, 4));
    await service.waitForCompletion();

    expect(browser.startCalls).toBe(4);
    expect(browser.peakActiveLeases).toBe(1);
  });

  it('mỗi luồng nhận một IP riêng và mọi lease đều được nhả', async () => {
    const { service, api } = buildStack(['K1', 'K2']);

    await service.start(manualConfig(2, 5));
    await service.waitForCompletion();

    const ips = leaseRepo.activeIps();
    expect(ips).toEqual([]);
    expect(leaseRepo.listActive()).toHaveLength(0);
    expect(api.getNewCalls.length).toBeGreaterThanOrEqual(5);
    expect(api.released.length).toBeGreaterThanOrEqual(5);
  });

  it('không có hai luồng nào dùng trùng IP', async () => {
    const { service } = buildStack(['K1', 'K2', 'K3']);

    await service.start(manualConfig(3, 6));
    await service.waitForCompletion();

    const rows = db.prepare('SELECT ip FROM proxy_leases').all() as Array<{ ip: string }>;
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.ip)).size).toBe(6);
  });

  it('đánh dấu xong cho đủ 5 tài khoản', async () => {
    const { service, accounts } = buildStack(['K1', 'K2']);

    await service.start(manualConfig(2, 5));
    await service.waitForCompletion();

    expect(accounts.created).toBe(5);
    expect(new Set(accounts.doneIds).size).toBe(5);
  });

  it('dừng phiên thì các luồng còn trong hàng đợi không khởi chạy', async () => {
    const { service, browser } = buildStack(['K1']);

    await service.start(manualConfig(1, 5));
    await service.waitUntilRunning();
    await service.stop();
    const summary = await service.waitForCompletion();

    expect(browser.startCalls).toBeLessThan(5);
    expect(summary.state).toBe('stopped');
    expect(leaseRepo.listActive()).toHaveLength(0);
  });
});
