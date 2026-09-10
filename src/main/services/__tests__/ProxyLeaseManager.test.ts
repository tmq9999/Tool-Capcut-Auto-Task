import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { ProxyLeaseRepository } from '../../repositories/ProxyLeaseRepository';
import { ProxyLeaseManager, type IKiotProxyLeaseApi } from '../ProxyLeaseManager';
import { ProviderError } from '../../providers/ProviderError';
import { ProxyKeyUnavailableError, type KiotProxyKeySummary, type KiotProxyLease } from '../../providers/KiotProxyProvider';
import type { ObservationIdentity, ObservationScope } from '../../providers/ObservedHttpClient';

interface KeyBehaviour {
  ips: string[];
  failWith?: Error;
}

class StubProxyApi implements IKiotProxyLeaseApi {
  public released: string[] = [];
  public getNewCalls: string[] = [];
  public getCurrentCalls: string[] = [];
  private readonly currentIps = new Map<string, string>();
  private readonly behaviours = new Map<string, KeyBehaviour>();

  constructor(private readonly keys: string[]) {
    for (const key of keys) {
      this.behaviours.set(key, { ips: [] });
    }
  }

  setIps(key: string, ips: string[]): void {
    this.behaviours.set(key, { ...this.behaviours.get(key), ips });
  }

  setFailure(key: string, failWith: Error): void {
    const current = this.behaviours.get(key) ?? { ips: [] };
    this.behaviours.set(key, { ...current, failWith });
  }

  /** The IP the gateway reports for this key right now. */
  setCurrentIp(key: string, ip: string): void {
    this.currentIps.set(key, ip);
  }

  async getCurrentProxy(keyValue: string): Promise<KiotProxyLease> {
    this.getCurrentCalls.push(keyValue);
    const ip = this.currentIps.get(keyValue);
    if (!ip) throw new ProxyKeyUnavailableError('key has no current proxy');
    return {
      keyValue, ip, host: ip, port: 20001, protocol: 'http',
      username: null, password: null, nextChangeSeconds: null
    };
  }

  async listKeys(): Promise<KiotProxyKeySummary[]> {
    return this.keys.map((keyValue, index) => ({ id: index + 1, keyValue, expiredAt: null }));
  }

  async getNewProxy(keyValue: string): Promise<KiotProxyLease> {
    this.getNewCalls.push(keyValue);
    const behaviour = this.behaviours.get(keyValue);
    if (!behaviour) throw new ProxyKeyUnavailableError('unknown key');
    if (behaviour.failWith) throw behaviour.failWith;
    const ip = behaviour.ips.shift();
    if (!ip) throw new ProxyKeyUnavailableError('Chưa đến thời gian đổi IP');
    return {
      keyValue,
      ip,
      host: ip,
      port: 20001,
      protocol: 'http',
      username: 'u',
      password: 'p',
      nextChangeSeconds: 60
    };
  }

  async releaseKey(keyValue: string): Promise<void> {
    this.released.push(keyValue);
  }
}

let tmpDir: string;
let db: Database.Database;
let leaseRepo: ProxyLeaseRepository;
let now: number;
let sleepCalls: number[];
let idCounter: number;
let onSleep: (() => void) | null;

function createManager(
  api: StubProxyApi,
  overrides: { acquireTimeoutMs?: number; keyCooldownMs?: number; keys?: string[] } = {},
  observation?: ObservationScope
) {
  return new ProxyLeaseManager(
    api,
    leaseRepo,
    {
      apiToken: 'API-TOKEN',
      waitIntervalMs: 100,
      acquireTimeoutMs: overrides.acquireTimeoutMs ?? 5_000,
      keyCooldownMs: overrides.keyCooldownMs ?? 1_000,
      keys: overrides.keys
    },
    {
      now: () => now,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
        now += ms;
        const hook = onSleep;
        onSleep = null;
        if (hook) hook();
      },
      nextId: () => 'lease-' + ++idCounter,
      observation
    }
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-proxylease-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  leaseRepo = new ProxyLeaseRepository(db);
  now = 1_000_000;
  sleepCalls = [];
  idCounter = 0;
  onSleep = null;
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProxyLeaseManager.acquire', () => {
  it('classifies key discovery, current IP, and acquisition calls', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['113.161.10.5']);
    const identities: Readonly<ObservationIdentity>[] = [];
    const manager = createManager(api, {}, {
      withObservationScope: async (identity, operation) => {
        identities.push(identity);
        return operation();
      }
    });

    await manager.acquire();

    expect(identities).toEqual([
      { provider: 'kiotproxy', operation: 'proxy-list' },
      { provider: 'kiotproxy', operation: 'proxy-current' },
      { provider: 'kiotproxy', operation: 'proxy-acquire' }
    ]);
  });

  it('leases a fresh proxy from the first key and marks the IP as in use', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setIps('K1', ['113.161.10.5']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(lease.ip).toBe('113.161.10.5');
    expect(lease.keyValue).toBe('K1');
    expect(leaseRepo.isIpActive('113.161.10.5')).toBe(true);
  });

  it('skips a key whose new IP is already held by a running profile', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    leaseRepo.recordLease({ id: 'seed', keyValue: 'seed', ip: '1.1.1.1', host: '1.1.1.1', port: 1, protocol: 'http' });
    api.setIps('K1', ['1.1.1.1']);
    api.setIps('K2', ['2.2.2.2']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(lease.ip).toBe('2.2.2.2');
    expect(api.getNewCalls).toEqual(['K1', 'K2']);
  });

  it('skips a key that handed back the same IP it already had', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setCurrentIp('K1', '3.3.3.3');
    api.setIps('K1', ['3.3.3.3']);
    api.setIps('K2', ['4.4.4.4']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(api.getCurrentCalls).toContain('K1');
    expect(lease.keyValue).toBe('K2');
    expect(lease.ip).toBe('4.4.4.4');
  });

  it('accepts a rotated IP that differs from the key current IP', async () => {
    const api = new StubProxyApi(['K1']);
    api.setCurrentIp('K1', '3.3.3.3');
    api.setIps('K1', ['3.3.3.9']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(lease.ip).toBe('3.3.3.9');
  });

  it('still rotates when the gateway cannot report a current IP for the key', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['6.6.6.6']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(lease.ip).toBe('6.6.6.6');
  });

  it('moves to the next key when the current one is not ready to rotate', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setIps('K1', []);
    api.setIps('K2', ['3.3.3.3']);
    const manager = createManager(api);

    const lease = await manager.acquire();

    expect(lease.keyValue).toBe('K2');
  });

  it('never gives two concurrent callers the same key or the same IP', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setIps('K1', ['10.0.0.1']);
    api.setIps('K2', ['10.0.0.2']);
    const manager = createManager(api);

    const [first, second] = await Promise.all([manager.acquire(), manager.acquire()]);

    expect(new Set([first.ip, second.ip]).size).toBe(2);
    expect(new Set([first.keyValue, second.keyValue]).size).toBe(2);
  });
});

describe('ProxyLeaseManager waiting behaviour', () => {
  it('waits for a busy key to be released instead of reusing it', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['20.0.0.1', '20.0.0.2']);
    const manager = createManager(api);

    const held = await manager.acquire();
    // The only key is busy, so the second caller must wait. Release it from
    // inside the first wait so the hand-off is deterministic.
    let releaseError: unknown = null;
    onSleep = () => {
      void manager.release(held).catch((err: unknown) => { releaseError = err; });
    };

    const second = await manager.acquire();

    expect(releaseError).toBeNull();
    expect(sleepCalls).toEqual([100]);
    expect(second.ip).toBe('20.0.0.2');
    expect(second.keyValue).toBe('K1');
  });

  it('fails with a clear error when no key becomes free before the deadline', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['30.0.0.1']);
    const manager = createManager(api, { acquireTimeoutMs: 500 });

    await manager.acquire();

    await expect(manager.acquire()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('fails when the account has no proxy key at all', async () => {
    const api = new StubProxyApi([]);
    const manager = createManager(api, { acquireTimeoutMs: 300 });

    await expect(manager.acquire()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('propagates an authentication failure instead of cycling through keys', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setFailure('K1', new ProviderError('AUTH_ERROR', 'token invalid', 'kiotproxy'));
    api.setIps('K2', ['40.0.0.1']);
    const manager = createManager(api);

    await expect(manager.acquire()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });
});

describe('ProxyLeaseManager.release', () => {
  it('releases the lease locally and asks the gateway to drop the key', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['50.0.0.1']);
    const manager = createManager(api);

    const lease = await manager.acquire();
    await manager.release(lease);

    expect(api.released).toEqual(['K1']);
    expect(leaseRepo.listActive()).toHaveLength(0);
  });

  it('lets a released IP be leased again later', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['60.0.0.1', '60.0.0.1']);
    const manager = createManager(api, { acquireTimeoutMs: 400 });

    const first = await manager.acquire();
    await manager.release(first);
    expect(leaseRepo.isIpActive('60.0.0.1')).toBe(false);

    const second = await manager.acquire();

    expect(second.ip).toBe('60.0.0.1');
  });

  it('never hands the same IP to two profiles at once', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setIps('K1', ['80.0.0.1']);
    api.setIps('K2', ['80.0.0.1', '80.0.0.2']);
    const manager = createManager(api);

    const [first, second] = await Promise.all([manager.acquire(), manager.acquire()]);

    expect(new Set([first.ip, second.ip]).size).toBe(2);
  });

  it('releases every outstanding lease in one call', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    api.setIps('K1', ['70.0.0.1']);
    api.setIps('K2', ['70.0.0.2']);
    const manager = createManager(api);

    await manager.acquire();
    await manager.acquire();
    await manager.releaseAll();

    expect(leaseRepo.listActive()).toHaveLength(0);
    expect(api.released.sort()).toEqual(['K1', 'K2']);
  });
});

describe('ProxyLeaseManager chỉ dùng đúng danh sách key được chỉ định', () => {
  it('bỏ qua listKeys khi đã có danh sách key cụ thể', async () => {
    const api = new StubProxyApi(['K1', 'K2', 'K3']);
    api.setIps('K2', ['5.0.0.2']);
    const manager = createManager(api, { keys: ['K2'] });

    const lease = await manager.acquire();

    expect(lease.keyValue).toBe('K2');
    expect(api.getNewCalls).toEqual(['K2']);
  });

  it('không bao giờ chạm tới key ngoài danh sách, dù tài khoản có nhiều key hơn', async () => {
    const api = new StubProxyApi(['K1', 'K2', 'K3']);
    api.setIps('K1', ['6.0.0.1']);
    api.setIps('K3', ['6.0.0.3']);
    const manager = createManager(api, { keys: ['K1'], acquireTimeoutMs: 400 });

    await manager.acquire();

    // K1 đã bị chiếm, và K3 không nằm trong danh sách nên phải chờ rồi bỏ cuộc.
    await expect(manager.acquire()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(api.getNewCalls.every((key) => key === 'K1')).toBe(true);
  });

  it('số slot bằng số key được chỉ định, không phải số key của tài khoản', async () => {
    const api = new StubProxyApi(['K1', 'K2', 'K3', 'K4', 'K5']);
    const manager = createManager(api, { keys: ['K1', 'K2'] });

    await expect(manager.availableSlots()).resolves.toBe(2);
  });

  it('không có danh sách thì lấy toàn bộ key của tài khoản', async () => {
    const api = new StubProxyApi(['K1', 'K2', 'K3']);
    const manager = createManager(api);

    await expect(manager.availableSlots()).resolves.toBe(3);
  });

  it('danh sách rỗng cũng coi như dùng toàn bộ key', async () => {
    const api = new StubProxyApi(['K1', 'K2']);
    const manager = createManager(api, { keys: [] });

    await expect(manager.availableSlots()).resolves.toBe(2);
  });

  it('aborts a busy-key wait before requesting another proxy', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['20.0.0.1', '20.0.0.2']);
    const manager = createManager(api, { acquireTimeoutMs: 5_000 });
    const controller = new AbortController();
    const first = await manager.acquire();
    onSleep = () => controller.abort(new Error('stop requested'));

    await expect(manager.acquire(controller.signal)).rejects.toThrow('stop requested');
    expect(api.getNewCalls).toEqual(['K1']);
    expect(sleepCalls).toEqual([100]);
    await manager.release(first);
  });

  it('B03 ignores completed lease when the key has a successor', async () => {
    const api = new StubProxyApi(['K1']);
    api.setIps('K1', ['80.0.0.1', '80.0.0.2', '80.0.0.3']);
    const manager = createManager(api, { keys: ['K1'], acquireTimeoutMs: 200 });
    const first = await manager.acquire();
    await manager.release(first);
    const second = await manager.acquire();
    await manager.release(first);
    expect(api.released).toEqual(['K1']);
    expect(manager.activeLeaseCount()).toBe(1);
    await expect(manager.acquire()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    await manager.release(second);
  });

  describe('S06: Stop trước rotation không được xoay proxy sau đó', () => {
    it('S06-A: signal đã abort trước khi acquire -> không gọi listKeys, getCurrentProxy hay getNewProxy', async () => {
      const api = new StubProxyApi(['K1']);
      api.setIps('K1', ['10.0.0.1']);
      const manager = createManager(api, { keys: ['K1'] });

      const controller = new AbortController();
      const stopError = new Error('STOP-PRE-ACQUIRE');
      controller.abort(stopError);

      await expect(manager.acquire(controller.signal)).rejects.toThrow('STOP-PRE-ACQUIRE');
      expect(api.getCurrentCalls).toEqual([]);
      expect(api.getNewCalls).toEqual([]);
    });

    it('S06-B: abort trong khi readCurrentIp đang chờ -> reject lý do gốc, không dispatch getNewProxy kể cả khi read trả lời muộn', async () => {
      let resolveCurrent!: (val: KiotProxyLease) => void;
      const deferredCurrent = new Promise<KiotProxyLease>((resolve) => {
        resolveCurrent = resolve;
      });

      const api = new StubProxyApi(['K1']);
      api.getCurrentProxy = vi.fn().mockImplementation(() => deferredCurrent);
      api.setIps('K1', ['10.0.0.1']);

      const manager = createManager(api, { keys: ['K1'] });
      const controller = new AbortController();
      const stopError = new Error('STOP-DURING-CURRENT-IP');

      const acquirePromise = manager.acquire(controller.signal);

      // Wait a tick to ensure getCurrentProxy was called
      await new Promise((r) => setTimeout(r, 10));
      expect(api.getCurrentProxy).toHaveBeenCalledWith('K1', 'http');

      // Abort while getCurrentProxy is in flight
      controller.abort(stopError);

      await expect(acquirePromise).rejects.toThrow('STOP-DURING-CURRENT-IP');
      expect(api.getNewCalls).toEqual([]);

      // Late resolve of getCurrentProxy
      resolveCurrent({
        keyValue: 'K1',
        ip: '9.9.9.9',
        host: '9.9.9.9',
        port: 20001,
        protocol: 'http',
        username: null,
        password: null,
        nextChangeSeconds: null
      });

      await new Promise((r) => setTimeout(r, 20));

      // Assert getNewProxy was NEVER dispatched
      expect(api.getNewCalls).toEqual([]);
    });

    it('S06-C: busy key sau pre-rotation abort được giải phóng; ordinary read error vẫn fallback null và xoay proxy bình thường', async () => {
      const api = new StubProxyApi(['K1']);
      api.setIps('K1', ['10.0.0.1']);
      // Ordinary error in getCurrentProxy (not aborted)
      api.getCurrentProxy = vi.fn().mockRejectedValue(new Error('Network error'));

      const manager = createManager(api, { keys: ['K1'] });

      // First run: abort during tryKey before getNewProxy
      const controller = new AbortController();
      controller.abort(new Error('ABORTED'));

      await expect(manager.acquire(controller.signal)).rejects.toThrow('ABORTED');

      // Key K1 should NOT be stuck in busyKeys or cooldown!
      // Second run without abort should succeed and proceed with getNewProxy
      const lease = await manager.acquire();
      expect(lease).toBeDefined();
      expect(lease.ip).toBe('10.0.0.1');
      expect(api.getNewCalls).toEqual(['K1']);
      await manager.release(lease);
    });

    it('S06-D: abort sau khi getNewProxy đã dispatch -> hoàn tất 1 rotation, lease được record/owned để runtime cleanup, không xoay lần hai', async () => {
      let resolveNew!: (val: KiotProxyLease) => void;
      const deferredNew = new Promise<KiotProxyLease>((resolve) => {
        resolveNew = resolve;
      });

      const api = new StubProxyApi(['K1']);
      api.setIps('K1', ['10.0.0.1']);
      api.getNewProxy = vi.fn().mockImplementation(() => deferredNew);

      const manager = createManager(api, { keys: ['K1'] });
      const controller = new AbortController();

      const acquirePromise = manager.acquire(controller.signal);

      // Wait a tick to ensure getNewProxy was dispatched
      await new Promise((r) => setTimeout(r, 10));
      expect(api.getNewProxy).toHaveBeenCalledTimes(1);

      // Abort after getNewProxy has dispatched
      controller.abort(new Error('STOP-POST-DISPATCH'));

      // Resolve getNewProxy
      resolveNew({
        keyValue: 'K1',
        ip: '10.0.0.2',
        host: '10.0.0.2',
        port: 20001,
        protocol: 'http',
        username: null,
        password: null,
        nextChangeSeconds: 60
      });

      // Acquire returns the lease because rotation was committed
      const lease = await acquirePromise;
      expect(lease).toBeDefined();
      expect(lease.ip).toBe('10.0.0.2');
      expect(manager.activeLeaseCount()).toBe(1);
      expect(api.getNewProxy).toHaveBeenCalledTimes(1);

      // Runtime cleanup releases the lease exactly once
      await manager.release(lease);
      expect(manager.activeLeaseCount()).toBe(0);
    });
  });
});
