import { describe, it, expect } from 'vitest';
import { DirectProxyPool } from '../DirectProxyPool';
import type { BrowserProxySettings } from '../AutomationRunService';

describe('DirectProxyPool', () => {
  const p1: BrowserProxySettings = { host: '1.1.1.1', port: 8080, type: 'http' };
  const p2: BrowserProxySettings = { host: '2.2.2.2', port: 1080, type: 'socks5' };
  const p3: BrowserProxySettings = { host: '3.3.3.3', port: 8080, type: 'http' };

  it('cấp phát proxy độc lập cho từng luồng khi còn proxy rảnh', async () => {
    const pool = new DirectProxyPool([p1, p2, p3]);
    expect(pool.totalCount).toBe(3);
    expect(pool.availableCount).toBe(3);
    expect(pool.activeCount).toBe(0);

    const acquired1 = await pool.acquire();
    const acquired2 = await pool.acquire();

    expect(acquired1).toEqual(p1);
    expect(acquired2).toEqual(p2);
    expect(pool.availableCount).toBe(1);
    expect(pool.activeCount).toBe(2);

    // Tuyệt đối không trùng nhau
    expect(acquired1).not.toBe(acquired2);
  });

  it('xoay vòng proxy (round-robin) khi giải phóng', async () => {
    const pool = new DirectProxyPool([p1, p2]);

    const a1 = await pool.acquire(); // lấy p1
    const a2 = await pool.acquire(); // lấy p2

    expect(a1).toEqual(p1);
    expect(a2).toEqual(p2);
    expect(pool.availableCount).toBe(0);

    // Trả p1 về pool -> p1 nằm cuối hàng đợi
    pool.release(a1);
    expect(pool.availableCount).toBe(1);

    // Trả p2 về pool -> p2 nằm sau p1
    pool.release(a2);
    expect(pool.availableCount).toBe(2);

    // Lấy lại sẽ theo thứ tự p1, rồi đến p2
    const a3 = await pool.acquire();
    const a4 = await pool.acquire();
    expect(a3).toEqual(p1);
    expect(a4).toEqual(p2);
  });

  it('xử lý hàng đợi chờ khi hết proxy và cấp ngay khi có luồng trả', async () => {
    const pool = new DirectProxyPool([p1]);

    const a1 = await pool.acquire();
    expect(a1).toEqual(p1);
    expect(pool.availableCount).toBe(0);

    // Luồng thứ 2 yêu cầu trong khi chưa có proxy
    let resolved = false;
    const pendingAcquire = pool.acquire().then((proxy) => {
      resolved = true;
      return proxy;
    });

    // Lúc này chưa resolve vì đang chờ
    expect(resolved).toBe(false);

    // Luồng 1 trả proxy
    pool.release(a1);

    const a2 = await pendingAcquire;
    expect(resolved).toBe(true);
    expect(a2).toEqual(p1);
    expect(pool.activeCount).toBe(1);
  });

  it('hủy chờ an toàn khi AbortSignal kích hoạt', async () => {
    const pool = new DirectProxyPool([p1]);
    await pool.acquire(); // lấy hết p1

    const controller = new AbortController();
    const acquirePromise = pool.acquire(controller.signal);

    controller.abort(new Error('Stop waiting'));

    await expect(acquirePromise).rejects.toThrow('Stop waiting');
  });

  it('drain() hủy toàn bộ luồng đang chờ khi dừng phiên', async () => {
    const pool = new DirectProxyPool([]); // rỗng
    const acquire1 = pool.acquire();
    const acquire2 = pool.acquire();

    pool.drain(new Error('Session stopped'));

    await expect(acquire1).rejects.toThrow('Session stopped');
    await expect(acquire2).rejects.toThrow('Session stopped');
  });

  it('từ chối khi khởi tạo danh sách có route trùng lặp', () => {
    const duplicateList: BrowserProxySettings[] = [
      { host: 'proxy.com', port: 8080, type: 'http', username: 'u', password: 'p' },
      { host: 'PROXY.COM', port: 8080, type: 'HTTP', username: 'u', password: 'p' },
    ];
    expect(() => new DirectProxyPool(duplicateList)).toThrowError(
      /Duplicate proxy route detected for PROXY\.COM:8080/
    );
  });

  it('chấp nhận cùng host:port nếu khác username hoặc password (khác route)', () => {
    const distinctList: BrowserProxySettings[] = [
      { host: 'proxy.com', port: 8080, type: 'http', username: 'user1', password: 'p' },
      { host: 'proxy.com', port: 8080, type: 'http', username: 'user2', password: 'p' },
    ];
    const pool = new DirectProxyPool(distinctList);
    expect(pool.totalCount).toBe(2);
  });
});

