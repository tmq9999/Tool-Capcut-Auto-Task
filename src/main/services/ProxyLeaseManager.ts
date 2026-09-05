import crypto from 'node:crypto';
import { ProviderError } from '../providers/ProviderError';
import {
  KIOTPROXY_SERVICE_NAME,
  ProxyKeyUnavailableError,
  type KiotProxyKeySummary,
  type KiotProxyLease
} from '../providers/KiotProxyProvider';
import {
  ProxyIpInUseError,
  type ProxyLeaseRepository,
  type ProxyProtocol
} from '../repositories/ProxyLeaseRepository';

/** The slice of KiotProxyProvider the lease manager depends on. */
export interface IKiotProxyLeaseApi {
  listKeys(apiToken: string): Promise<KiotProxyKeySummary[]>;
  getNewProxy(
    keyValue: string,
    options?: { protocol?: ProxyProtocol; region?: string }
  ): Promise<KiotProxyLease>;
  getCurrentProxy(keyValue: string, protocol?: ProxyProtocol): Promise<KiotProxyLease>;
  releaseKey(keyValue: string): Promise<void>;
}

export interface ProxyLeaseManagerOptions {
  apiToken: string;
  /**
   * Exactly which keys this manager may use. Empty or omitted means every key on
   * the account, so an operator can reserve the rest for another tool.
   */
  keys?: string[];
  protocol?: ProxyProtocol;
  region?: string;
  waitIntervalMs?: number;
  acquireTimeoutMs?: number;
  keyCooldownMs?: number;
}

export interface ProxyLeaseManagerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  nextId?: () => string;
}

export interface AcquiredProxyLease extends KiotProxyLease {
  leaseId: string;
}

const DEFAULT_WAIT_INTERVAL_MS = 2_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 120_000;
const DEFAULT_KEY_COOLDOWN_MS = 15_000;

/**
 * Hands out KiotProxy endpoints under four rules:
 *  - every acquisition asks the gateway for a brand-new IP;
 *  - rotation is verified against the key's current IP (/get-current): a key that
 *    hands back the IP it already had is skipped, not retried;
 *  - when every key is busy the caller waits instead of doubling up;
 *  - two profiles never hold the same IP at the same time. Once a lease is
 *    released its IP is free to be used again — no permanent IP blacklist.
 */
export class ProxyLeaseManager {
  private readonly busyKeys = new Set<string>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly activeLeases = new Map<string, AcquiredProxyLease>();
  private cachedKeys: string[] | null = null;

  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nextId: () => string;

  constructor(
    private readonly api: IKiotProxyLeaseApi,
    private readonly leaseRepo: ProxyLeaseRepository,
    private readonly options: ProxyLeaseManagerOptions,
    deps: ProxyLeaseManagerDeps = {}
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
  }

  private async loadKeys(): Promise<string[]> {
    if (this.cachedKeys) return this.cachedKeys;

    // An explicit list wins: never reach for keys the operator did not offer.
    const chosen = this.options.keys?.filter((key) => key.trim().length > 0) ?? [];
    if (chosen.length > 0) {
      this.cachedKeys = chosen;
      return this.cachedKeys;
    }

    const keys = await this.api.listKeys(this.options.apiToken);
    this.cachedKeys = keys.map((entry) => entry.keyValue);
    return this.cachedKeys;
  }

  /** Forgets the cached key list so a Settings change is picked up. */
  refreshKeys(): void {
    this.cachedKeys = null;
  }

  private isCoolingDown(keyValue: string): boolean {
    const until = this.cooldownUntil.get(keyValue);
    return until !== undefined && until > this.now();
  }

  private markCooldown(keyValue: string): void {
    const cooldown = this.options.keyCooldownMs ?? DEFAULT_KEY_COOLDOWN_MS;
    this.cooldownUntil.set(keyValue, this.now() + cooldown);
  }

  /**
   * The IP the gateway currently reports for this key, or null when it cannot
   * say. Used only to tell a real rotation from a no-op.
   */
  private async readCurrentIp(keyValue: string): Promise<string | null> {
    try {
      const current = await this.api.getCurrentProxy(keyValue, this.options.protocol ?? 'http');
      return current.ip;
    } catch {
      return null;
    }
  }

  private async tryKey(keyValue: string): Promise<AcquiredProxyLease | null> {
    this.busyKeys.add(keyValue);

    const previousIp = await this.readCurrentIp(keyValue);

    let lease: KiotProxyLease;
    try {
      lease = await this.api.getNewProxy(keyValue, {
        protocol: this.options.protocol ?? 'http',
        region: this.options.region
      });
    } catch (err: unknown) {
      this.busyKeys.delete(keyValue);
      if (err instanceof ProxyKeyUnavailableError) {
        this.markCooldown(keyValue);
        return null;
      }
      if (err instanceof ProviderError && (err.code === 'AUTH_ERROR' || err.code === 'RATE_LIMITED')) {
        throw err;
      }
      this.markCooldown(keyValue);
      return null;
    }

    // The key answered with the IP it already had, so no rotation happened.
    if (previousIp !== null && lease.ip === previousIp) {
      this.busyKeys.delete(keyValue);
      this.markCooldown(keyValue);
      return null;
    }

    // Recording fails when another running profile already holds this IP.
    const leaseId = this.nextId();
    try {
      this.leaseRepo.recordLease({
        id: leaseId,
        keyValue,
        ip: lease.ip,
        host: lease.host,
        port: lease.port,
        protocol: lease.protocol
      });
    } catch (err: unknown) {
      this.busyKeys.delete(keyValue);
      if (err instanceof ProxyIpInUseError) {
        this.markCooldown(keyValue);
        return null;
      }
      throw err;
    }

    const acquired: AcquiredProxyLease = { ...lease, leaseId };
    this.activeLeases.set(leaseId, acquired);
    return acquired;
  }

  /**
   * Acquires one exclusive proxy. Cycles the account's keys, skipping busy and
   * cooling-down keys, and waits when nothing is free. Rejects once the deadline
   * passes so a run reports the stall instead of hanging forever.
   */
  async acquire(signal?: AbortSignal): Promise<AcquiredProxyLease> {
    const keys = await this.loadKeys();
    if (keys.length === 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Tài khoản KiotProxy không có proxy key nào để sử dụng.',
        KIOTPROXY_SERVICE_NAME
      );
    }

    const deadline = this.now() + (this.options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS);
    const waitInterval = this.options.waitIntervalMs ?? DEFAULT_WAIT_INTERVAL_MS;

    for (;;) {
      signal?.throwIfAborted();
      for (const keyValue of keys) {
        if (this.busyKeys.has(keyValue) || this.isCoolingDown(keyValue)) continue;
        const lease = await this.tryKey(keyValue);
        if (lease) return lease;
      }

      if (this.now() >= deadline) {
        throw new ProviderError(
          'CONFIG_ERROR',
          'Không có proxy key nào rảnh để cấp IP mới sau khi chờ. Hãy thêm key hoặc giảm số luồng.',
          KIOTPROXY_SERVICE_NAME
        );
      }

      // Every key is busy or cooling down: pause this caller and try again.
      await this.wait(waitInterval, signal);
    }
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal.reason ?? new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void this.sleep(ms).then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
    });
  }

  async release(lease: AcquiredProxyLease): Promise<void> {
    this.activeLeases.delete(lease.leaseId);
    this.leaseRepo.release(lease.leaseId);
    this.busyKeys.delete(lease.keyValue);
    this.cooldownUntil.delete(lease.keyValue);
    try {
      await this.api.releaseKey(lease.keyValue);
    } catch {
      // Releasing is best effort: the gateway may have rotated the key already.
    }
  }

  async releaseAll(): Promise<void> {
    const outstanding = Array.from(this.activeLeases.values());
    for (const lease of outstanding) {
      await this.release(lease);
    }
    this.leaseRepo.releaseAll();
    this.busyKeys.clear();
  }

  activeLeaseCount(): number {
    return this.activeLeases.size;
  }

  /** Key count of the account: the ceiling on concurrent threads. */
  async availableSlots(): Promise<number | null> {
    const keys = await this.loadKeys();
    return keys.length;
  }
}
