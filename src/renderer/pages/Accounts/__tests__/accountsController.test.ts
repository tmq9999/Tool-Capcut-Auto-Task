import { describe, it, expect, beforeEach } from 'vitest';
import { AccountsController, toViewAccount, type IAccountsBridge } from '../accountsController';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type {
  AccountCreateInputDTO,
  AccountListItemDTO,
  AccountUpdateInputDTO
} from '../../../../shared/schemas/account.schema';

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

  accounts = {
    list: async (): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
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
    }
  };
}

let bridge: FakeBridge;

beforeEach(() => {
  bridge = new FakeBridge();
});

describe('toViewAccount', () => {
  it('numbers the row and never exposes a password value', () => {
    const view = toViewAccount(dto(), 0);

    expect(view.stt).toBe(1);
    expect(view.password).toBeUndefined();
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
      password: 'mailpass',
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
      emailPassword: 'mailpass',
      emailData: 'raw|data',
      credit: 10,
      status: 'active'
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
      fullData: '',
      status: 'active',
      createdAt: '',
      updatedAt: ''
    });

    const sent = bridge.updated[0];
    expect(sent.id).toBe('acc-1');
    expect(sent.data.emailPasswordOp).toEqual({ action: 'replace', value: 'brand-new' });
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
});
