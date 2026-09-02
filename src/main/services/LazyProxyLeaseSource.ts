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

  constructor(
    private readonly secrets: SecretSource,
    private readonly factory: ProxyLeaseManagerFactory
  ) {}

  /**
   * Narrows this source to a specific set of proxy keys for the next run. The
   * manager is rebuilt when the set changes so a run never inherits the previous
   * run's key selection.
   */
  configure(options: { keys?: string[] }): void {
    const next = (options.keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0);
    const changed =
      next.length !== this.keys.length || next.some((key, index) => key !== this.keys[index]);

    this.keys = next;
    if (changed) {
      this.manager = null;
    }
  }

  private ensureManager(): IProxyLeaseSource {
    if (!this.manager) {
      const apiToken = this.secrets.readSimpleKey(KIOTPROXY_SERVICE_NAME);
      this.manager = this.factory({ apiToken, keys: this.keys });
    }
    return this.manager;
  }

  async acquire(): Promise<AcquiredProxyLease> {
    return this.ensureManager().acquire();
  }

  async availableSlots(): Promise<number | null> {
    const manager = this.ensureManager();
    return manager.availableSlots ? manager.availableSlots() : null;
  }

  async release(lease: AcquiredProxyLease): Promise<void> {
    if (!this.manager) return;
    await this.manager.release(lease);
  }

  async releaseAll(): Promise<void> {
    if (!this.manager) return;
    const current = this.manager;
    this.manager = null;
    await current.releaseAll();
  }
}
