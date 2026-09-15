import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type {
  AccountCreateInputDTO,
  AccountListItemDTO,
  AccountStatus,
  AccountUpdateInputDTO,
  SecretOperation
} from '../../../shared/schemas/account.schema';
import type { Account } from '../../../shared/types/account';
import type {
  AccountExportRequestDTO,
  AccountExportResultDTO
} from '../../../shared/schemas/account-export.schema';
import type {
  AccountTasksRequestDTO,
  AccountTasksResponseDTO
} from '../../../shared/schemas/account-task.schema';
import { ACCOUNT_PAGE_SIZE_MAX } from '../../../shared/schemas/account.schema';

/** Placeholder shown for a stored secret. Never written back as a value. */
export const MASKED_SECRET = '••••••••';

/** Bộ lọc trang Accounts, đúng bộ khoá mà `AccountFilterSchema` nhận. */
export interface AccountsQuery {
  query?: string;
  status?: string;
  emailProvider?: string;
  browserProvider?: string;
  createdFrom?: string;
}

/**
 * Đổi lựa chọn "Ngày tạo" của toolbar thành mốc ISO gửi xuống server.
 *
 * Bản cũ ô này chỉ đổi state: không có khoá nào trong contract, không có SQL nào
 * dùng, mà vẫn bật chip "Active Filters" — người dùng tưởng đang lọc.
 * `today` là ĐẦU NGÀY theo giờ máy, không phải "24 giờ vừa qua".
 */
export function dateFilterToCreatedFrom(value: string, now: Date = new Date()): string | undefined {
  if (value === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  if (value === '7days') return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (value === '30days') return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return undefined;
}

/**
 * Bỏ khoá rỗng trước khi gửi. `AccountFilterSchema` cho phép chuỗi trống, nhưng
 * xuống tới SQL thì thành `LIKE '%%'` và `status = ''` — lọc ra 0 dòng thay vì
 * không lọc. `'all'` là giá trị của dropdown UI nghĩa là "không lọc".
 */
function cleanFilter(filter: AccountsQuery): AccountsQuery {
  const out: AccountsQuery = {};
  for (const key of ['query', 'status', 'emailProvider', 'browserProvider', 'createdFrom'] as const) {
    const value = filter[key]?.trim();
    if (value && value !== 'all') out[key] = value;
  }
  return out;
}

export interface IAccountsBridge {
  accounts: {
    list(filter: {
      page: number;
      pageSize: number;
      query?: string;
      status?: string;
      emailProvider?: string;
      browserProvider?: string;
      createdFrom?: string;
    }):
      Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>>;
    create(input: AccountCreateInputDTO): Promise<IpcEnvelope<{ id: string }>>;
    update(id: string, data: AccountUpdateInputDTO): Promise<IpcEnvelope<{ success: boolean }>>;
    remove(ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>>;
    export(request: AccountExportRequestDTO): Promise<IpcEnvelope<AccountExportResultDTO>>;
    tasks(request: AccountTasksRequestDTO): Promise<IpcEnvelope<AccountTasksResponseDTO>>;
  };
}

/** Kết quả một lượt xuất file, đủ ba nhánh mà UI phải nói khác nhau. */
export type ExportOutcome =
  | { kind: 'done'; filePath: string; exportedCount: number }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

export interface AccountsState {
  isLoading: boolean;
  error: string | null;
  warning: string | null;
  accounts: Account[];
  total: number;
  globalTotal: number;
  page: number;
}


/**
 * Maps a persisted account into the grid view model. Secrets stay in the main
 * process, so a stored value becomes a masked marker and passwords are omitted.
 */
export function toViewAccount(dto: AccountListItemDTO, index: number): Account {
  const browserProfile = [dto.browserProvider, dto.browserProfileId]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' / ');

  return {
    id: dto.id,
    stt: index + 1,
    email: dto.email,
    /**
     * Main gửi `hasPasswordCapcut` là boolean (§13: giá trị thật không bao giờ
     * rời main process). Bản cũ vứt nó đi trong khi lưới vẫn đọc `password`, nên
     * cột Password luôn trống kể cả với account đã có mật khẩu — Dashboard làm
     * đúng từ đầu (`Dashboard/columns.tsx`), đây là copy cách đó.
     */
    password: dto.hasPasswordCapcut ? MASKED_SECRET : '',
    emailPassword: dto.hasEmailPassword ? MASKED_SECRET : '',
    provider: dto.emailProvider,
    fullData: dto.hasEmailData ? MASKED_SECRET : '',
    proxy: dto.proxy ?? '',
    browserProfile,
    status: dto.status,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    notes: dto.notes ?? undefined,
    credit: dto.credit,
    subscription: dto.subscription ?? undefined
  };
}

/**
 * Tách ô "Browser / Profile" của drawer thành hai khoá mà contract nhận.
 * `toViewAccount` ghép chúng bằng ' / ' để hiện lên lưới, nên đây là đường về.
 * Bản cũ không gửi khoá nào cả ⇒ thêm/sửa account là mất luôn Browser/Profile.
 */
export function parseBrowserProfile(value: string | undefined): {
  browserProvider?: string;
  browserProfileId?: string;
} {
  const parts = (value ?? '').split('/').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return {};
  return {
    browserProvider: parts[0],
    browserProfileId: parts.length > 1 ? parts.slice(1).join(' / ') : undefined
  };
}

function secretOp(value: string | undefined): SecretOperation {
  const raw = value ?? '';
  const probe = raw.trim();
  if (probe.length === 0 || probe === MASKED_SECRET) {
    return { action: 'keep' };
  }
  return { action: 'replace', value: raw };
}

function optionalSecret(value: string | undefined): string | undefined {
  const raw = value ?? '';
  const probe = raw.trim();
  return probe.length === 0 || probe === MASKED_SECRET ? undefined : raw;
}

/** Owns the Accounts page data. All persistence goes through the preload bridge. */
export class AccountsController {
  private state: AccountsState = {
    isLoading: true,
    error: null,
    warning: null,
    accounts: [],
    total: 0,
    globalTotal: 0,
    page: 1
  };

  private readonly listeners = new Set<(state: AccountsState) => void>();
  /** Bộ lọc gần nhất, để `load()` sau khi sửa/xoá không nhảy về danh sách đầy. */
  private filter: AccountsQuery = {};
  private currentPage = 1;
  private requestToken = 0;

  constructor(
    private readonly bridge: IAccountsBridge,
    private readonly pageSize = ACCOUNT_PAGE_SIZE_MAX
  ) {}

  getState(): AccountsState {
    return this.state;
  }

  subscribe(listener: (state: AccountsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<AccountsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async load(filter?: AccountsQuery, page?: number): Promise<'loaded' | 'failed' | 'superseded'> {
    /**
     * Lọc chạy Ở SERVER. SQL đã viết đủ từ đầu (`AccountRepository.queryAccounts`)
     * nhưng bản cũ không gửi gì và lọc phía client trên 500 dòng đầu — có 2000
     * account thì cái nằm ở dòng 900 tìm không ra, dù DB có.
     *
     * Nhớ bộ lọc gần nhất để `load()` sau khi sửa/xoá không nhảy về danh sách đầy.
     * Khoá rỗng bị BỎ HẲN: schema `.strict()` chấp nhận chuỗi trống, nhưng gửi
     * xuống thì thành `LIKE '%%'` vô nghĩa.
     */
    if (filter) this.filter = filter;
    if (page !== undefined) this.currentPage = Math.max(1, page);

    const token = ++this.requestToken;
    const requestedPage = this.currentPage;
    const clean = cleanFilter(this.filter);
    const hasFilter = Object.keys(clean).length > 0;

    this.setState({ isLoading: true, error: null, warning: null });

    try {
      let globalTotal = this.state.globalTotal;
      if (hasFilter) {
        const globalResponse = await this.bridge.accounts.list({ page: 1, pageSize: 1 });
        if (token !== this.requestToken) return 'superseded';
        if (globalResponse.success) {
          globalTotal = globalResponse.data.total;
        }
      }

      const response = await this.bridge.accounts.list({
        page: requestedPage,
        pageSize: this.pageSize,
        ...clean
      });

      if (token !== this.requestToken) {
        return 'superseded';
      }

      if (!response.success) {
        this.setState({ isLoading: false, error: 'Không tải được danh sách tài khoản.' });
        return 'failed';
      }

      const total = response.data.total;
      if (!hasFilter) {
        globalTotal = total;
      }

      const maxPage = Math.max(1, Math.ceil(total / this.pageSize));
      if (total > 0 && requestedPage > maxPage) {
        return await this.load(undefined, maxPage);
      }

      this.currentPage = requestedPage;
      this.setState({
        isLoading: false,
        error: null,
        accounts: response.data.items.map(toViewAccount),
        total,
        globalTotal,
        page: requestedPage
      });
      return 'loaded';
    } catch (err: unknown) {
      if (token === this.requestToken) {
        this.setState({
          isLoading: false,
          error: err instanceof Error ? err.message : 'Không tải được danh sách tài khoản.'
        });
        return 'failed';
      }
      return 'superseded';
    }
  }

  async create(input: Omit<Account, 'id' | 'stt'>): Promise<boolean> {
    this.setState({ warning: null });
    const browser = parseBrowserProfile(input.browserProfile);
    const payload: AccountCreateInputDTO = {
      email: input.email.trim(),
      emailProvider: (input.provider || 'manual').trim(),
      /**
       * `password` của view model là MẬT KHẨU CAPCUT (§21 cột #2) — bản cũ gửi nó
       * vào `emailPassword` trong khi lưới đọc `hasPasswordCapcut`, nên nhập xong
       * cột vẫn trống và bản xuất không bao giờ có cột #2.
       */
      passwordCapcut: optionalSecret(input.password),
      emailPassword: optionalSecret(input.emailPassword),
      emailData: optionalSecret(input.fullData),
      credit: input.credit ?? 0,
      subscription: input.subscription,
      status: (input.status ?? 'active') as AccountStatus,
      proxy: input.proxy || undefined,
      browserProvider: browser.browserProvider,
      browserProfileId: browser.browserProfileId,
      notes: input.notes
    };

    try {
      const response = await this.bridge.accounts.create(payload);
      if (!response.success || !response.data?.id) {
        this.setState({ error: !response.success ? response.error.message : 'Thêm tài khoản thất bại.' });
        return false;
      }
    } catch (err: unknown) {
      this.setState({ error: err instanceof Error ? err.message : 'Thêm tài khoản thất bại.' });
      return false;
    }

    const refresh = await this.load();
    if (refresh === 'failed') {
      this.setState({ warning: 'Đã thêm tài khoản nhưng chưa tải lại được danh sách.' });
    }
    return true;
  }

  async update(id: string, updated: Account): Promise<boolean> {
    this.setState({ warning: null });
    const browser = parseBrowserProfile(updated.browserProfile);
    const payload: AccountUpdateInputDTO = {
      email: updated.email.trim(),
      emailProvider: (updated.provider || 'manual').trim(),
      passwordCapcutOp: secretOp(updated.password),
      emailPasswordOp: secretOp(updated.emailPassword),
      emailDataOp: secretOp(updated.fullData),
      credit: updated.credit ?? 0,
      subscription: updated.subscription ?? null,
      status: updated.status,
      proxy: updated.proxy ? updated.proxy : null,
      browserProvider: browser.browserProvider ?? null,
      browserProfileId: browser.browserProfileId ?? null,
      notes: updated.notes ?? null
    };

    try {
      const response = await this.bridge.accounts.update(id, payload);
      if (!response.success || !response.data?.success) {
        this.setState({ error: !response.success ? response.error.message : 'Cập nhật thất bại.' });
        return false;
      }
    } catch (err: unknown) {
      this.setState({ error: err instanceof Error ? err.message : 'Cập nhật thất bại.' });
      return false;
    }

    const refresh = await this.load();
    if (refresh === 'failed') {
      this.setState({ warning: 'Đã cập nhật tài khoản nhưng chưa tải lại được danh sách.' });
    }
    return true;
  }


  async remove(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    this.setState({ warning: null });

    try {
      const response = await this.bridge.accounts.remove(ids);
      if (!response.success) {
        this.setState({ error: response.error.message });
        return false;
      }
    } catch (err: unknown) {
      this.setState({ error: err instanceof Error ? err.message : 'Không thể xóa tài khoản.' });
      return false;
    }

    const refresh = await this.load();
    if (refresh === 'failed') {
      this.setState({ warning: 'Đã xóa tài khoản nhưng chưa tải lại được danh sách.' });
    }
    return true;
  }

  /**
   * Đọc tiến độ 12 nhiệm vụ của một account. Trả `null` khi lỗi và ghi câu lỗi
   * vào state — hộp thoại tự hiện, không được để một lần đọc hỏng làm vỡ trang.
   */
  async loadTasks(accountId: string): Promise<AccountTasksResponseDTO | null> {
    try {
      const response = await this.bridge.accounts.tasks({ accountId });
      if (!response.success) {
        this.setState({ error: response.error.message });
        return null;
      }
      return response.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Không tải được tiến độ nhiệm vụ.';
      this.setState({ error: message });
      return null;
    }
  }

  /**
   * Xuất file. KHÔNG `load()` lại: xuất không đổi dữ liệu, tải lại chỉ làm mất
   * ô đang tích của người dùng. Câu lỗi của main process được giữ nguyên vì nó
   * nói đúng nguyên nhân (không có dòng nào khớp, không giải mã được…), câu
   * chung "Thao tác thất bại" thì không giúp gì.
   */
  async exportAccounts(request: AccountExportRequestDTO): Promise<ExportOutcome> {
    try {
      const response = await this.bridge.accounts.export(request);
      if (!response.success) {
        return { kind: 'error', message: response.error.message };
      }
      if (response.data.canceled || !response.data.filePath) {
        return { kind: 'canceled' };
      }
      return {
        kind: 'done',
        filePath: response.data.filePath,
        exportedCount: response.data.exportedCount
      };
    } catch (err: unknown) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Xuất dữ liệu thất bại.'
      };
    }
  }
}
