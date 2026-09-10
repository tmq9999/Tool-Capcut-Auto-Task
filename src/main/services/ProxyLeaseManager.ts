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
import type { ObservationIdentity, ObservationScope } from '../providers/ObservedHttpClient';
import { abortable } from './capcut/cancellation';

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
  observation?: ObservationScope;
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
  private readonly releasingLeases = new Map<string, Promise<void>>();
  private cachedKeys: string[] | null = null;

  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nextId: () => string;
  private readonly observation?: ObservationScope;

  constructor(
    private readonly api: IKiotProxyLeaseApi,
    private readonly leaseRepo: ProxyLeaseRepository,
    private readonly options: ProxyLeaseManagerOptions,
    deps: ProxyLeaseManagerDeps = {}
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
    this.observation = deps.observation;
  }

  private observe<T>(identity: Readonly<ObservationIdentity>, operation: () => Promise<T>): Promise<T> {
    return this.observation?.withObservationScope(identity, operation) ?? operation();
  }

  private async loadKeys(signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted();
    if (this.cachedKeys) return this.cachedKeys;

    // An explicit list wins: never reach for keys the operator did not offer.
    const chosen = this.options.keys?.filter((key) => key.trim().length > 0) ?? [];
    if (chosen.length > 0) {
      this.cachedKeys = chosen;
      return this.cachedKeys;
    }

    const listPromise = this.observe({ provider: 'kiotproxy', operation: 'proxy-list' }, () =>
      this.api.listKeys(this.options.apiToken));
    const keys = signal ? await abortable(listPromise, signal) : await listPromise;
    signal?.throwIfAborted();
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
  private async readCurrentIp(keyValue: string, signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted();
    try {
      const currentPromise = this.observe({ provider: 'kiotproxy', operation: 'proxy-current' }, () =>
        this.api.getCurrentProxy(keyValue, this.options.protocol ?? 'http'));
      const current = signal ? await abortable(currentPromise, signal) : await currentPromise;
      signal?.throwIfAborted();
      return current.ip;
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }

  private async tryKey(keyValue: string, signal?: AbortSignal): Promise<AcquiredProxyLease | null> {
    signal?.throwIfAborted();
    this.busyKeys.add(keyValue);

    let previousIp: string | null = null;
    try {
      previousIp = await this.readCurrentIp(keyValue, signal);
    } catch (err: unknown) {
      this.busyKeys.delete(keyValue);
      throw err;
    }

    if (signal?.aborted) {
      this.busyKeys.delete(keyValue);
      throw signal.reason ?? new Error('Aborted');
    }

    let lease: KiotProxyLease;
    try {
      lease = await this.observe({ provider: 'kiotproxy', operation: 'proxy-acquire' }, () =>
        this.api.getNewProxy(keyValue, {
          protocol: this.options.protocol ?? 'http',
          region: this.options.region
        }));
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
    signal?.throwIfAborted();
    const keys = await this.loadKeys(signal);
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
        signal?.throwIfAborted();
        if (this.busyKeys.has(keyValue) || this.isCoolingDown(keyValue)) continue;
        const lease = await this.tryKey(keyValue, signal);
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
    const existing = this.releasingLeases.get(lease.leaseId);
    if (existing) {
      await existing;
      return;
    }

    const owned = this.activeLeases.get(lease.leaseId);
    if (!owned) return;

    const releaseOp = (async () => {
      try {
        await this.observe({ provider: 'kiotproxy', operation: 'proxy-release' }, () =>
          this.api.releaseKey(owned.keyValue)
        );
      } catch {
        // Releasing is best effort: the gateway may have rotated the key already.
      }
      this.leaseRepo.release(owned.leaseId);
      this.activeLeases.delete(owned.leaseId);
      this.busyKeys.delete(owned.keyValue);
      this.cooldownUntil.delete(owned.keyValue);
    })();

    this.releasingLeases.set(owned.leaseId, releaseOp);
    try {
      await releaseOp;
    } finally {
      this.releasingLeases.delete(owned.leaseId);
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
