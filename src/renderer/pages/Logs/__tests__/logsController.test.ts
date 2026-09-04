import { describe, it, expect, beforeEach } from 'vitest';
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
    clear: async (): Promise<IpcEnvelope<{ success: boolean }>> => {
      this.cleared += 1;
      return { success: true, data: { success: true } };
    },
    onEntry: (listener: (entry: CanonicalRuntimeLog) => void): (() => void) => {
      this.listeners.push(listener);
      return () => { this.unsubscribed += 1; };
    }
  };

  push(entry: CanonicalRuntimeLog): void {
    for (const listener of this.listeners) listener(entry);
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

    bridge.push(log('log-2'));
    bridge.push(log('log-3'));

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

    bridge.push(log('log-1'));
    bridge.push(log('log-2'));
    bridge.push(log('log-3'));

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

    expect(bridge.unsubscribed).toBe(1);
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
});
