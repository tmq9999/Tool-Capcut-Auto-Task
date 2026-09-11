import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogsController, toViewLog, type ILogsBridge } from '../logsController';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../../../shared/schemas/log.schema';
import { LOG_PAGE_SIZE_MAX } from '../../../../shared/schemas/log.schema';
import { IpcContractRegistry } from '../../../../shared/contracts/api';

function log(id: string, overrides: Partial<CanonicalRuntimeLog> = {}): CanonicalRuntimeLog {
  return {
    id,
    email: 'worker@x.com',
    step: 'Browser',
    status: 'INFO',
    message: 'msg ' + id,
    createdAt: '2026-09-01T03:32:31.000Z',
    ...overrides
  };
}

class FakeBridge implements ILogsBridge {
  public listeners: Array<(entry: CanonicalRuntimeLog) => void> = [];
  public resetListeners: Array<(payload: { clearedThrough: number }) => void> = [];
  public cleared = 0;
  public unsubscribed = 0;
  public rows: CanonicalRuntimeLog[] = [log('log-1')];
  public listFails = false;
  /** Request cuối cùng trang Logs gửi đi — để đối chiếu với contract THẬT. */
  public lastFilter: unknown = null;

  logs = {
    list: async (filter: unknown): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>> => {
      this.lastFilter = filter;
      if (this.listFails) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'db down' } };
      }
      return { success: true, data: { items: this.rows, total: this.rows.length } };
    },
    clear: async (): ReturnType<ILogsBridge['logs']['clear']> => {
      this.cleared += 1;
      this.rows = [];
      return { success: true, data: { success: true, clearedThrough: 0 } };
    },
    onEntry: (listener: (entry: CanonicalRuntimeLog) => void): (() => void) => {
      this.listeners.push(listener);
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        this.unsubscribed += 1;
        const index = this.listeners.indexOf(listener);
        if (index >= 0) this.listeners.splice(index, 1);
      };
    },
    onReset: (listener: (payload: { clearedThrough: number }) => void): (() => void) => {
      this.resetListeners.push(listener);
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        this.unsubscribed += 1;
        const index = this.resetListeners.indexOf(listener);
        if (index >= 0) this.resetListeners.splice(index, 1);
      };
    }
  };

  push(entry: CanonicalRuntimeLog): void {
    for (const listener of this.listeners) listener(entry);
  }

  pushReset(payload: { clearedThrough: number }): void {
    for (const listener of this.resetListeners) listener(payload);
  }

}

let bridge: FakeBridge;

beforeEach(() => {
  bridge = new FakeBridge();
});

describe('toViewLog', () => {
  it('renders the stored UTC timestamp as a local clock time', () => {
    const view = toViewLog(log('log-1', { createdAt: '2026-09-01T03:32:31.000Z' }));
    expect(view.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('keeps the canonical status, step, email and message', () => {
    const view = toViewLog(log('log-2', { status: 'ERROR', step: 'Proxy', message: 'timeout' }));

    expect(view.status).toBe('ERROR');
    expect(view.step).toBe('Proxy');
    expect(view.email).toBe('worker@x.com');
    expect(view.message).toBe('timeout');
    expect(view.id).toBe('log-2');
  });
});

describe('LogsController', () => {
  it('loads the persisted logs into view models', async () => {
    const controller = new LogsController(bridge);

    await controller.load();

    expect(controller.getState().logs.map((row) => row.id)).toEqual(['log-1']);
    expect(controller.getState().isLoading).toBe(false);
  });

  it('reports a load failure', async () => {
    bridge.listFails = true;
    const controller = new LogsController(bridge);

    await controller.load();

    expect(controller.getState().error).toContain('nhật ký');
  });

  it('prepends live entries while streaming is active', () => {
    const controller = new LogsController(bridge);
    controller.attach();

    bridge.push(log('log-2', { createdAt: '2026-09-01T03:32:31.000Z' }));
    bridge.push(log('log-3', { createdAt: '2026-09-01T03:32:32.000Z' }));

    expect(controller.getState().logs.map((row) => row.id)).toEqual(['log-3', 'log-2']);
  });

  it('drops live entries while paused and resumes afterwards', () => {
    const controller = new LogsController(bridge);
    controller.attach();

    controller.setPaused(true);
    bridge.push(log('log-2'));
    expect(controller.getState().logs).toHaveLength(0);

    controller.setPaused(false);
    bridge.push(log('log-3'));
    expect(controller.getState().logs.map((row) => row.id)).toEqual(['log-3']);
  });

  it('caps the buffer so a long session cannot grow it without bound', () => {
    const controller = new LogsController(bridge, { maxLogs: 2 });
    controller.attach();

    bridge.push(log('log-1', { createdAt: '2026-09-01T03:32:31.000Z' }));
    bridge.push(log('log-2', { createdAt: '2026-09-01T03:32:32.000Z' }));
    bridge.push(log('log-3', { createdAt: '2026-09-01T03:32:33.000Z' }));

    expect(controller.getState().logs.map((row) => row.id)).toEqual(['log-3', 'log-2']);
  });

  it('clears both the persisted rows and the buffer', async () => {
    const controller = new LogsController(bridge);
    await controller.load();

    await controller.clear();

    expect(bridge.cleared).toBe(1);
    expect(controller.getState().logs).toHaveLength(0);
  });

  it('unsubscribes on dispose', () => {
    const controller = new LogsController(bridge);
    controller.attach();

    controller.dispose();

    expect(bridge.unsubscribed).toBe(2);
  });

  /**
   * Đo được 04/09/2026: trang Logs gửi `pageSize = maxLogs = 1000`, mà
   * `LogFilterSchema` chặn ở 500 — nên `logsIpc` `safeParse` trả VALIDATION_ERROR
   * và trang chỉ hiện "Không tải được nhật ký runtime." với 0 dòng, dù DB đang có
   * 1573 dòng `runtime_logs`. Lỗi ẩn lâu vì luồng live (`onEntry`) vẫn chạy, nên
   * lúc đang có lượt chạy thì trang trông như bình thường.
   *
   * Đây là hai con số phải khớp nhau nhưng khai ở hai file khác nhau — test này
   * đối chiếu request THẬT với contract THẬT, không mock cái nào.
   */
  it('request tải nhật ký phải qua được contract logs.list', async () => {
    const controller = new LogsController(bridge);

    await controller.load();

    const parsed = IpcContractRegistry.logs.list.request.safeParse(bridge.lastFilter);
    expect(parsed.success ? 'OK' : parsed.error.issues[0].message).toBe('OK');
  });

  /**
   * `maxLogs` là bộ đệm TRÊN MÀN HÌNH (mặc định 1000), còn `LOG_PAGE_SIZE_MAX` là
   * trần MỘT LƯỢT `logs.list` (500). Hai con số này độc lập nhau, nên nới bộ đệm
   * lên không được phép kéo `pageSize` vượt trần contract — đúng cách bug
   * 04/09/2026 phát sinh. Lấy 100_000 để chênh lệch đủ lớn, chốt lại bằng chính
   * contract chứ không so với hằng số chép tay.
   */
  it('không đòi quá số dòng contract cho phép, kể cả khi maxLogs lớn hơn', async () => {
    const controller = new LogsController(bridge, { maxLogs: 100_000 });

    await controller.load();

    const sent = bridge.lastFilter as { pageSize: number };
    expect(sent.pageSize).toBeLessThanOrEqual(LOG_PAGE_SIZE_MAX);
    expect(IpcContractRegistry.logs.list.request.safeParse(bridge.lastFilter).success).toBe(true);
  });

  /**
   * Audit 04/09/2026: SQL lọc server-side đã viết đủ (`LogRepository.ts:55-62`) và
   * contract có `level`/`email`, nhưng renderer không gửi — nó lọc client trên 500
   * dòng mới nhất. DB có 1573 dòng, lỗi nằm ở dòng 800, chọn ERROR → "Không có bản
   * ghi phù hợp" trong khi lỗi vẫn nằm đó.
   */
  it('đẩy bộ lọc level và email xuống server', async () => {
    const controller = new LogsController(bridge);

    await controller.load({ level: 'ERROR', email: 'worker@x.com' });

    expect(bridge.lastFilter).toMatchObject({ level: 'ERROR', email: 'worker@x.com' });
    expect(IpcContractRegistry.logs.list.request.safeParse(bridge.lastFilter).success).toBe(true);
  });

  it('ALL nghĩa là không lọc — không gửi khoá xuống SQL', async () => {
    const controller = new LogsController(bridge);

    await controller.load({ level: 'ALL', email: 'ALL' });

    expect(bridge.lastFilter).not.toHaveProperty('level');
    expect(bridge.lastFilter).not.toHaveProperty('email');
  });

  /**
   * Ô tìm kiếm để trống gửi chuỗi rỗng, không phải `'ALL'`. Nếu để lọt xuống thì
   * `LogRepository` (`LogRepository.ts:59`) tự bỏ qua `email` rỗng nhưng `level`
   * rỗng lại thành `status = ''` — khớp 0 dòng, trang trắng trong khi DB có 1573
   * dòng. Chặn ngay ở renderer để không phụ thuộc lòng tốt của SQL.
   */
  it('chuỗi rỗng cũng là không lọc — không gửi khoá rỗng xuống SQL', async () => {
    const controller = new LogsController(bridge);

    await controller.load({ level: '', email: '   ' });

    expect(bridge.lastFilter).not.toHaveProperty('level');
    expect(bridge.lastFilter).not.toHaveProperty('email');
  });

  it('nhớ bộ lọc cho lần tải lại sau', async () => {
    const controller = new LogsController(bridge);

    await controller.load({ level: 'ERROR' });
    await controller.load();

    expect(bridge.lastFilter).toMatchObject({ level: 'ERROR' });
  });

  /**
   * Mặt trái của việc nhớ bộ lọc: chọn lại "Tất cả" phải XOÁ được cái đã nhớ.
   * Nếu chỉ merge bộ lọc mới đè lên cũ thì `'ALL'` bị bỏ đi và `level: 'ERROR'`
   * cũ vẫn dính, người dùng kẹt ở ERROR không thoát ra được.
   */
  it('chọn lại ALL phải xoá được bộ lọc đã nhớ', async () => {
    const controller = new LogsController(bridge);

    await controller.load({ level: 'ERROR' });
    await controller.load({ level: 'ALL' });
    expect(bridge.lastFilter).not.toHaveProperty('level');
  });

  it('UI-02 filters live events by the active query', async () => {
    bridge.rows = [];
    const c = new LogsController(bridge);
    await c.load({ level: 'ERROR', email: 'worker@x.com' });
    c.attach();
    bridge.push(log('wrong', { status: 'INFO' }));
    bridge.push(log('right', { status: 'ERROR' }));
    expect(c.getState().logs.map((x) => x.id)).toEqual(['right']);
  });

  it('B13 ignores history response started before Clear', async () => {
    let finish!: (v: IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>) => void;
    bridge.logs.list = () => new Promise((r) => { finish = r; });
    const c = new LogsController(bridge);
    const load = c.load();
    await c.clear();
    finish({ success: true, data: { items: [log('old')], total: 1 } });
    await load;
    expect(c.getState().logs).toEqual([]);
    expect(c.getState().isLoading).toBe(false);
  });

  it('B13 merges live pushes received during pending load and deduplicates by id', async () => {
    let finish!: (v: IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>) => void;
    bridge.logs.list = () => new Promise((r) => { finish = r; });
    const c = new LogsController(bridge);
    c.attach();
    const loadPromise = c.load();

    bridge.push(log('live-1', { message: 'live during load', createdAt: '2026-09-01T03:32:32.000Z' }));
    bridge.push(log('history-1', { message: 'duplicate in both', createdAt: '2026-09-01T03:32:33.000Z' }));

    finish({
      success: true,
      data: {
        items: [
          log('history-1', { message: 'from db', createdAt: '2026-09-01T03:32:33.000Z' }),
          log('history-2', { message: 'older db', createdAt: '2026-09-01T03:32:31.000Z' })
        ],
        total: 2
      }
    });
    await loadPromise;

    const ids = c.getState().logs.map((l) => l.id);
    expect(ids).toEqual(['history-1', 'live-1', 'history-2']);
    expect(c.getState().logs.find((l) => l.id === 'history-1')?.message).toBe('duplicate in both');
  });

  it('B13 discards live pushes with streamSequence <= clearedThrough', async () => {
    bridge.logs.clear = async () => ({
      success: true,
      data: { success: true, clearedThrough: 10 }
    });
    const c = new LogsController(bridge);
    c.attach();
    await c.clear();

    bridge.push(log('stale-1', { streamSequence: 10 }));
    bridge.push(log('fresh-1', { streamSequence: 11 }));

    expect(c.getState().logs.map((l) => l.id)).toEqual(['fresh-1']);
  });

  it('B13 restores previous logs on clear failure', async () => {
    bridge.logs.clear = async () => ({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'failed to clear' }
    });
    const c = new LogsController(bridge);
    await c.load();
    expect(c.getState().logs.length).toBeGreaterThan(0);
    const initialLogs = c.getState().logs;

    const success = await c.clear();
    expect(success).toBe(false);
    expect(c.getState().error).toBe('failed to clear');
    expect(c.getState().logs).toEqual(initialLogs);
  });

  it('R07 still applies clear cutoff when load is requested during clear', async () => {
    let finishClear!: (v: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.rows = [];
    bridge.logs.clear = () => new Promise((resolve) => { finishClear = resolve; });
    const c = new LogsController(bridge);
    c.attach();
    const clearing = c.clear();
    const loading = c.load({ level: 'ALL' });
    bridge.push(log('pre', { streamSequence: 5 }));
    bridge.push(log('post', { streamSequence: 6 }));
    finishClear({ success: true, data: { success: true, clearedThrough: 5 } });
    expect(await clearing).toBe(true);
    await loading;
    bridge.push(log('late-pre', { streamSequence: 4 }));
    expect(c.getState().logs.map((x) => x.id)).toEqual(['post']);
    expect(c.getState().isLoading).toBe(false);
  });

  it('R07 failed clear preserves old and intervening live rows', async () => {
    let finish!: (v: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    const c = new LogsController(bridge);
    c.attach();
    await c.load();
    bridge.logs.clear = () => new Promise((resolve) => { finish = resolve; });
    const clearing = c.clear();
    bridge.push(log('during', { streamSequence: 2 }));
    finish({ success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk' } });
    expect(await clearing).toBe(false);
    expect(c.getState().logs.map((x) => x.id)).toEqual(['during', 'log-1']);
    expect(c.getState().isLoading).toBe(false);
  });

  it('R07 duplicate clear shares single IPC call', async () => {
    let finishClear!: (v: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.logs.clear = () => {
      bridge.cleared += 1;
      return new Promise((resolve) => { finishClear = resolve; });
    };
    const c = new LogsController(bridge);
    const clear1 = c.clear();
    const clear2 = c.clear();
    expect(bridge.cleared).toBe(1);
    finishClear({ success: true, data: { success: true } });
    expect(await clear1).toBe(true);
    expect(await clear2).toBe(true);
  });

  it('R07 filter changes during clear applies to clear survivors and latest load', async () => {
    let finishClear!: (v: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.rows = [log('db-err', { status: 'ERROR' }), log('db-info', { status: 'INFO' })];
    bridge.logs.list = async (filter: unknown) => {
      bridge.lastFilter = filter;
      const query = filter as { level?: string } | undefined;
      const items = bridge.rows.filter((r) => !query?.level || r.status === query.level);
      return { success: true, data: { items, total: items.length } };
    };
    bridge.logs.clear = () => new Promise((resolve) => { finishClear = resolve; });
    const c = new LogsController(bridge);
    c.attach();
    const clearing = c.clear();
    const load1 = c.load({ level: 'INFO' });
    const load2 = c.load({ level: 'ERROR' });
    bridge.push(log('push-info', { status: 'INFO', streamSequence: 10, createdAt: '2026-09-01T03:32:32.000Z' }));
    bridge.push(log('push-err', { status: 'ERROR', streamSequence: 11, createdAt: '2026-09-01T03:32:32.000Z' }));
    finishClear({ success: true, data: { success: true, clearedThrough: 5 } });
    expect(await clearing).toBe(true);
    await load1;
    await load2;
    // Survivor was push-err (level ERROR matches latest filter).
    // db-err from list also matches ERROR.
    expect(c.getState().logs.map((x) => x.id)).toEqual(['push-err', 'db-err']);
  });

  it('R07 clear rejection restores logs and intervening pushes', async () => {
    const c = new LogsController(bridge);
    c.attach();
    await c.load();
    bridge.logs.clear = () => Promise.reject(new Error('IPC crash'));
    const clearing = c.clear();
    bridge.push(log('push-crash', { streamSequence: 2, createdAt: '2026-09-01T03:32:32.000Z' }));
    expect(await clearing).toBe(false);
    expect(c.getState().logs.map((x) => x.id)).toEqual(['push-crash', 'log-1']);
    expect(c.getState().error).toBe('IPC crash');
  });

  it('R07 live entries pushed while paused during clear are discarded', async () => {
    let finishClear!: (v: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.logs.clear = () => new Promise((resolve) => { finishClear = resolve; });
    const c = new LogsController(bridge);
    c.attach();
    const clearing = c.clear();
    c.setPaused(true);
    bridge.push(log('paused-push', { streamSequence: 10 }));
    finishClear({ success: true, data: { success: true, clearedThrough: 5 } });
    await clearing;
    expect(c.getState().logs).toEqual([]);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  type ClearReply = Awaited<ReturnType<ILogsBridge['logs']['clear']>>;
  type ListReply = Awaited<ReturnType<ILogsBridge['logs']['list']>>;
  const listReply = (...items: CanonicalRuntimeLog[]): ListReply => ({
    success: true, data: { items, total: items.length }
  });

  it('S02 only normalizes incoming logs and retains existing views', async () => {
    bridge.rows = Array.from({ length: 1000 }, (_, i) => log('old-' + i, {
      createdAt: new Date(1_700_000_000_000 + i).toISOString()
    }));
    const c = new LogsController(bridge);
    c.attach();
    await c.load();
    const retained = c.getState().logs.find(row => row.id === 'old-999');
    const incoming = Array.from({ length: 100 }, (_, i) => log('new-' + i, {
      createdAt: new Date(1_700_000_001_000 + i).toISOString()
    }));
    const parse = vi.spyOn(Date, 'parse');
    const format = vi.spyOn(Date.prototype, 'toTimeString');
    const sort = vi.spyOn(Array.prototype, 'sort');
    let counts = { parses: 0, formats: 0, sorts: 0 };
    try {
      for (const entry of incoming) bridge.push(entry);
      counts = {
        parses: parse.mock.calls.length,
        formats: format.mock.calls.length,
        sorts: sort.mock.calls.length
      };
    } finally {
      parse.mockRestore();
      format.mockRestore();
      sort.mockRestore();
      c.dispose();
    }
    expect(counts.sorts).toBe(0);
    expect(counts.parses).toBeLessThanOrEqual(incoming.length);
    expect(counts.formats).toBeLessThanOrEqual(incoming.length);
    expect(c.getState().logs.find(row => row.id === 'old-999')).toBe(retained);
    expect(c.getState().logs).toHaveLength(1000);
  });

  it.each(['failure', 'rejection'] as const)(
    'S04 preserves preclear unflushed push through %s and refresh',
    async mode => {
      bridge.rows = [];
      const c = new LogsController(bridge);
      c.attach();
      await c.load();
      const item = log('preclear-live', { streamSequence: 1 });
      bridge.push(item);
      const reply = deferred<ClearReply>();
      bridge.logs.clear = () => reply.promise;
      const clearing = c.clear();
      const loading = c.load({ level: 'ALL' });
      if (mode === 'failure') {
        reply.resolve({
          success: false,
          error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk' }
        });
      } else {
        reply.reject(new Error('disk'));
      }
      expect(await clearing).toBe(false);
      await loading;
      expect(c.getState().logs.map(row => row.id)).toEqual([item.id]);
      expect(c.getState().error).toBe('disk');
      expect(c.getState().isLoading).toBe(false);
      bridge.rows = [item];
      await c.load();
      bridge.rows = [];
      await c.load();
      expect(c.getState().logs).toEqual([]);
      c.dispose();
    }
  );

  it('F03 replay accepts new history/live but rejects old callbacks', async () => {
    const oldList = deferred<ListReply>();
    bridge.logs.list = () => oldList.promise;
    const c = new LogsController(bridge);
    c.attach();
    const oldListener = bridge.listeners[0];
    const loading = c.load();
    c.dispose();
    c.attach();
    c.attach();
    expect(bridge.listeners).toHaveLength(1);
    bridge.logs.list = async () => listReply(log('fresh'));
    await c.load();
    oldListener(log('stale-listener'));
    oldList.resolve(listReply(log('stale-history')));
    await loading;
    expect(c.getState().logs.map(row => row.id)).toEqual(['fresh']);
    expect(c.getState().isLoading).toBe(false);
    bridge.push(log('new-live', { createdAt: '2026-09-01T03:32:32.000Z' }));
    expect(c.getState().logs.map(row => row.id)).toEqual(['new-live', 'fresh']);
  });

  it('F03 replay preserves the in-flight clear barrier and cutoff', async () => {
    const reply = deferred<ClearReply>();
    let clearCalls = 0;
    let listCalls = 0;
    bridge.logs.clear = () => { clearCalls += 1; return reply.promise; };
    bridge.logs.list = async () => { listCalls += 1; return listReply(); };
    const c = new LogsController(bridge);
    c.attach();
    const original = c.clear();
    c.dispose();
    c.attach();
    const loading = c.load({ level: 'ALL' });
    const duplicate = c.clear();
    bridge.push(log('old', { streamSequence: 4 }));
    bridge.push(log('survivor', { streamSequence: 6 }));
    expect(clearCalls).toBe(1);
    expect(listCalls).toBe(0);
    reply.resolve({ success: true, data: { success: true, clearedThrough: 5 } });
    expect(await original).toBe(true);
    expect(await duplicate).toBe(true);
    await loading;
    expect(listCalls).toBe(1);
    expect(c.getState().logs.map(row => row.id)).toEqual(['survivor']);
    bridge.push(log('late-old', { streamSequence: 4 }));
    expect(c.getState().logs.map(row => row.id)).toEqual(['survivor']);
  });

  it.each(['failure', 'rejection'] as const)(
    'F04 %s with waiting load retains unflushed push and clear error',
    async mode => {
      const reply = deferred<ClearReply>();
      const c = new LogsController(bridge);
      c.attach();
      await c.load({ level: 'ALL' });
      bridge.logs.clear = () => reply.promise;
      const clearing = c.clear();
      const loading = c.load({ level: 'ALL' });
      bridge.push(log('unflushed', {
        streamSequence: 2, createdAt: '2026-09-01T03:32:32.000Z'
      }));
      if (mode === 'failure') {
        reply.resolve({
          success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk' }
        });
      } else {
        reply.reject(new Error('disk'));
      }
      expect(await clearing).toBe(false);
      await loading;
      expect(c.getState().logs.map(row => row.id)).toEqual(['unflushed', 'log-1']);
      expect(c.getState().error).toBe('disk');
      expect(c.getState().isLoading).toBe(false);
    }
  );

  it.each(['failure', 'rejection'] as const)(
    'T12 preclear unconfirmed pushes survive dispose/attach when clear %s and SQL is empty',
    async (mode) => {
      const reply = deferred<ClearReply>();
      bridge.logs.clear = () => reply.promise;
      bridge.rows = [];

      const c = new LogsController(bridge);
      c.attach();
      bridge.push(log('preclear-1', { streamSequence: 1 }));
      expect(c.getState().logs.map(row => row.id)).toEqual(['preclear-1']);

      const clearing = c.clear();
      c.dispose();
      c.attach();
      const loading = c.load({ level: 'ALL' });

      if (mode === 'failure') {
        reply.resolve({
          success: false,
          error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk error' }
        });
      } else {
        reply.reject(new Error('disk error'));
      }

      expect(await clearing).toBe(false);
      await loading;

      expect(c.getState().logs.map(row => row.id)).toEqual(['preclear-1']);
    }
  );

  it('F04 failed clear applies latest filter without a second deletion', async () => {
    const reply = deferred<ClearReply>();
    let deletes = 0;
    bridge.logs.clear = () => { deletes += 1; return reply.promise; };
    bridge.logs.list = async filter => {
      const q = filter as { level?: string };
      return listReply(...bridge.rows.filter(row => !q.level || row.status === q.level));
    };
    const c = new LogsController(bridge);
    c.attach();
    await c.load();
    const clearing = c.clear();
    const older = c.load({ level: 'INFO' });
    const latest = c.load({ level: 'ERROR' });
    bridge.push(log('info', { streamSequence: 2 }));
    bridge.push(log('error', { status: 'ERROR', streamSequence: 3 }));
    reply.resolve({
      success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk' }
    });
    expect(await clearing).toBe(false);
    await Promise.all([older, latest]);
    expect(c.getState().logs.map(row => row.id)).toEqual(['error']);
    expect(c.getState().error).toBe('disk');
    expect(deletes).toBe(1);
  });

  it.each([{ level: 'ERROR' }, { email: 'other@example.test' }])(
    'F05 filters carry on every query and releases it after history confirms',
    async query => {
      const reply = deferred<ClearReply>();
      bridge.rows = [];
      bridge.logs.clear = () => reply.promise;
      const c = new LogsController(bridge);
      c.attach();
      const clearing = c.clear();
      const item = log('info-survivor', { status: 'INFO', streamSequence: 6 });
      bridge.push(item);
      reply.resolve({ success: true, data: { success: true, clearedThrough: 5 } });
      await clearing;
      await c.load(query);
      expect(c.getState().logs).toEqual([]);
      await c.load({ level: 'ALL' });
      await c.load({ level: 'ALL' });
      expect(c.getState().logs.map(row => row.id)).toEqual([item.id]);
      bridge.rows = [item];
      await c.load();
      expect(c.getState().logs.map(row => row.id)).toEqual([item.id]);
      bridge.rows = [];
      await c.load();
      expect(c.getState().logs).toEqual([]);
    }
  );

  it('G01 legacy clear reloads instead of preserving unsequenced preclear rows', async () => {
    const reply = deferred<ClearReply>();
    let lists = 0;
    bridge.logs.clear = () => reply.promise;
    bridge.logs.list = async () => { lists += 1; return listReply(log('post-db')); };
    const c = new LogsController(bridge);
    c.attach();
    const clearing = c.clear();
    bridge.push(log('pre-buffer'));
    expect(lists).toBe(0);
    reply.resolve({ success: true, data: { success: true } });
    expect(await clearing).toBe(true);
    expect(lists).toBe(1);
    expect(c.getState().logs.map(row => row.id)).toEqual(['post-db']);
  });

  it.each(['failure', 'rejection'] as const)(
    'G01 committed clear stays true when legacy refresh returns %s',
    async mode => {
      let deletes = 0;
      bridge.logs.clear = async () => {
        deletes += 1;
        return { success: true, data: { success: true } };
      };
      bridge.logs.list = async () => {
        if (mode === 'rejection') throw new Error('fixture IPC disconnected');
        return {
          success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'db' }
        };
      };
      const c = new LogsController(bridge);
      expect(await c.clear()).toBe(true);
      expect(deletes).toBe(1);
      expect(c.getState().isLoading).toBe(false);
      expect(c.getState().error).toContain('Không tải được');
    }
  );

  it('G01 deduplicates and sorts canonical time then id before cap', async () => {
    bridge.rows = [];
    const c = new LogsController(bridge, { maxLogs: 2 });
    c.attach();
    await c.load();
    bridge.push(log('b', { message: 'old b' }));
    bridge.push(log('a'));
    bridge.push(log('b', { message: 'latest b' }));
    bridge.push(log('z', { createdAt: '2026-08-31T03:32:31.000Z' }));
    expect(c.getState().logs.map(row => row.id)).toEqual(['a', 'b']);
    expect(c.getState().logs[1].message).toBe('latest b');
  });

  it('G01 keeps postreply pushes when a new filter supersedes legacy refresh', async () => {
    const firstList = deferred<ListReply>();
    const started = deferred<void>();
    let lists = 0;
    let deletes = 0;
    bridge.logs.clear = async () => {
      deletes += 1;
      return { success: true, data: { success: true } };
    };
    bridge.logs.list = () => {
      lists += 1;
      if (lists === 1) {
        started.resolve();
        return firstList.promise;
      }
      return Promise.resolve(listReply());
    };
    const c = new LogsController(bridge);
    c.attach();
    const clearing = c.clear();
    await started.promise;
    const latest = c.load({ level: 'ERROR' });
    bridge.push(log('unflushed-error', { status: 'ERROR', streamSequence: 6 }));
    firstList.resolve(listReply(log('obsolete-info')));
    expect(await clearing).toBe(true);
    await latest;
    expect(lists).toBe(2);
    expect(deletes).toBe(1);
    expect(c.getState().logs.map(row => row.id)).toEqual(['unflushed-error']);
    expect(c.getState().isLoading).toBe(false);
  });

  it('F03 disposed list completion does not notify', async () => {
    const reply = deferred<ListReply>();
    bridge.logs.list = () => reply.promise;
    const c = new LogsController(bridge);
    let notices = 0;
    c.subscribe(() => { notices += 1; });
    const loading = c.load();
    c.dispose();
    const before = notices;
    reply.resolve(listReply(log('late')));
    await loading;
    expect(notices).toBe(before);
  });
});

describe('T07-B: onReset sync in LogsController', () => {
  it('updates clearedThrough and filters logs with sequence <= cutoff', async () => {
    const c = new LogsController(bridge);
    await c.load();
    c.attach();

    const l1 = log('l1', { streamSequence: 10 });
    const l2 = log('l2', { streamSequence: 25 });
    bridge.push(l1);
    bridge.push(l2);

    expect(c.getState().logs.map((r) => r.id)).toEqual(['l1', 'l2', 'log-1']);

    bridge.pushReset({ clearedThrough: 20 });

    expect(c.getState().logs.map((r) => r.id)).toEqual(['l2']);
    c.dispose();
  });

  it('unsubscribes onReset when disposed', () => {
    const c = new LogsController(bridge);
    c.attach();
    expect(bridge.resetListeners).toHaveLength(1);

    c.dispose();
    expect(bridge.resetListeners).toHaveLength(0);
    expect(bridge.unsubscribed).toBe(2);
  });

  it('does not restore pre-reset SQL history without stream sequence', async () => {
    type Reply = Awaited<ReturnType<typeof bridge.logs.list>>;
    let resolve!: (r: Reply) => void;
    let calls = 0;
    bridge.logs.list = async () => {
      if (++calls === 1) return new Promise<Reply>((done) => { resolve = done; });
      return { success: true, data: { items: [], total: 0 } };
    };
    const controller = new LogsController(bridge);
    controller.attach();
    const loading = controller.load();
    bridge.pushReset({ clearedThrough: 5 });
    resolve({ success: true, data: { items: [log('old-db')], total: 1 } });
    await loading;
    await Promise.resolve();
    expect(controller.getState().logs.map((row) => row.id)).not.toContain('old-db');
    expect(calls).toBe(2);
    controller.dispose();
  });

  it('F05 (AG05): Clear pending -> new reset 10 -> clear rejects: does not restore pre-clear rows and does not overwrite reset error', async () => {
    let rejectClear!: (err: Error) => void;
    bridge.logs.clear = () => new Promise((_, reject) => { rejectClear = reject; });

    const controller = new LogsController(bridge);
    controller.attach();
    bridge.push(log('preclear-1', { streamSequence: 5 }));
    expect(controller.getState().logs.map((r) => r.id)).toContain('preclear-1');

    const clearing = controller.clear();

    // Reset arrives while clear is in-flight
    bridge.pushReset({ clearedThrough: 10 });
    expect(controller.getState().logs.map((r) => r.id)).not.toContain('preclear-1');
    expect(controller.getState().error).toBeNull();

    // Clear operation fails
    rejectClear(new Error('Disk write error'));
    await clearing;

    // Previous preclear rows MUST NOT be restored, error remains null
    expect(controller.getState().logs.map((r) => r.id)).not.toContain('preclear-1');
    expect(controller.getState().error).toBeNull();
    controller.dispose();
  });

  it('F05 (AG05): duplicate reset event does not discard fresh post-reset unsequenced SQL', async () => {
    const controller = new LogsController(bridge);
    controller.attach();
    bridge.pushReset({ clearedThrough: 5 });

    bridge.rows = [log('fresh-sql')];
    await controller.load();
    expect(controller.getState().logs.map((r) => r.id)).toContain('fresh-sql');

    // Duplicate reset with same or lower cutoff (5)
    bridge.pushReset({ clearedThrough: 5 });
    // Fresh unsequenced SQL should not be discarded
    expect(controller.getState().logs.map((r) => r.id)).toContain('fresh-sql');
    controller.dispose();
  });

  it('keeps fresh history between reset event and Clear reply', async () => {
    let resolveClear!: (r: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.logs.clear = vi.fn().mockImplementation(() => new Promise((r) => { resolveClear = r; }));
    const controller = new LogsController(bridge);
    controller.attach();
    await controller.load();
    const clearPromise = controller.clear();

    // While clear is pending, a reset event arrives and database has fresh rows
    bridge.rows = [log('fresh-sql', { message: 'fresh SQL log' })];
    bridge.pushReset({ clearedThrough: 50 });
    await vi.waitFor(() => {
      expect(controller.getState().logs.map((l) => l.message)).toEqual(['fresh SQL log']);
    });

    // Clear reply arrives for the older/same epoch
    resolveClear({ success: true, data: { success: true, clearedThrough: 50 } });
    await clearPromise;
    expect(controller.getState().logs.map((l) => l.message)).toEqual(['fresh SQL log']);
    controller.dispose();
  });

  it('N07: old Clear failure after reset event does not wipe fresh history or publish old error', async () => {
    let resolve!: (r: Awaited<ReturnType<ILogsBridge['logs']['clear']>>) => void;
    bridge.logs.clear = () => new Promise((done) => { resolve = done; });
    const controller = new LogsController(bridge);
    controller.attach();
    await controller.load();
    const clearing = controller.clear();
    bridge.rows = [log('fresh-db')];
    bridge.pushReset({ clearedThrough: 5 });
    await Promise.resolve();
    expect(controller.getState().logs.map((row) => row.id)).toContain('fresh-db');
    resolve({ success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'OLD_CLEAR' } });
    expect(await clearing).toBe(false);
    expect(controller.getState().logs.map((row) => row.id)).toContain('fresh-db');
    expect(controller.getState().error).not.toBe('OLD_CLEAR');
    controller.dispose();
  });
});
