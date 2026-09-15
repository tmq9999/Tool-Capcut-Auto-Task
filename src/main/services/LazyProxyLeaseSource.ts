import { KIOTPROXY_SERVICE_NAME } from '../providers/KiotProxyProvider';
import type { AcquiredProxyLease, ProxyLeaseManagerOptions } from './ProxyLeaseManager';
import type { IProxyLeaseSource } from './AutomationRunService';
import type { SecretSource } from '../providers/connectivity';

export type ProxyLeaseManagerFactory = (options: ProxyLeaseManagerOptions) => IProxyLeaseSource;

/**
 * Defers building the proxy lease manager until a run actually needs a proxy, so
 * an API token saved in Settings after startup is picked up without a restart.
 * The manager is rebuilt after each run finishes releasing its leases.
 */
export class LazyProxyLeaseSource implements IProxyLeaseSource {
  private manager: IProxyLeaseSource | null = null;
  /** Keys the current run is allowed to use; empty means every key on the account. */
  private keys: string[] = [];
  /**
   * Vùng proxy của lượt chạy. `ProxyLeaseManager` đã đọc khoá này khi gọi
   * `getNewProxy`, nhưng trước đây không ai chuyển xuống nên nó luôn `undefined`
   * (audit 04/09/2026).
   */
  private region: string | undefined;

  private readonly ownedLeases = new Set<string>();
  private acquisitionsInFlight = 0;
  private cleanupState: 'idle' | 'releasing' | 'failed' = 'idle';
  private releaseAllPromise: Promise<void> | null = null;

  constructor(
    private readonly secrets: SecretSource,
    private readonly factory: ProxyLeaseManagerFactory
  ) {}

  /**
   * Narrows this source to a specific set of proxy keys for the next run. The
   * manager is rebuilt when the set changes so a run never inherits the previous
   * run's key selection — cùng lý do đó cho `region`.
   */
  configure(options: { keys?: string[]; region?: string }): void {
    if (this.cleanupState === 'releasing' || this.cleanupState === 'failed') {
      throw new Error('CANNOT_CONFIGURE_WHILE_CLEANUP_PENDING');
    }
    const next = (options.keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0);
    const nextRegion = options.region?.trim() || undefined;
    const changed =
      next.length !== this.keys.length ||
      next.some((key, index) => key !== this.keys[index]) ||
      nextRegion !== this.region;

    if (!changed) return;

    if (this.ownedLeases.size > 0 || this.acquisitionsInFlight > 0) {
      throw new Error('CANNOT_CONFIGURE_WHILE_LEASES_ACTIVE');
    }

    this.keys = next;
    this.region = nextRegion;
    this.manager = null;
  }

  resetIdlePreflightCache(): void {
    if (this.cleanupState !== 'idle' || this.ownedLeases.size > 0 ||
        this.acquisitionsInFlight > 0 || this.releaseAllPromise) {
      throw new Error('CANNOT_RESET_PROXY_PREFLIGHT_WHILE_OWNED');
    }
    this.manager = null;
  }

  private ensureManager(): IProxyLeaseSource {
    if (!this.manager) {
      const apiToken = this.secrets.readSimpleKey(KIOTPROXY_SERVICE_NAME);
      this.manager = this.factory({ apiToken, keys: this.keys, region: this.region });
    }
    return this.manager;
  }

  async acquire(signal?: AbortSignal): Promise<AcquiredProxyLease> {
    if (this.cleanupState === 'releasing' || this.cleanupState === 'failed') {
      throw new Error('CANNOT_ACQUIRE_WHILE_CLEANUP_PENDING');
    }
    const manager = this.ensureManager();
    this.acquisitionsInFlight += 1;
    try {
      const lease = await manager.acquire(signal);
      this.ownedLeases.add(lease.leaseId);
      return lease;
    } finally {
      this.acquisitionsInFlight -= 1;
    }
  }

  async availableSlots(): Promise<number | null> {
    const manager = this.ensureManager();
    return manager.availableSlots ? manager.availableSlots() : null;
  }

  async release(lease: AcquiredProxyLease): Promise<void> {
    if (!this.manager) return;
    await this.manager.release(lease);
    this.ownedLeases.delete(lease.leaseId);
  }

  async releaseAll(): Promise<void> {
    if (this.acquisitionsInFlight > 0) {
      throw new Error('CANNOT_RELEASE_ALL_WHILE_ACQUISITIONS_IN_FLIGHT');
    }
    if (!this.manager) {
      this.cleanupState = 'idle';
      this.ownedLeases.clear();
      return;
    }
    if (this.releaseAllPromise) {
      return this.releaseAllPromise;
    }
    const current = this.manager;
    this.cleanupState = 'releasing';
    this.releaseAllPromise = (async () => {
      try {
        await current.releaseAll();
        this.manager = null;
        this.ownedLeases.clear();
        this.cleanupState = 'idle';
      } catch (error) {
        this.cleanupState = 'failed';
        throw error;
      } finally {
        this.releaseAllPromise = null;
      }
    })();
    return this.releaseAllPromise;
  }
}
