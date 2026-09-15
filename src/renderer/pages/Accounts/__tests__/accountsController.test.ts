import { describe, it, expect, beforeEach } from 'vitest';
import { AccountsController, toViewAccount, MASKED_SECRET, dateFilterToCreatedFrom, type IAccountsBridge } from '../accountsController';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type {
  AccountCreateInputDTO,
  AccountListItemDTO,
  AccountUpdateInputDTO
} from '../../../../shared/schemas/account.schema';
import { IpcContractRegistry } from '../../../../shared/contracts/api';
import type {
  AccountExportRequestDTO,
  AccountExportResultDTO
} from '../../../../shared/schemas/account-export.schema';
import type {
  AccountTasksRequestDTO,
  AccountTasksResponseDTO
} from '../../../../shared/schemas/account-task.schema';

function dto(overrides: Partial<AccountListItemDTO> = {}): AccountListItemDTO {
  return {
    id: 'acc-1',
    email: 'worker@x.com',
    emailProvider: 'gmail94',
    hasEmailPassword: true,
    hasPasswordCapcut: true,
    hasEmailData: true,
    credit: 120,
    subscription: 'Pro 1Y',
    status: 'active',
    automationStep: null,
    proxy: '1.2.3.4:8080',
    browserProvider: 'multilogin',
    browserProfileId: 'ML-001',
    notes: 'main',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T11:00:00.000Z',
    ...overrides
  };
}

class FakeBridge implements IAccountsBridge {
  public created: AccountCreateInputDTO[] = [];
  public updated: Array<{ id: string; data: AccountUpdateInputDTO }> = [];
  public removed: string[][] = [];
  public rows: AccountListItemDTO[] = [dto()];
  public listFails = false;
  /** Request cuối cùng trang Accounts gửi đi — để đối chiếu contract THẬT. */
  public lastFilter: unknown = null;
  public lastExportRequest: AccountExportRequestDTO | null = null;
  public exportResult: AccountExportResultDTO = {
    canceled: false,
    filePath: 'C:/Users/me/Downloads/accounts-20260904-1020.xlsx',
    exportedCount: 12
  };
  public exportError: string | null = null;
  public lastTasksRequest: AccountTasksRequestDTO | null = null;
  public tasksError: string | null = null;

  accounts = {
    list: async (filter: unknown): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
      this.lastFilter = filter;
      if (this.listFails) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'db down' } };
      }
      return { success: true, data: { items: this.rows, total: this.rows.length } };
    },
    create: async (input: AccountCreateInputDTO): Promise<IpcEnvelope<{ id: string }>> => {
      this.created.push(input);
      return { success: true, data: { id: 'acc-new' } };
    },
    update: async (id: string, data: AccountUpdateInputDTO): Promise<IpcEnvelope<{ success: boolean }>> => {
      this.updated.push({ id, data });
      return { success: true, data: { success: true } };
    },
    remove: async (ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>> => {
      this.removed.push(ids);
      return { success: true, data: { deletedCount: ids.length } };
    },
    export: async (request: AccountExportRequestDTO): Promise<IpcEnvelope<AccountExportResultDTO>> => {
      this.lastExportRequest = request;
      if (this.exportError) {
        return { success: false, error: { code: 'CONFIG_ERROR', message: this.exportError } };
      }
      return { success: true, data: this.exportResult };
    },
    tasks: async (request: AccountTasksRequestDTO): Promise<IpcEnvelope<AccountTasksResponseDTO>> => {
      this.lastTasksRequest = request;
      if (this.tasksError) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: this.tasksError } };
      }
      return {
        success: true,
        data: {
          items: [],
          doneCount: 3,
          creditsEarned: 30,
          verification: {
            state: 'missing',
            runId: null,
            observedAt: null,
            serverTotal: 0,
            serverDone: 0
          }
        }
      };
    }
  };
}

let bridge: FakeBridge;

beforeEach(() => {
  bridge = new FakeBridge();
});

describe('toViewAccount', () => {
  /**
   * Audit 04/09/2026: main CÓ gửi `hasPasswordCapcut` (`AccountRepository.ts:262`)
   * nhưng `toViewAccount` vứt đi, trong khi lưới vẫn đọc `accessorKey: 'password'`
   * (`columns.tsx:55`) ⇒ cột Password luôn trống kể cả với account đã có mật khẩu.
   * Dashboard làm đúng (`Dashboard/columns.tsx:65`) — đây là copy cách đó.
   */
  it('hiện dấu che khi account CÓ mật khẩu CapCut', () => {
    expect(toViewAccount(dto({ hasPasswordCapcut: true }), 0).password).toBe(MASKED_SECRET);
  });

  it('để trống khi account KHÔNG có mật khẩu', () => {
    expect(toViewAccount(dto({ hasPasswordCapcut: false }), 0).password).toBe('');
  });

  it('numbers the row and never exposes a password value', () => {
    const view = toViewAccount(dto({ hasPasswordCapcut: true }), 0);

    expect(view.stt).toBe(1);
    /**
     * Ý của test này là §13: giá trị mật khẩu THẬT không bao giờ rời main process.
     * Bản cũ khẳng định `undefined` — nhưng chính vì thế cột Password luôn trống.
     * Dấu che thoả được cả hai: lưới có gì để hiện, mà vẫn không có secret nào.
     */
    expect(view.password).toBe(MASKED_SECRET);
    expect(view.password).not.toMatch(/[A-Za-z0-9]/);
    expect(view.email).toBe('worker@x.com');
  });

  it('shows a masked marker for stored email data and nothing when absent', () => {
    expect(toViewAccount(dto({ hasEmailData: true }), 0).fullData).toBe('••••••••');
    expect(toViewAccount(dto({ hasEmailData: false }), 0).fullData).toBe('');
  });

  it('joins the browser provider and profile for display', () => {
    expect(toViewAccount(dto(), 0).browserProfile).toBe('multilogin / ML-001');
    expect(toViewAccount(dto({ browserProfileId: null }), 0).browserProfile).toBe('multilogin');
    expect(toViewAccount(dto({ browserProvider: null, browserProfileId: null }), 0).browserProfile).toBe('');
  });

  it('keeps credit, subscription and notes for the grid', () => {
    const view = toViewAccount(dto(), 4);
    expect(view.stt).toBe(5);
    expect(view.credit).toBe(120);
    expect(view.subscription).toBe('Pro 1Y');
    expect(view.notes).toBe('main');
  });
});

describe('AccountsController.load', () => {
  it('maps every row into a view model', async () => {
    const controller = new AccountsController(bridge);

    await controller.load();

    const state = controller.getState();
    expect(state.isLoading).toBe(false);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].stt).toBe(1);
    expect(state.error).toBeNull();
  });

  it('reports a load failure', async () => {
    bridge.listFails = true;
    const controller = new AccountsController(bridge);

    await controller.load();

    expect(controller.getState().error).toContain('tài khoản');
  });
});

describe('AccountsController.create', () => {
  it('sends the typed create payload and reloads', async () => {
    const controller = new AccountsController(bridge);

    const created = await controller.create({
      email: 'new@x.com',
      provider: 'Gmail',
      password: 'capcutpass',
      emailPassword: 'mailpass',
      fullData: 'raw|data',
      credit: 10,
      subscription: 'Trial 7D',
      status: 'active',
      notes: 'note',
      proxy: '9.9.9.9:1',
      browserProfile: 'multilogin / X',
      createdAt: '',
      updatedAt: ''
    });

    expect(created).toBe(true);
    expect(bridge.created[0]).toMatchObject({
      email: 'new@x.com',
      emailProvider: 'Gmail',
      passwordCapcut: 'capcutpass',
      emailPassword: 'mailpass',
      emailData: 'raw|data',
      credit: 10,
      status: 'active',
      browserProvider: 'multilogin',
      browserProfileId: 'X'
    });
  });

  it('omits an empty secret instead of sending an empty string', async () => {
    const controller = new AccountsController(bridge);

    await controller.create({
      email: 'new@x.com',
      provider: 'Gmail',
      password: '',
      fullData: '',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.created[0].emailPassword).toBeUndefined();
    expect(bridge.created[0].emailData).toBeUndefined();
  });
});

describe('AccountsController.update', () => {
  it('replaces a secret only when the field carries a new value', async () => {
    const controller = new AccountsController(bridge);

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'worker@x.com',
      provider: 'gmail94',
      password: 'brand-new',
      emailPassword: 'mail-new',
      fullData: '',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    const sent = bridge.updated[0];
    expect(sent.id).toBe('acc-1');
    expect(sent.data.passwordCapcutOp).toEqual({ action: 'replace', value: 'brand-new' });
    expect(sent.data.emailPasswordOp).toEqual({ action: 'replace', value: 'mail-new' });
    expect(sent.data.emailDataOp).toEqual({ action: 'keep' });
  });

  it('keeps the masked placeholder from being written back as a secret', async () => {
    const controller = new AccountsController(bridge);

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'worker@x.com',
      provider: 'gmail94',
      fullData: '••••••••',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.updated[0].data.emailDataOp).toEqual({ action: 'keep' });
  });

  it('passes through the non-secret fields', async () => {
    const controller = new AccountsController(bridge);

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'changed@x.com',
      provider: 'dongvanfb',
      credit: 55,
      subscription: 'Pro 1Y',
      notes: 'updated',
      status: 'done',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.updated[0].data).toMatchObject({
      email: 'changed@x.com',
      emailProvider: 'dongvanfb',
      credit: 55,
      subscription: 'Pro 1Y',
      notes: 'updated',
      status: 'done'
    });
  });
});

describe('AccountsController.remove', () => {
  it('deletes the selected ids', async () => {
    const controller = new AccountsController(bridge);

    const removed = await controller.remove(['acc-1', 'acc-2']);

    expect(removed).toBe(true);
    expect(bridge.removed).toEqual([['acc-1', 'acc-2']]);
  });

  it('ignores an empty selection', async () => {
    const controller = new AccountsController(bridge);

    const removed = await controller.remove([]);

    expect(removed).toBe(false);
    expect(bridge.removed).toEqual([]);
  });

  /**
   * Cùng lớp lỗi đã hạ tab Logs ngày 04/09/2026: renderer gửi `pageSize` lớn hơn
   * mức `.strict()` schema cho phép ⇒ IPC trả VALIDATION_ERROR ⇒ trang trống mà
   * chỉ hiện một câu lỗi chung. `pageSize` của trang Accounts đang bằng ĐÚNG mức
   * trần (500), nên chỉ cần ai nhích lên một là vỡ y như vậy — mà không test nào
   * bắt được. Test này đối chiếu request THẬT với contract THẬT, không mock.
   */
  it('request tải danh sách phải qua được contract accounts.list', async () => {
    const controller = new AccountsController(bridge);

    await controller.load();

    const parsed = IpcContractRegistry.accounts.list.request.safeParse(bridge.lastFilter);
    expect(parsed.success ? 'OK' : parsed.error.issues[0].message).toBe('OK');
  });

  /**
   * Audit 04/09/2026: SQL lọc server-side đã viết đủ (`AccountRepository.ts:236-248`)
   * và contract đã có `query`/`status`/`emailProvider`, nhưng renderer KHÔNG gửi —
   * nó lọc phía client trên 500 dòng đầu. Có 2000 account, cái cần tìm nằm ở dòng
   * 900, gõ email vào ô tìm → "không có kết quả", trong khi DB có.
   */
  it('đẩy từ khoá tìm kiếm xuống server', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ query: 'worker@x.com' });

    expect(bridge.lastFilter).toMatchObject({ query: 'worker@x.com' });
    const parsed = IpcContractRegistry.accounts.list.request.safeParse(bridge.lastFilter);
    expect(parsed.success).toBe(true);
  });

  it('đẩy bộ lọc trạng thái và nhà cung cấp xuống server', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ status: 'done', emailProvider: 'gmail94' });

    expect(bridge.lastFilter).toMatchObject({ status: 'done', emailProvider: 'gmail94' });
  });

  it('bỏ hẳn khoá lọc khi giá trị rỗng, không gửi chuỗi trống xuống SQL', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ query: '   ', status: '', emailProvider: undefined });

    expect(bridge.lastFilter).not.toHaveProperty('query');
    expect(bridge.lastFilter).not.toHaveProperty('status');
    expect(bridge.lastFilter).not.toHaveProperty('emailProvider');
  });

  it('nhớ bộ lọc để lần tải lại sau khi sửa/xoá vẫn giữ nguyên', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ query: 'abc' });
    await controller.load();

    expect(bridge.lastFilter).toMatchObject({ query: 'abc' });
  });
});

describe('dateFilterToCreatedFrom', () => {
  const now = new Date('2026-09-04T08:30:00.000Z');

  it('"all" nghĩa là không lọc ngày', () => {
    expect(dateFilterToCreatedFrom('all', now)).toBeUndefined();
  });

  it('"today" lấy mốc đầu ngày, không phải thời điểm hiện tại', () => {
    const from = dateFilterToCreatedFrom('today', now);
    expect(from).toBeDefined();
    expect(new Date(from as string).getHours()).toBe(0);
    expect(new Date(from as string).getMinutes()).toBe(0);
  });

  it('"7days" và "30days" lùi đúng số ngày', () => {
    const seven = new Date(dateFilterToCreatedFrom('7days', now) as string);
    const thirty = new Date(dateFilterToCreatedFrom('30days', now) as string);

    expect(Math.round((now.getTime() - seven.getTime()) / 86_400_000)).toBe(7);
    expect(Math.round((now.getTime() - thirty.getTime()) / 86_400_000)).toBe(30);
  });

  it('giá trị lạ thì không lọc, không ném', () => {
    expect(dateFilterToCreatedFrom('tuần này', now)).toBeUndefined();
  });
});

describe('AccountsController — bộ lọc ngày tạo', () => {
  it('gửi createdFrom xuống server và khớp contract thật', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ createdFrom: '2026-09-01T00:00:00.000Z' });

    expect(bridge.lastFilter).toMatchObject({ createdFrom: '2026-09-01T00:00:00.000Z' });
    const parsed = IpcContractRegistry.accounts.list.request.safeParse(bridge.lastFilter);
    expect(parsed.success).toBe(true);
  });

  it('không gửi khoá createdFrom khi người dùng không lọc ngày', async () => {
    const controller = new AccountsController(bridge);

    await controller.load({ query: 'abc' });

    expect(bridge.lastFilter).not.toHaveProperty('createdFrom');
  });
});

describe('AccountsController — hai loại mật khẩu và Browser/Profile', () => {
  /**
   * Audit 04/09/2026: ô "Password" của drawer đi vào `emailPassword`, trong khi
   * lưới lại đọc `hasPasswordCapcut` ⇒ nhập mật khẩu xong cột vẫn trống. Nặng hơn:
   * "Password CapCut" là CỘT #2 của bản xuất (§21) mà không màn hình nào nhập được.
   */
  it('mật khẩu CapCut nhập từ drawer đi vào passwordCapcut, không phải emailPassword', async () => {
    const controller = new AccountsController(bridge);

    await controller.create({
      email: 'new@x.com',
      provider: 'gmail94',
      password: 'CapcutPass#1',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.created[0].passwordCapcut).toBe('CapcutPass#1');
    expect(bridge.created[0].emailPassword).toBeUndefined();
  });

  it('mật khẩu hộp thư đi vào emailPassword, tách khỏi mật khẩu CapCut', async () => {
    const controller = new AccountsController(bridge);

    await controller.create({
      email: 'new@x.com',
      provider: 'gmail94',
      password: 'CapcutPass#1',
      emailPassword: 'MailPass#2',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.created[0].passwordCapcut).toBe('CapcutPass#1');
    expect(bridge.created[0].emailPassword).toBe('MailPass#2');
  });

  it('tách "Multilogin / ML-001" thành browserProvider và browserProfileId', async () => {
    const controller = new AccountsController(bridge);

    await controller.create({
      email: 'new@x.com',
      provider: 'gmail94',
      browserProfile: 'Multilogin / ML-001',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.created[0].browserProvider).toBe('Multilogin');
    expect(bridge.created[0].browserProfileId).toBe('ML-001');
  });

  it('chỉ có tên browser, không có profile thì vẫn giữ được tên browser', async () => {
    const controller = new AccountsController(bridge);

    await controller.create({
      email: 'new@x.com',
      provider: 'gmail94',
      browserProfile: 'Multilogin',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.created[0].browserProvider).toBe('Multilogin');
    expect(bridge.created[0].browserProfileId).toBeUndefined();
  });

  it('sửa account giữ lại Browser/Profile thay vì xoá trắng', async () => {
    const controller = new AccountsController(bridge);

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'worker@x.com',
      provider: 'gmail94',
      browserProfile: 'Multilogin / ML-007',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.updated[0].data.browserProvider).toBe('Multilogin');
    expect(bridge.updated[0].data.browserProfileId).toBe('ML-007');
  });

  it('sửa mật khẩu CapCut gửi passwordCapcutOp, không gửi emailPasswordOp', async () => {
    const controller = new AccountsController(bridge);

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'worker@x.com',
      provider: 'gmail94',
      password: 'brand-new',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    expect(bridge.updated[0].data.passwordCapcutOp).toEqual({ action: 'replace', value: 'brand-new' });
    expect(bridge.updated[0].data.emailPasswordOp).toEqual({ action: 'keep' });
  });

  it('hiện dấu che riêng cho mật khẩu hộp thư đã lưu', () => {
    expect(toViewAccount(dto({ hasEmailPassword: true }), 0).emailPassword).toBe(MASKED_SECRET);
    expect(toViewAccount(dto({ hasEmailPassword: false }), 0).emailPassword).toBe('');
  });
});

describe('AccountsController.loadTasks', () => {
  it('trả về tiến độ nhiệm vụ của đúng account được hỏi', async () => {
    const controller = new AccountsController(bridge);

    const result = await controller.loadTasks('acc-7');

    expect(bridge.lastTasksRequest).toEqual({ accountId: 'acc-7' });
    expect(result).toEqual({
      items: [],
      doneCount: 3,
      creditsEarned: 30,
      verification: {
        state: 'missing',
        runId: null,
        observedAt: null,
        serverTotal: 0,
        serverDone: 0
      }
    });
  });

  it('lỗi thì trả null và ghi câu lỗi vào state, không ném', async () => {
    bridge.tasksError = 'DB đang khoá';
    const controller = new AccountsController(bridge);

    const result = await controller.loadTasks('acc-7');

    expect(result).toBeNull();
    expect(controller.getState().error).toBe('DB đang khoá');
  });
});

describe('AccountsController.exportAccounts', () => {
  it('gửi request khớp contract THẬT của kênh accounts:export', async () => {
    const controller = new AccountsController(bridge);

    await controller.exportAccounts({
      format: 'XLSX',
      fields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
      scope: { kind: 'checked', ids: ['acc-1', 'acc-2'] }
    });

    // Cùng cách kiểm của trang Logs: đối chiếu request thật với contract thật,
    // vì đúng loại lệch này (`pageSize` vượt `.max`) từng làm trắng cả một trang.
    const parsed = IpcContractRegistry.accounts.export.request.safeParse(bridge.lastExportRequest);
    expect(parsed.success).toBe(true);
  });

  it('xuất xong thì trả về đường dẫn và số dòng để hiện cho người dùng', async () => {
    const controller = new AccountsController(bridge);

    const outcome = await controller.exportAccounts({
      format: 'XLSX',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(outcome).toEqual({
      kind: 'done',
      filePath: 'C:/Users/me/Downloads/accounts-20260904-1020.xlsx',
      exportedCount: 12
    });
  });

  it('người dùng bấm Cancel ở hộp thoại lưu file thì KHÔNG coi là lỗi', async () => {
    bridge.exportResult = { canceled: true, filePath: null, exportedCount: 0 };
    const controller = new AccountsController(bridge);

    const outcome = await controller.exportAccounts({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(outcome).toEqual({ kind: 'canceled' });
    expect(controller.getState().error).toBeNull();
  });

  it('giữ nguyên câu báo lỗi của main process, không thay bằng câu chung', async () => {
    bridge.exportError = 'Không có tài khoản nào khớp phạm vi đã chọn.';
    const controller = new AccountsController(bridge);

    const outcome = await controller.exportAccounts({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(outcome).toEqual({
      kind: 'error',
      message: 'Không có tài khoản nào khớp phạm vi đã chọn.'
    });
  });

  it('không tải lại danh sách sau khi xuất — xuất file không đổi dữ liệu', async () => {
    const controller = new AccountsController(bridge);
    bridge.lastFilter = null;

    await controller.exportAccounts({ format: 'TXT', fields: ['email'], scope: { kind: 'all' } });

    expect(bridge.lastFilter).toBeNull();
  });

  it('bắt lỗi khi bridge.accounts.export bị reject và trả về kind error', async () => {
    bridge.accounts.export = async () => {
      throw new Error('IPC transport disconnected');
    };
    const controller = new AccountsController(bridge);

    const outcome = await controller.exportAccounts({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(outcome).toEqual({
      kind: 'error',
      message: 'IPC transport disconnected'
    });
  });

  it('bắt lỗi khi bridge.accounts.tasks bị reject và ghi nhận vào state error', async () => {
    bridge.accounts.tasks = async () => {
      throw new Error('IPC transport disconnected');
    };
    const controller = new AccountsController(bridge);

    const result = await controller.loadTasks('acc-fail');

    expect(result).toBeNull();
    expect(controller.getState().error).toBe('IPC transport disconnected');
  });

  it('UI-01 requests page two without truncating the dataset', async () => {
    const seen: unknown[] = [];
    bridge.accounts.list = async (filter) => {
      seen.push(filter);
      return { success: true, data: { items: [dto()], total: 1201 } };
    };
    const c = new AccountsController(bridge, 50);
    await c.load({}, 2);
    expect(seen).toContainEqual({ page: 2, pageSize: 50 });
  });

  it('UI-03 nested false is not a successful update', async () => {
    bridge.accounts.update = async () => ({ success: true, data: { success: false } });
    const c = new AccountsController(bridge);
    expect(await c.update('missing', toViewAccount(dto(), 0))).toBe(false);
  });

  it('B12 late page two never overwrites page three', async () => {
    const replies: Array<(v: IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>) => void> = [];
    bridge.accounts.list = () => new Promise((resolve) => replies.push(resolve));
    const c = new AccountsController(bridge, 50);
    const p2 = c.load({}, 2);
    const p3 = c.load({}, 3);
    replies[1]({ success: true, data: { items: [dto({ id: 'p3' })], total: 150 } });
    await p3;
    replies[0]({ success: true, data: { items: [dto({ id: 'p2' })], total: 150 } });
    await p2;
    expect(c.getState().accounts[0].id).toBe('p3');
    expect(c.getState().page).toBe(3);
  });

  it('F13 (G10): preserves exact whitespace in passwords for create and update', async () => {
    const controller = new AccountsController(bridge);
    await controller.create({
      email: '  whitespace@x.com  ',
      provider: 'gmail94',
      password: '  A|B  ',
      emailPassword: '  C D  ',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(bridge.created[0].email).toBe('whitespace@x.com');
    expect(bridge.created[0].passwordCapcut).toBe('  A|B  ');
    expect(bridge.created[0].emailPassword).toBe('  C D  ');

    await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: '  whitespace@x.com  ',
      provider: 'gmail94',
      password: '  NEW PWD  ',
      emailPassword: '  NEW MAIL PWD  ',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(bridge.updated[0].data.passwordCapcutOp).toEqual({ action: 'replace', value: '  NEW PWD  ' });
    expect(bridge.updated[0].data.emailPasswordOp).toEqual({ action: 'replace', value: '  NEW MAIL PWD  ' });
  });

  it('F14 (G10): catches rejected IPC promises on create, update, remove and sets error', async () => {
    bridge.accounts.create = async () => { throw new Error('DEMO_IPC_DOWN'); };
    bridge.accounts.update = async () => { throw new Error('DEMO_IPC_DOWN'); };
    bridge.accounts.remove = async () => { throw new Error('DEMO_IPC_DOWN'); };

    const controller = new AccountsController(bridge);
    const createResult = await controller.create({
      email: 'a@x.com',
      provider: 'gmail94',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(createResult).toBe(false);
    expect(controller.getState().error).toBe('DEMO_IPC_DOWN');

    const updateResult = await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'a@x.com',
      provider: 'gmail94',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(updateResult).toBe(false);
    expect(controller.getState().error).toBe('DEMO_IPC_DOWN');

    const removeResult = await controller.remove(['acc-1']);
    expect(removeResult).toBe(false);
    expect(controller.getState().error).toBe('DEMO_IPC_DOWN');
  });

  it('F14 (G10): sets warning when mutation succeeds but subsequent load fails', async () => {
    const controller = new AccountsController(bridge);
    bridge.listFails = true;

    // create succeeds, but subsequent load fails
    const createResult = await controller.create({
      email: 'a@x.com',
      provider: 'gmail94',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(createResult).toBe(true);
    expect(controller.getState().warning).toContain('chưa tải lại được danh sách');

    // update succeeds, but subsequent load fails
    const updateResult = await controller.update('acc-1', {
      id: 'acc-1',
      stt: 1,
      email: 'a@x.com',
      provider: 'gmail94',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });
    expect(updateResult).toBe(true);
    expect(controller.getState().warning).toContain('chưa tải lại được danh sách');

    // remove succeeds, but subsequent load fails
    const removeResult = await controller.remove(['acc-1']);
    expect(removeResult).toBe(true);
    expect(controller.getState().warning).toContain('chưa tải lại được danh sách');
  });
});
