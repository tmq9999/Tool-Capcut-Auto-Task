import type { BrowserProxySettings } from './AutomationRunService';

interface WaitingWorker {
  resolve: (proxy: BrowserProxySettings) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function getDirectProxyRouteKey(proxy: BrowserProxySettings): string {
  const scheme = (proxy.type ?? 'http').toLowerCase();
  const host = proxy.host.toLowerCase();
  const port = Number(proxy.port);
  const username = proxy.username ?? '';
  const password = proxy.password ?? '';
  return JSON.stringify([scheme, host, port, username, password]);
}

/**
 * DirectProxyPool quản lý danh sách proxy tĩnh (Direct IP) đa luồng an toàn:
 * - Đảm bảo mỗi luồng đang chạy được cấp một proxy riêng biệt, không luồng nào dùng chung proxy tại cùng một thời điểm.
 * - Hỗ trợ cơ chế xoay vòng (round-robin FIFO): khi một luồng làm xong, proxy được trả về cuối hàng đợi để ưu tiên các proxy khác được sử dụng đều đặn.
 * - Hỗ trợ chờ (wait queue) khi tất cả proxy đang bận và hủy an toàn qua AbortSignal.
 */
export class DirectProxyPool {
  private readonly allProxies: readonly BrowserProxySettings[];
  private readonly available: BrowserProxySettings[];
  private readonly inUse = new Set<BrowserProxySettings>();
  private readonly waiters: WaitingWorker[] = [];

  constructor(proxies: BrowserProxySettings[]) {
    const seen = new Set<string>();
    for (const proxy of proxies) {
      const key = getDirectProxyRouteKey(proxy);
      if (seen.has(key)) {
        throw new Error(`DirectProxyPool: Duplicate proxy route detected for ${proxy.host}:${proxy.port}`);
      }
      seen.add(key);
    }
    this.allProxies = [...proxies];
    this.available = [...proxies];
  }

  get totalCount(): number {
    return this.allProxies.length;
  }

  get activeCount(): number {
    return this.inUse.size;
  }

  get availableCount(): number {
    return this.available.length;
  }

  /**
   * Cấp phát 1 proxy khả dụng cho worker.
   * Nếu có proxy rảnh, lấy ngay lập tức.
   * Nếu tất cả proxy đang bận, đưa worker vào hàng đợi chờ đến khi có luồng khác trả proxy.
   */
  async acquire(signal?: AbortSignal): Promise<BrowserProxySettings> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('DirectProxyPool: Yêu cầu bị hủy trước khi cấp proxy.');
    }

    if (this.available.length > 0) {
      const proxy = this.available.shift()!;
      this.inUse.add(proxy);
      return proxy;
    }

    return new Promise<BrowserProxySettings>((resolve, reject) => {
      const waiter: WaitingWorker = { resolve, reject, signal };

      if (signal) {
        const onAbort = (): void => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(signal.reason ?? new Error('DirectProxyPool: Chờ cấp proxy bị hủy.'));
        };
        waiter.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }

  /**
   * Giải phóng proxy khi worker hoàn thành nhiệm vụ.
   * Nếu có worker đang chờ, chuyển giao ngay cho worker đầu tiên trong hàng đợi.
   * Nếu không có ai chờ, đưa proxy về cuối hàng đợi khả dụng (để các proxy khác được luân phiên sử dụng).
   */
  release(proxy: BrowserProxySettings): void {
    if (!this.inUse.has(proxy)) {
      // Proxy đã được release hoặc không thuộc pool này
      return;
    }

    this.inUse.delete(proxy);

    while (this.waiters.length > 0) {
      const nextWaiter = this.waiters.shift()!;
      if (nextWaiter.signal?.aborted) {
        continue;
      }
      if (nextWaiter.signal && nextWaiter.onAbort) {
        nextWaiter.signal.removeEventListener('abort', nextWaiter.onAbort);
      }
      this.inUse.add(proxy);
      nextWaiter.resolve(proxy);
      return;
    }

    // Không có ai chờ -> đưa về cuối hàng đợi khả dụng
    this.available.push(proxy);
  }

  /**
   * Hủy toàn bộ hàng đợi đang chờ (dùng khi toàn bộ phiên chạy dừng lại).
   */
  drain(reason?: Error): void {
    const error = reason ?? new Error('DirectProxyPool: Phiên chạy đã dừng, hủy hàng đợi cấp proxy.');
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      waiter.reject(error);
    }
  }
}
