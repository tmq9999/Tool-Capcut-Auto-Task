import { describe, it, expect, beforeEach } from 'vitest';
import { registerAccountsIpc } from '../accountsIpc';
import { registerLogsIpc } from '../logsIpc';
import { registerAutomationIpc } from '../automationIpc';
import type { IpcRegistrar } from '../registerIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { ProviderError } from '../../providers/ProviderError';
import { AutomationTerminalError } from '../../services/AutomationTerminalError';
import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import type { AutomationRunProgressDTO } from '../../../shared/schemas/automation.schema';

type GenericHandler = (event?: unknown, req?: unknown) => Promise<IpcEnvelope<unknown>> | IpcEnvelope<unknown>;

class FakeIpcRegistrar implements IpcRegistrar {
  public handlers = new Map<string, GenericHandler>();
  public removed: string[] = [];

  handle(channel: string, listener: GenericHandler): void {
    if (this.handlers.has(channel)) throw new Error('duplicate channel ' + channel);
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
    this.removed.push(channel);
  }

  async invoke(channel: string, request?: unknown): Promise<IpcEnvelope<unknown>> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error('no handler for ' + channel);
    return handler(undefined, request);
  }
}

const IDLE_PROGRESS: AutomationRunProgressDTO = {
  runId: 'none',
  state: 'idle',
  workerTarget: 0,
  workersActive: 0,
  accountsAccepted: 0,
  accountsCompleted: 0,
  accountsFailed: 0,
  accountsStopped: 0,
  message: 'Chưa chạy'
};

let registrar: FakeIpcRegistrar;

beforeEach(() => {
  registrar = new FakeIpcRegistrar();
});

describe('registerAccountsIpc', () => {
  const listResult = { items: [], total: 0 };

  function accountsService(overrides: Record<string, unknown> = {}) {
    return {
      list: () => listResult,
      create: () => ({ id: 'acc-1' }),
      update: () => ({ success: true }),
      remove: () => ({ deletedCount: 2 }),
      ...overrides
    };
  }

  function exportService(overrides: Record<string, unknown> = {}) {
    return {
      export: async () => ({ canceled: false, filePath: 'C:/tmp/accounts.txt', exportedCount: 3 }),
      ...overrides
    };
  }

  function taskService(overrides: Record<string, unknown> = {}) {
    return {
      listByAccount: () => ({ items: [], doneCount: 0, creditsEarned: 0 }),
      ...overrides
    };
  }

  it('lists accounts through the service with a validated filter', async () => {
    let seen: unknown = null;
    registerAccountsIpc(registrar, accountsService({
      list: (filter: unknown) => { seen = filter; return listResult; }
    }) as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_LIST, { page: 2, pageSize: 25 });

    expect(envelope).toEqual({ success: true, data: listResult });
    expect(seen).toEqual({ page: 2, pageSize: 25 });
  });

  it('rejects a filter with an out-of-range page size', async () => {
    registerAccountsIpc(registrar, accountsService() as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_LIST, { page: 1, pageSize: 5000 });

    // Lỗi phải NÊU field, không chỉ "Yêu cầu không hợp lệ." — xem `ipcResult.ts`.
    expect(envelope.success).toBe(false);
    if (envelope.success) return;
    expect(envelope.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(envelope.error.details?.field).toBe('pageSize');
    expect(String(envelope.error.details?.reason)).toMatch(/500/);
  });

  it('creates an account and returns only its id', async () => {
    registerAccountsIpc(registrar, accountsService() as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_CREATE, {
      email: 'a@b.com',
      emailProvider: 'manual',
      passwordCapcut: 'secret',
      credit: 0,
      status: 'active'
    });

    expect(envelope).toEqual({ success: true, data: { id: 'acc-1' } });
  });

  it('updates an account with a secret operation', async () => {
    registerAccountsIpc(registrar, accountsService() as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_UPDATE, {
      id: 'acc-1',
      data: { passwordCapcutOp: { action: 'replace', value: 'new' } }
    });

    expect(envelope).toEqual({ success: true, data: { success: true } });
  });

  it('deletes accounts and reports the count', async () => {
    registerAccountsIpc(registrar, accountsService() as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_DELETE, { ids: ['acc-1', 'acc-2'] });

    expect(envelope).toEqual({ success: true, data: { deletedCount: 2 } });
  });

  it('normalizes a repository failure into a persistence error', async () => {
    registerAccountsIpc(registrar, accountsService({
      list: () => { throw new Error('db locked'); }
    }) as never, exportService() as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_LIST, { page: 1, pageSize: 50 });

    expect(envelope).toMatchObject({ success: false, error: { code: 'ERR_PERSISTENCE_FAILED' } });
  });

  it('xuất account: chuyển nguyên yêu cầu đã kiểm cho service và trả lại đường dẫn', async () => {
    let seen: unknown = null;
    registerAccountsIpc(registrar, accountsService() as never, exportService({
      export: async (req: unknown) => {
        seen = req;
        return { canceled: false, filePath: 'C:/tmp/accounts.csv', exportedCount: 2 };
      }
    }) as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_EXPORT, {
      format: 'CSV',
      fields: ['email', 'passwordCapcut'],
      scope: { kind: 'checked', ids: ['acc-1', 'acc-2'] }
    });

    expect(envelope).toEqual({
      success: true,
      data: { canceled: false, filePath: 'C:/tmp/accounts.csv', exportedCount: 2 }
    });
    expect(seen).toEqual({
      format: 'CSV',
      fields: ['email', 'passwordCapcut'],
      scope: { kind: 'checked', ids: ['acc-1', 'acc-2'] }
    });
  });

  it('xuất account: định dạng lạ thì trả lỗi NÊU field, không gọi service', async () => {
    let called = false;
    registerAccountsIpc(registrar, accountsService() as never, exportService({
      export: async () => { called = true; return { canceled: true, filePath: null, exportedCount: 0 }; }
    }) as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_EXPORT, {
      format: 'PDF',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(called).toBe(false);
    expect(envelope.success).toBe(false);
    if (envelope.success) return;
    expect(envelope.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(envelope.error.details?.field).toBe('format');
  });

  it('xuất account: lỗi có mã của service được giữ nguyên cho người dùng', async () => {
    registerAccountsIpc(registrar, accountsService() as never, exportService({
      export: async () => {
        throw new ProviderError('CONFIG_ERROR', 'Không có tài khoản nào khớp phạm vi đã chọn.');
      }
    }) as never, taskService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_EXPORT, {
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(envelope).toEqual({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có tài khoản nào khớp phạm vi đã chọn.' }
    });
  });

  it('tiến độ nhiệm vụ: trả về danh sách của đúng account được hỏi', async () => {
    let seen: unknown = null;
    registerAccountsIpc(
      registrar,
      accountsService() as never,
      exportService() as never,
      {
        listByAccount: (req: unknown) => {
          seen = req;
          return { items: [], doneCount: 0, creditsEarned: 0 };
        }
      } as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_TASKS, { accountId: 'acc-9' });

    expect(envelope).toEqual({
      success: true,
      data: { items: [], doneCount: 0, creditsEarned: 0 }
    });
    expect(seen).toEqual({ accountId: 'acc-9' });
  });

  it('tiến độ nhiệm vụ: thiếu accountId thì trả lỗi nêu field', async () => {
    registerAccountsIpc(
      registrar,
      accountsService() as never,
      exportService() as never,
      { listByAccount: () => ({ items: [], doneCount: 0, creditsEarned: 0 }) } as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.ACCOUNTS_TASKS, {});

    expect(envelope.success).toBe(false);
    if (envelope.success) return;
    expect(envelope.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(envelope.error.details?.field).toBe('accountId');
  });

  it('removes every handler it registered on cleanup', async () => {
    const cleanup = registerAccountsIpc(registrar, accountsService() as never, exportService() as never, taskService() as never);
    cleanup();

    expect(registrar.removed.sort()).toEqual([
      IPC_CHANNELS.ACCOUNTS_CREATE,
      IPC_CHANNELS.ACCOUNTS_DELETE,
      IPC_CHANNELS.ACCOUNTS_EXPORT,
      IPC_CHANNELS.ACCOUNTS_LIST,
      IPC_CHANNELS.ACCOUNTS_TASKS,
      IPC_CHANNELS.ACCOUNTS_UPDATE
    ].sort());
  });
});

describe('registerLogsIpc', () => {
  it('queries logs with a validated filter', async () => {
    let seen: unknown = null;
    registerLogsIpc(registrar, {
      queryLogs: (filter: unknown) => { seen = filter; return { items: [], total: 0 }; },
      clearAllLogs: () => {}
    } as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.LOGS_LIST, { page: 1, pageSize: 100, level: 'ERROR' });

    expect(envelope).toEqual({ success: true, data: { items: [], total: 0 } });
    expect(seen).toEqual({ page: 1, pageSize: 100, level: 'ERROR' });
  });

  it('clears every log row', async () => {
    let cleared = false;
    registerLogsIpc(registrar, {
      queryLogs: () => ({ items: [], total: 0 }),
      clearAllLogs: () => { cleared = true; }
    } as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.LOGS_CLEAR);

    expect(envelope).toEqual({ success: true, data: { success: true } });
    expect(cleared).toBe(true);
  });

  it('rejects an invalid log filter', async () => {
    registerLogsIpc(registrar, {
      queryLogs: () => ({ items: [], total: 0 }),
      clearAllLogs: () => {}
    } as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.LOGS_LIST, { page: 0, pageSize: 10 });

    expect(envelope).toMatchObject({ success: false, error: { code: 'ERR_VALIDATION_FAILED' } });
  });
});

describe('registerAutomationIpc', () => {
  const validConfig = {
    threadCount: 2,
    browser: 'multilogin',
    headless: false,
    retryCount: 0,
    stepDelayMinMs: 100,
    stepDelayMaxMs: 200,
    typeDelayMinMs: 10,
    typeDelayMaxMs: 20,
    module: 'trial',
    skipWithoutTrial: false,
    emailSource: { mode: 'api', provider: 'gmail94', service: 'facebook' },
    proxy: { mode: 'proxykey' },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false }
  };

  function runService(overrides: Record<string, unknown> = {}) {
    return {
      start: async () => ({ runId: 'run-1' }),
      stop: async () => {},
      stopThread: async () => true,
      getProgress: () => IDLE_PROGRESS,
      getRunningThreads: () => [
        { accountId: 'acc-1', email: 'a@x.com', profileId: 'profile-1' }
      ],
      ...overrides
    };
  }

  function emailService(overrides: Record<string, unknown> = {}) {
    return {
      getProviderConfigs: () => [
        { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••' },
        { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••' }
      ],
      readOtp: async () => '123456',
      ...overrides
    };
  }

  it('starts a run with a validated config and returns the run id', async () => {
    let seen: unknown = null;
    registerAutomationIpc(
      registrar,
      runService({ start: async (config: unknown) => { seen = config; return { runId: 'run-1' }; } }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_START, validConfig);

    expect(envelope).toEqual({ success: true, data: { runId: 'run-1' } });
    expect((seen as { testDurationMs: number }).testDurationMs).toBe(10_000);
  });

  it('rejects a run config whose thread count is zero', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_START, { ...validConfig, threadCount: 0 });

    expect(envelope).toMatchObject({ success: false, error: { code: 'ERR_VALIDATION_FAILED' } });
  });

  it('surfaces a provider failure with its own diagnostic code', async () => {
    registerAutomationIpc(
      registrar,
      runService({
        start: async () => { throw new ProviderError('CONFIG_ERROR', 'Chưa cấu hình API key.', 'gmail94'); }
      }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_START, validConfig);

    expect(envelope).toEqual({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Chưa cấu hình API key.' }
    });
  });

  it('returns safe typed details when run preparation is blocked', async () => {
    registerAutomationIpc(
      registrar,
      runService({
        start: async () => {
          throw new AutomationTerminalError(
            'blocked',
            {
              code: 'INSUFFICIENT_FUNDS',
              provider: 'gmail94',
              details: {
                requestedWorkers: 3,
                reusableCount: 1,
                balance: 1000,
                unitPrice: 1000,
                affordablePurchaseCount: 1
              }
            },
            'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.'
          );
        }
      }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_START, {
      ...validConfig,
      threadCount: 3
    });

    expect(envelope).toEqual({
      success: false,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.',
        details: {
          provider: 'gmail94',
          requestedWorkers: 3,
          reusableCount: 1,
          balance: 1000,
          unitPrice: 1000,
          affordablePurchaseCount: 1
        }
      }
    });
  });

  it('stops the active run', async () => {
    let stopped = false;
    registerAutomationIpc(
      registrar,
      runService({ stop: async () => { stopped = true; } }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_STOP);

    expect(envelope).toEqual({ success: true, data: { success: true } });
    expect(stopped).toBe(true);
  });

  it('stops one thread by account id', async () => {
    const seen: string[] = [];
    registerAutomationIpc(
      registrar,
      runService({ stopThread: async (accountId: string) => { seen.push(accountId); return true; } }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_STOP_THREAD, { accountId: 'acc-7' });

    expect(envelope).toEqual({ success: true, data: { stopped: true } });
    expect(seen).toEqual(['acc-7']);
  });

  it('reports a thread that was not running as not stopped', async () => {
    registerAutomationIpc(
      registrar,
      runService({ stopThread: async () => false }) as never,
      emailService() as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_STOP_THREAD, { accountId: 'acc-9' });

    expect(envelope).toEqual({ success: true, data: { stopped: false } });
  });

  it('rejects a stop-thread request with no account id', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_STOP_THREAD, {});

    expect(envelope).toMatchObject({ success: false, error: { code: 'ERR_VALIDATION_FAILED' } });
  });

  it('lists the running threads for the per-row stop control', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_THREADS);

    expect(envelope).toEqual({
      success: true,
      data: [{ accountId: 'acc-1', email: 'a@x.com', profileId: 'profile-1' }]
    });
  });

  it('reports the current progress snapshot', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.RUN_PROGRESS);

    expect(envelope).toEqual({ success: true, data: IDLE_PROGRESS });
  });

  it('lists the email providers with masked hints only', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.EMAIL_PROVIDERS);

    expect(envelope).toEqual({
      success: true,
      data: [
        { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••' },
        { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••' }
      ]
    });
  });

  it('reads an OTP for a purchased mailbox', async () => {
    registerAutomationIpc(registrar, runService() as never, emailService() as never);

    const envelope = await registrar.invoke(IPC_CHANNELS.EMAIL_READ_OTP, { purchasedEmailId: 'pe-1' });

    expect(envelope).toEqual({ success: true, data: { otp: '123456' } });
  });

  it('reports a pending mailbox as a null otp rather than an error', async () => {
    registerAutomationIpc(
      registrar,
      runService() as never,
      emailService({ readOtp: async () => null }) as never
    );

    const envelope = await registrar.invoke(IPC_CHANNELS.EMAIL_READ_OTP, { purchasedEmailId: 'pe-1' });

    expect(envelope).toEqual({ success: true, data: { otp: null } });
  });
});
