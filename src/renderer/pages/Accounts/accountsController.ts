import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type {
  AccountCreateInputDTO,
  AccountListItemDTO,
  AccountStatus,
  AccountUpdateInputDTO,
  SecretOperation
} from '../../../shared/schemas/account.schema';
import type { Account } from '../../../shared/types/account';

/** Placeholder shown for a stored secret. Never written back as a value. */
export const MASKED_SECRET = '••••••••';

export interface IAccountsBridge {
  accounts: {
    list(filter: { page: number; pageSize: number; query?: string; status?: string; emailProvider?: string }):
      Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>>;
    create(input: AccountCreateInputDTO): Promise<IpcEnvelope<{ id: string }>>;
    update(id: string, data: AccountUpdateInputDTO): Promise<IpcEnvelope<{ success: boolean }>>;
    remove(ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>>;
  };
}

export interface AccountsState {
  isLoading: boolean;
  error: string | null;
  accounts: Account[];
  total: number;
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

function secretOp(value: string | undefined): SecretOperation {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0 || trimmed === MASKED_SECRET) {
    return { action: 'keep' };
  }
  return { action: 'replace', value: trimmed };
}

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 || trimmed === MASKED_SECRET ? undefined : trimmed;
}

/** Owns the Accounts page data. All persistence goes through the preload bridge. */
export class AccountsController {
  private state: AccountsState = {
    isLoading: true,
    error: null,
    accounts: [],
    total: 0
  };

  private readonly listeners = new Set<(state: AccountsState) => void>();

  constructor(
    private readonly bridge: IAccountsBridge,
    private readonly pageSize = 500
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

  async load(): Promise<void> {
    this.setState({ isLoading: true, error: null });
    const response = await this.bridge.accounts.list({ page: 1, pageSize: this.pageSize });

    if (!response.success) {
      this.setState({ isLoading: false, error: 'Không tải được danh sách tài khoản.' });
      return;
    }

    this.setState({
      isLoading: false,
      error: null,
      accounts: response.data.items.map(toViewAccount),
      total: response.data.total
    });
  }

  async create(input: Omit<Account, 'id' | 'stt'>): Promise<boolean> {
    const payload: AccountCreateInputDTO = {
      email: input.email.trim(),
      emailProvider: (input.provider || 'manual').trim(),
      emailPassword: optionalSecret(input.password),
      emailData: optionalSecret(input.fullData),
      credit: input.credit ?? 0,
      subscription: input.subscription,
      status: (input.status ?? 'active') as AccountStatus,
      proxy: input.proxy || undefined,
      notes: input.notes
    };

    const response = await this.bridge.accounts.create(payload);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.load();
    return true;
  }

  async update(id: string, updated: Account): Promise<boolean> {
    const payload: AccountUpdateInputDTO = {
      email: updated.email.trim(),
      emailProvider: (updated.provider || 'manual').trim(),
      emailPasswordOp: secretOp(updated.password),
      emailDataOp: secretOp(updated.fullData),
      credit: updated.credit ?? 0,
      subscription: updated.subscription ?? null,
      status: updated.status,
      proxy: updated.proxy ? updated.proxy : null,
      notes: updated.notes ?? null
    };

    const response = await this.bridge.accounts.update(id, payload);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.load();
    return true;
  }

  async remove(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    const response = await this.bridge.accounts.remove(ids);
    if (!response.success) {
      this.setState({ error: response.error.message });
      return false;
    }

    await this.load();
    return true;
  }
}
