import { describe, it, expect } from 'vitest';
import { LazyProxyLeaseSource } from '../LazyProxyLeaseSource';
import { ProviderError } from '../../providers/ProviderError';
import type { AcquiredProxyLease, ProxyLeaseManagerOptions } from '../ProxyLeaseManager';
import type { IProxyLeaseSource } from '../AutomationRunService';

class FakeManager implements IProxyLeaseSource {
  public acquires = 0;
  public releaseAllCalls = 0;
  public acquireSignals: Array<AbortSignal | undefined> = [];
  public availableSlotsCalls = 0;
  constructor(public readonly token: string, public readonly keys?: string[]) {}

  async availableSlots(): Promise<number | null> {
    this.availableSlotsCalls += 1;
    return this.keys ? this.keys.length : null;
  }

  async acquire(signal?: AbortSignal): Promise<AcquiredProxyLease> {
    this.acquires += 1;
    this.acquireSignals.push(signal);
    return {
      leaseId: 'lease-' + this.acquires,
      keyValue: 'K',
      ip: '1.1.1.' + this.acquires,
      host: '1.1.1.' + this.acquires,
      port: 20001,
      protocol: 'http',
      username: null,
      password: null,
      nextChangeSeconds: null
    };
  }

  async release(): Promise<void> {}

  async releaseAll(): Promise<void> {
    this.releaseAllCalls += 1;
  }
}

describe('LazyProxyLeaseSource', () => {
  it('builds the manager on first use with the token stored at that moment', async () => {
    const built: FakeManager[] = [];
    let storedToken = 'TOKEN-1';
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => storedToken },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken);
        built.push(manager);
        return manager;
      }
    );

    storedToken = 'TOKEN-2';
    await source.acquire();

    expect(built).toHaveLength(1);
    expect(built[0].token).toBe('TOKEN-2');
  });

  it('reuses the same manager across acquisitions in one run', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      () => {
        const manager = new FakeManager('TOKEN');
        built.push(manager);
        return manager;
      }
    );

    await source.acquire();
    await source.acquire();

    expect(built).toHaveLength(1);
    expect(built[0].acquires).toBe(2);
  });

  it('rebuilds the manager after releaseAll so a new token takes effect', async () => {
    const built: FakeManager[] = [];
    let storedToken = 'TOKEN-A';
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => storedToken },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken);
        built.push(manager);
        return manager;
      }
    );

    await source.acquire();
    await source.releaseAll();
    storedToken = 'TOKEN-B';
    await source.acquire();

    expect(built.map((manager) => manager.token)).toEqual(['TOKEN-A', 'TOKEN-B']);
    expect(built[0].releaseAllCalls).toBe(1);
  });

  it('reports a missing KiotProxy token as a configuration error', async () => {
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => { throw new ProviderError('CONFIG_ERROR', 'chưa cấu hình', 'kiotproxy'); } },
      () => new FakeManager('unused')
    );

    await expect(source.acquire()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('is a no-op when releaseAll runs before any acquisition', async () => {
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      () => new FakeManager('TOKEN')
    );

    await expect(source.releaseAll()).resolves.toBeUndefined();
  });

  it('OP-01 retains failed cleanup owner', async () => {
    const manager = new FakeManager('TOKEN');
    let builds = 0;
    let fail = true;
    manager.releaseAll = async () => {
      if (fail) throw new Error('fixture');
    };
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      () => {
        builds++;
        return manager;
      }
    );
    await source.acquire();
    await expect(source.releaseAll()).rejects.toThrow('fixture');
    await expect(source.acquire()).rejects.toThrow();
    expect(builds).toBe(1);
    fail = false;
    await source.releaseAll();
    await source.acquire();
    expect(builds).toBe(2);
  });
});

describe('LazyProxyLeaseSource với danh sách key chỉ định', () => {
  it('chuyển đúng danh sách key xuống manager', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken, options.keys);
        built.push(manager);
        return manager;
      }
    );

    source.configure({ keys: ['K1', 'K2'] });
    await source.acquire();

    expect(built).toHaveLength(1);
    expect(built[0].keys).toEqual(['K1', 'K2']);
  });

  it('chuyển tiếp region xuống ProxyLeaseManager', async () => {
    /**
     * `ProxyConfig.region` có trong contract và `ProxyLeaseManager` ĐANG đọc
     * (`options.region` khi gọi `getNewProxy`), nhưng không ai chuyển xuống —
     * khoá này trước đây luôn `undefined` (audit 04/09/2026).
     */
    const seen: Array<string | undefined> = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        seen.push(options.region);
        return new FakeManager(options.apiToken, options.keys);
      }
    );

    source.configure({ keys: ['K1'], region: 'hanoi' });
    await source.acquire();

    expect(seen).toEqual(['hanoi']);
  });

  it('đổi region thì dựng lại manager, không dùng lại region của lượt trước', async () => {
    const seen: Array<string | undefined> = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        seen.push(options.region);
        return new FakeManager(options.apiToken, options.keys);
      }
    );

    source.configure({ keys: ['K1'], region: 'hanoi' });
    const lease1 = await source.acquire();
    await source.release(lease1);
    source.configure({ keys: ['K1'], region: 'saigon' });
    const lease2 = await source.acquire();
    await source.release(lease2);

    expect(seen).toEqual(['hanoi', 'saigon']);
  });

  it('dựng lại manager khi danh sách key đổi giữa hai phiên', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken, options.keys);
        built.push(manager);
        return manager;
      }
    );

    source.configure({ keys: ['K1'] });
    const lease1 = await source.acquire();
    await source.release(lease1);
    source.configure({ keys: ['K2', 'K3'] });
    const lease2 = await source.acquire();
    await source.release(lease2);

    expect(built.map((m) => m.keys)).toEqual([['K1'], ['K2', 'K3']]);
  });

  it('giữ nguyên manager khi danh sách key không đổi', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken, options.keys);
        built.push(manager);
        return manager;
      }
    );

    source.configure({ keys: ['K1'] });
    await source.acquire();
    source.configure({ keys: ['K1'] });
    await source.acquire();

    expect(built).toHaveLength(1);
    expect(built[0].acquires).toBe(2);
  });

  it('không truyền key nào thì manager tự lấy toàn bộ key của tài khoản', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken, options.keys);
        built.push(manager);
        return manager;
      }
    );

    source.configure({ keys: [] });
    await source.acquire();

    expect(built[0].keys).toEqual([]);
  });

  it('forwards the caller AbortSignal to the lazily created source', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource(
      { readSimpleKey: () => 'TOKEN' },
      (options: ProxyLeaseManagerOptions) => {
        const manager = new FakeManager(options.apiToken, options.keys);
        built.push(manager);
        return manager;
      }
    );
    const controller = new AbortController();

    await source.acquire(controller.signal);

    expect(built).toHaveLength(1);
    expect(built[0].acquireSignals).toEqual([controller.signal]);
  });

  it('B04 refuses changed config until leases are released', async () => {
    const built: FakeManager[] = [];
    const source = new LazyProxyLeaseSource({ readSimpleKey: () => 'TOKEN' }, (options) => {
      const manager = new FakeManager(options.apiToken, options.keys);
      built.push(manager);
      return manager;
    });
    source.configure({ keys: ['K1'] });
    const lease = await source.acquire();
    expect(() => source.configure({ keys: ['K2'] })).toThrow();
    expect(built).toHaveLength(1);
    expect(() => source.configure({ keys: ['K1'] })).not.toThrow();
    await source.release(lease);
    source.configure({ keys: ['K2'] });
    await source.acquire();
    expect(built.map((x) => x.keys)).toEqual([['K1'], ['K2']]);
  });

  describe('resetIdlePreflightCache', () => {
    it('resets cached manager when idle so preflight / availableSlots picks up new token and inventory', async () => {
      const built: FakeManager[] = [];
      let token = 'TOKEN-INITIAL';
      const source = new LazyProxyLeaseSource(
        { readSimpleKey: () => token },
        (options: ProxyLeaseManagerOptions) => {
          const manager = new FakeManager(options.apiToken, options.keys);
          built.push(manager);
          return manager;
        }
      );

      source.configure({ keys: ['K1'] });
      expect(await source.availableSlots()).toBe(1);
      expect(built).toHaveLength(1);
      expect(built[0].token).toBe('TOKEN-INITIAL');

      // Operator changes token in settings
      token = 'TOKEN-NEW';
      source.resetIdlePreflightCache();

      // Next preflight creates a new manager with new token
      expect(await source.availableSlots()).toBe(1);
      expect(built).toHaveLength(2);
      expect(built[1].token).toBe('TOKEN-NEW');
    });

    it('refuses to reset preflight cache while leases are active', async () => {
      const built: FakeManager[] = [];
      const source = new LazyProxyLeaseSource(
        { readSimpleKey: () => 'TOKEN' },
        (options: ProxyLeaseManagerOptions) => {
          const manager = new FakeManager(options.apiToken, options.keys);
          built.push(manager);
          return manager;
        }
      );

      source.configure({ keys: ['K1'] });
      const lease = await source.acquire();
      expect(() => source.resetIdlePreflightCache()).toThrow('CANNOT_RESET_PROXY_PREFLIGHT_WHILE_OWNED');
      expect(built).toHaveLength(1);

      await source.release(lease);
      expect(() => source.resetIdlePreflightCache()).not.toThrow();
    });

    it('refuses to reset preflight cache when cleanupState is releasing or failed', async () => {
      let failRelease = false;
      class FlakyManager extends FakeManager {
        override async releaseAll(): Promise<void> {
          if (failRelease) throw new Error('Release failed');
          return super.releaseAll();
        }
      }

      const source = new LazyProxyLeaseSource(
        { readSimpleKey: () => 'TOKEN' },
        (options: ProxyLeaseManagerOptions) => new FlakyManager(options.apiToken, options.keys)
      );

      await source.acquire();
      failRelease = true;
      await expect(source.releaseAll()).rejects.toThrow('Release failed');

      // Cleanup failed
      expect(() => source.resetIdlePreflightCache()).toThrow('CANNOT_RESET_PROXY_PREFLIGHT_WHILE_OWNED');
    });
  });
});
