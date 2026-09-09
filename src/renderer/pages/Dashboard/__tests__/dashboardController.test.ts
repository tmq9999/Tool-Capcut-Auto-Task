import { describe, it, expect, beforeEach } from 'vitest';
import { DashboardController, type IDashboardBridge } from '../dashboardController';
import { DEFAULT_AUTOMATION_CONFIG } from '../automationConfig';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type { AccountListItemDTO } from '../../../../shared/schemas/account.schema';
import type { CanonicalRuntimeLog } from '../../../../shared/schemas/log.schema';
import type {
  AutomationRunConfigDTO,
  AutomationRunProgressDTO,
  RunningThreadInfoDTO
} from '../../../../shared/schemas/automation.schema';
import type { EmailProviderConfigDTO } from '../../../../shared/schemas/provider.schema';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings/default-settings';
import type { AppSettingsDTO } from '../../../../shared/schemas/settings.schema';
import type { SettingsSaveRequestDTO } from '../../../../shared/schemas/settings-save.schema';

function account(id: string): AccountListItemDTO {
  return {
    id,
    email: id + '@x.com',
    emailProvider: 'gmail94',
    hasEmailPassword: false,
    hasPasswordCapcut: true,
    hasEmailData: false,
    credit: 0,
    subscription: null,
    status: 'processing',
    automationStep: null,
    proxy: null,
    browserProvider: 'multilogin',
    browserProfileId: null,
    notes: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z'
  };
}

function log(id: string): CanonicalRuntimeLog {
  return {
    id,
    email: 'a@x.com',
    step: 'Browser',
    status: 'INFO',
    message: 'msg ' + id,
    createdAt: '2026-09-01T10:00:00.000Z'
  };
}

const IDLE: AutomationRunProgressDTO = {
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

const PROVIDERS: EmailProviderConfigDTO[] = [
  { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••' },
  { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••' }
];

class FakeBridge implements IDashboardBridge {
  public accountsListCalls = 0;
  public startedConfigs: AutomationRunConfigDTO[] = [];
  public stopCalls = 0;
  public stoppedThreads: string[] = [];
  public runningThreads: RunningThreadInfoDTO[] = [];
  public savedSettings: SettingsSaveRequestDTO[] = [];
  public storedSettings: AppSettingsDTO = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)) as AppSettingsDTO;
  public saveFails = false;

  settings = {
    get: async (): Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: [] }>> => ({
      success: true,
      data: { settings: this.storedSettings, credentials: [] }
    }),
    save: async (req: SettingsSaveRequestDTO): Promise<IpcEnvelope<{ success: boolean }>> => {
      if (this.saveFails) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'đĩa lỗi' } };
      }
      this.savedSettings.push(req);
      this.storedSettings = req.settings;
      return { success: true, data: { success: true } };
    }
  };
  public logListeners: Array<(entry: CanonicalRuntimeLog) => void> = [];
  public progressListeners: Array<(progress: AutomationRunProgressDTO) => void> = [];
  public unsubscribeCalls = 0;

  public accountRows: AccountListItemDTO[] = [account('acc-1')];
  public removed: string[][] = [];
  public startEnvelope: IpcEnvelope<{ runId: string }> = { success: true, data: { runId: 'run-1' } };
  public listFails = false;

  accounts = {
    list: async (): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
      this.accountsListCalls += 1;
      if (this.listFails) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'db down' } };
      }
      return { success: true, data: { items: this.accountRows, total: this.accountRows.length } };
    },
    remove: async (ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>> => {
      this.removed.push(ids);
      return { success: true, data: { deletedCount: ids.length } };
    }
  };

  public clearLogsCalls = 0;
  logs = {
    list: async (): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>> => ({
      success: true,
      data: { items: [log('log-1')], total: 1 }
    }),
    onEntry: (listener: (entry: CanonicalRuntimeLog) => void): (() => void) => {
      this.logListeners.push(listener);
      return () => { this.unsubscribeCalls += 1; };
    },
    clear: async (): Promise<IpcEnvelope<{ success: boolean }>> => {
      this.clearLogsCalls += 1;
      return { success: true, data: { success: true } };
    }
  };

  run = {
    start: async (config: AutomationRunConfigDTO): Promise<IpcEnvelope<{ runId: string }>> => {
      this.startedConfigs.push(config);
      return this.startEnvelope;
    },
    stop: async (): Promise<IpcEnvelope<{ success: boolean }>> => {
      this.stopCalls += 1;
      return { success: true, data: { success: true } };
    },
    stopThread: async (accountId: string): Promise<IpcEnvelope<{ stopped: boolean }>> => {
      this.stoppedThreads.push(accountId);
      return { success: true, data: { stopped: true } };
    },
    threads: async (): Promise<IpcEnvelope<RunningThreadInfoDTO[]>> => ({
      success: true,
      data: this.runningThreads
    }),
    progress: async (): Promise<IpcEnvelope<AutomationRunProgressDTO>> => ({ success: true, data: IDLE }),
    onProgress: (listener: (progress: AutomationRunProgressDTO) => void): (() => void) => {
      this.progressListeners.push(listener);
      return () => { this.unsubscribeCalls += 1; };
    }
  };

  email = {
    providers: async (): Promise<IpcEnvelope<EmailProviderConfigDTO[]>> => ({ success: true, data: PROVIDERS })
  };

  pushLog(entry: CanonicalRuntimeLog): void {
    for (const listener of this.logListeners) listener(entry);
  }

  pushProgress(progress: AutomationRunProgressDTO): void {
    for (const listener of this.progressListeners) listener(progress);
  }
}

let bridge: FakeBridge;

beforeEach(() => {
  bridge = new FakeBridge();
});

describe('DashboardController.load', () => {
  it('fills accounts, logs, email providers and progress from the bridge', async () => {
    const controller = new DashboardController(bridge);

    await controller.load();

    const state = controller.getState();
    expect(state.isLoading).toBe(false);
    expect(state.accounts.map((row) => row.id)).toEqual(['acc-1']);
    expect(state.logs.map((row) => row.id)).toEqual(['log-1']);
    expect(state.emailProviders).toEqual(PROVIDERS);
    expect(state.progress.state).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('surfaces a failed envelope as an error message', async () => {
    bridge.listFails = true;
    const controller = new DashboardController(bridge);

    await controller.load();

    expect(controller.getState().error).toContain('tài khoản');
  });

  it('notifies subscribers when state changes', async () => {
    const controller = new DashboardController(bridge);
    let notifications = 0;
    controller.subscribe(() => { notifications += 1; });

    await controller.load();

    expect(notifications).toBeGreaterThan(0);
  });
});

describe('DashboardController.start', () => {
  it('sends the mapped run config to the bridge', async () => {
    const controller = new DashboardController(bridge);
    controller.updateConfig({ emailList: 'a@x.com|p', threadCount: 2 });

    const started = await controller.start();

    expect(started).toBe(true);
    expect(bridge.startedConfigs).toHaveLength(1);
    expect(bridge.startedConfigs[0].threadCount).toBe(2);
    expect(bridge.startedConfigs[0].testDurationMs).toBe(10_000);
  });

  it('blocks an invalid config before touching the bridge', async () => {
    const controller = new DashboardController(bridge);

    const started = await controller.start();

    expect(started).toBe(false);
    expect(bridge.startedConfigs).toHaveLength(0);
    expect(controller.getState().error).toContain('email');
  });

  it('surfaces the provider message when the main process rejects the run', async () => {
    bridge.startEnvelope = {
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Chưa cấu hình API key cho gmail94 trong Settings.' }
    };
    const controller = new DashboardController(bridge);
    controller.updateConfig({ emailList: 'a@x.com|p' });

    const started = await controller.start();

    expect(started).toBe(false);
    expect(controller.getState().error).toBe('Chưa cấu hình API key cho gmail94 trong Settings.');
  });

  it('clears a previous error on a successful start', async () => {
    const controller = new DashboardController(bridge);
    await controller.start();
    expect(controller.getState().error).not.toBeNull();

    controller.updateConfig({ emailList: 'a@x.com|p' });
    await controller.start();

    expect(controller.getState().error).toBeNull();
  });

  it('xóa logs runtime và gọi bridge.logs.clear khi bắt đầu phiên mới', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    expect(controller.getState().logs).toHaveLength(1);

    controller.updateConfig({ emailList: 'a@x.com|p' });
    const started = await controller.start();

    expect(started).toBe(true);
    expect(controller.getState().logs).toHaveLength(0);
    expect(bridge.clearLogsCalls).toBe(1);
  });
});

describe('DashboardController.stop', () => {
  it('asks the bridge to stop the active run', async () => {
    const controller = new DashboardController(bridge);

    await controller.stop();

    expect(bridge.stopCalls).toBe(1);
  });

  it('coalesces repeated Stop requests and refreshes actual state after teardown', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    bridge.run.stop = async () => {
      bridge.stopCalls += 1;
      await gate;
      bridge.accountRows = [{ ...account('acc-1'), status: 'stopped' }];
      bridge.runningThreads = [];
      return { success: true, data: { success: true } };
    };
    bridge.run.progress = async () => ({ success: true, data: { ...IDLE, state: 'stopped', terminalReason: { code: 'USER_STOP' } } });
    const controller = new DashboardController(bridge);
    const first = controller.stop();
    const second = controller.stop();
    const countBeforeRelease = bridge.stopCalls;
    release();
    await Promise.all([first, second]);
    expect(countBeforeRelease).toBe(1);
    expect(controller.getState().accounts[0].status).toBe('stopped');
    expect(controller.getState().progress.terminalReason?.code).toBe('USER_STOP');
  });

  it('reports transport failure and unlocks Stop so the user can retry', async () => {
    bridge.run.stop = async () => { throw new Error('IPC connection lost'); };
    const controller = new DashboardController(bridge);
    await expect(controller.stop()).resolves.toBe(false);
    expect(controller.getState().error).toContain('dừng');
    bridge.run.stop = async () => ({ success: true, data: { success: true } });
    await expect(controller.stop()).resolves.toBe(true);
  });
});

describe('DashboardController live updates', () => {
  it('prepends a pushed log entry so the newest line is first', () => {
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushLog(log('log-2'));
    bridge.pushLog(log('log-3'));

    expect(controller.getState().logs.map((row) => row.id)).toEqual(['log-3', 'log-2']);
  });

  it('caps the live log buffer so a long run cannot grow it without bound', () => {
    const controller = new DashboardController(bridge, { maxLogs: 3 });
    controller.attach();

    for (let index = 0; index < 10; index += 1) {
      bridge.pushLog(log('log-' + index));
    }

    expect(controller.getState().logs).toHaveLength(3);
    expect(controller.getState().logs[0].id).toBe('log-9');
  });

  it('reflects a running progress event as running', () => {
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, runId: 'run-1', state: 'running', workerTarget: 2, accountsAccepted: 2 });

    expect(controller.isRunning()).toBe(true);
    expect(controller.getState().progress.accountsAccepted).toBe(2);
  });

  it('is not running once the run reports stopped', () => {
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, state: 'running' });
    bridge.pushProgress({ ...IDLE, state: 'stopped' });

    expect(controller.isRunning()).toBe(false);
  });

  it.each(['completed', 'stopped', 'blocked', 'failed'] as const)(
    'treats %s as terminal',
    (state) => {
      const controller = new DashboardController(bridge);
      controller.attach();
      bridge.pushProgress({ ...IDLE, state, message: state });
      expect(controller.isRunning()).toBe(false);
    }
  );

  it('surfaces a blocked reason and keeps safe capacity details', () => {
    const controller = new DashboardController(bridge);
    controller.attach();
    bridge.pushProgress({
      ...IDLE,
      state: 'blocked',
      message: 'Số dư Gmail94 không đủ cho 3 luồng.',
      terminalReason: {
        code: 'INSUFFICIENT_FUNDS',
        provider: 'gmail94',
        details: {
          requestedWorkers: 3,
          reusableCount: 1,
          balance: 1000,
          unitPrice: 1000,
          affordablePurchaseCount: 1
        }
      }
    });

    expect(controller.getState().error).toContain('Số dư Gmail94');
    expect(controller.getState().progress.terminalReason?.details?.balance).toBe(1000);
  });

  it('reloads the account grid while the run is still running', async () => {
    const controller = new DashboardController(bridge);
    controller.attach();
    const before = bridge.accountsListCalls;

    bridge.pushProgress({ ...IDLE, state: 'running', workerTarget: 2, accountsAccepted: 2 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Rows are created as threads launch, so the grid must not wait for the run
    // to finish — otherwise the per-row stop button is unreachable.
    expect(bridge.accountsListCalls).toBeGreaterThan(before);
  });

  it('reloads the account grid when a run finishes', async () => {
    const controller = new DashboardController(bridge);
    controller.attach();
    const before = bridge.accountsListCalls;

    bridge.pushProgress({ ...IDLE, state: 'stopped' });
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.accountsListCalls).toBeGreaterThan(before);
  });

  it('shows the failure message when a run fails', () => {
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, state: 'failed', message: 'Không mua được email nào.' });

    expect(controller.getState().error).toBe('Không mua được email nào.');
    expect(controller.isRunning()).toBe(false);
  });

  it('detaches both subscriptions on dispose', () => {
    const controller = new DashboardController(bridge);
    controller.attach();

    controller.dispose();

    expect(bridge.unsubscribeCalls).toBe(2);
  });
});

describe('DashboardController.updateConfig', () => {
  it('merges a patch into the existing config', () => {
    const controller = new DashboardController(bridge);

    controller.updateConfig({ threadCount: 25 });
    controller.updateConfig({ headless: true });

    expect(controller.getState().config).toEqual({
      ...DEFAULT_AUTOMATION_CONFIG,
      threadCount: 25,
      headless: true
    });
  });
});

describe('DashboardController.removeAccounts', () => {
  it('deletes the given rows and refreshes the grid', async () => {
    const controller = new DashboardController(bridge);
    const before = bridge.accountsListCalls;

    const removed = await controller.removeAccounts(['acc-1']);

    expect(removed).toBe(true);
    expect(bridge.removed).toEqual([['acc-1']]);
    expect(bridge.accountsListCalls).toBeGreaterThan(before);
  });

  it('deletes multiple account IDs including failed and stopped runs', async () => {
    const controller = new DashboardController(bridge);

    const removed = await controller.removeAccounts(['acc-err-1', 'acc-done-2', 'acc-stopped-3']);

    expect(removed).toBe(true);
    expect(bridge.removed).toEqual([['acc-err-1', 'acc-done-2', 'acc-stopped-3']]);
  });

  it('ignores an empty selection without calling the bridge', async () => {
    const controller = new DashboardController(bridge);

    const removed = await controller.removeAccounts([]);

    expect(removed).toBe(false);
    expect(bridge.removed).toEqual([]);
  });
});

describe('DashboardController.stopThread', () => {
  it('shows an actionable error when a retained profile could not be stopped', async () => {
    bridge.run.stopThread = async () => ({ success: true, data: { stopped: false } });
    const controller = new DashboardController(bridge);
    await expect(controller.stopThread('acc-1')).resolves.toBe(false);
    expect(controller.getState().error).toContain('dừng');
  });
  it('stops one thread and refreshes the running list', async () => {
    bridge.runningThreads = [
      { accountId: 'acc-1', email: 'a@x.com', profileId: 'profile-1' },
      { accountId: 'acc-2', email: 'b@x.com', profileId: 'profile-2' }
    ];
    const controller = new DashboardController(bridge);
    await controller.load();

    bridge.runningThreads = [{ accountId: 'acc-2', email: 'b@x.com', profileId: 'profile-2' }];
    const stopped = await controller.stopThread('acc-1');

    expect(stopped).toBe(true);
    expect(bridge.stoppedThreads).toEqual(['acc-1']);
    expect(controller.getState().runningThreads.map((t) => t.accountId)).toEqual(['acc-2']);
  });

  it('exposes which accounts are currently running so the grid can enable the button', async () => {
    bridge.runningThreads = [{ accountId: 'acc-1', email: 'a@x.com', profileId: 'profile-1' }];
    const controller = new DashboardController(bridge);

    await controller.load();

    expect(controller.isThreadRunning('acc-1')).toBe(true);
    expect(controller.isThreadRunning('acc-2')).toBe(false);
  });

  it('refreshes the running list on every progress event', () => {
    bridge.runningThreads = [{ accountId: 'acc-5', email: 'e@x.com', profileId: 'profile-5' }];
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, state: 'running', workerTarget: 1, accountsAccepted: 1 });

    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      expect(controller.getState().runningThreads.map((t) => t.accountId)).toEqual(['acc-5']);
    });
  });
});

describe('DashboardController lưu cấu hình', () => {
  it('nạp cấu hình đã lưu khi mở Dashboard', async () => {
    bridge.storedSettings = {
      ...bridge.storedSettings,
      automation: { ...bridge.storedSettings.automation, threadCount: 42, browser: 'gologin', headless: true }
    };
    const controller = new DashboardController(bridge);

    await controller.load();

    expect(controller.getState().config.threadCount).toBe(42);
    expect(controller.getState().config.browser).toBe('gologin');
    expect(controller.getState().config.headless).toBe(true);
  });

  it('lưu cấu hình mà không ghi đè các mục Settings khác', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({ threadCount: 7, module: 'team' });

    const saved = await controller.saveConfig();

    expect(saved).toBe(true);
    const payload = bridge.savedSettings[0];
    expect(payload.settings.automation.threadCount).toBe(7);
    expect(payload.settings.automation.module).toBe('team');
    expect(payload.settings.exportConfig).toEqual(bridge.storedSettings.exportConfig);
    expect(payload.settings.general).toEqual(bridge.storedSettings.general);
  });

  it('không gửi credential nào khi chỉ lưu cấu hình', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();

    await controller.saveConfig();

    const ops = bridge.savedSettings[0].credentials.map((c) => c.operation.action);
    expect(new Set(ops)).toEqual(new Set(['keep']));
  });

  it('không bao giờ ghi email hoặc mật khẩu đã dán vào Settings nhưng lưu cấu hình proxy', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({
      emailList: 'a@x.com|secret-pass',
      proxyList: '9.9.9.9:1:user:secret',
      proxyKeyList: 'K-SAVED-KEY',
      passwordMode: 'custom',
      customPassword: 'Str0ng!Secret'
    });

    await controller.saveConfig();

    const asJson = JSON.stringify(bridge.savedSettings[0]);
    expect(asJson).not.toContain('secret-pass');
    expect(asJson).not.toContain('Str0ng!Secret');
    expect(asJson).toContain('9.9.9.9:1:user:secret');
    expect(asJson).toContain('K-SAVED-KEY');
  });

  it('báo lỗi khi lưu thất bại', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    bridge.saveFails = true;

    expect(await controller.saveConfig()).toBe(false);
    expect(controller.getState().error).toBe('đĩa lỗi');
  });

  it('tự lưu khi bật autoSaveConfig', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();

    controller.updateConfig({ threadCount: 12 });
    await controller.flushPendingSave();

    expect(bridge.savedSettings).toHaveLength(1);
    expect(bridge.savedSettings[0].settings.automation.threadCount).toBe(12);
  });

  it('không tự lưu khi tắt autoSaveConfig', async () => {
    bridge.storedSettings = {
      ...bridge.storedSettings,
      general: { ...bridge.storedSettings.general, autoSaveConfig: false }
    };
    const controller = new DashboardController(bridge);
    await controller.load();

    controller.updateConfig({ threadCount: 12 });
    await controller.flushPendingSave();

    expect(bridge.savedSettings).toHaveLength(0);
  });

  it('giữ nguyên ô email đang gõ khi nạp cấu hình đã lưu', async () => {
    const controller = new DashboardController(bridge);
    controller.updateConfig({ emailList: 'đang-gõ@x.com|p' });

    await controller.load();

    expect(controller.getState().config.emailList).toBe('đang-gõ@x.com|p');
  });
});

describe('DashboardController với nguồn email domain tự sở hữu', () => {
  it('đọc domain và base url từ Settings để panel hiển thị', async () => {
    bridge.storedSettings = {
      ...bridge.storedSettings,
      customEmail: {
        domain: 'oldevlk.com',
        apiBaseUrl: 'http://103.116.38.76:3000',
        senderFilter: 'capcut'
      }
    };
    const controller = new DashboardController(bridge);

    await controller.load();

    expect(controller.getState().customEmail).toEqual({
      domain: 'oldevlk.com',
      apiBaseUrl: 'http://103.116.38.76:3000',
      senderFilter: 'capcut'
    });
  });

  it('chặn khởi chạy và báo lỗi khi chọn nguồn email domain vì chức năng đã bị khóa', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({ emailSourceMode: 'custom', threadCount: 4 });

    const started = await controller.start();

    expect(started).toBe(false);
    expect(bridge.startedConfigs).toHaveLength(0);
    expect(controller.getState().error).toContain('khóa');
  });

  it('không gửi cấu hình xuống Main khi dùng domain vì chức năng đã khóa', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({ emailSourceMode: 'custom', emailList: '' });

    expect(await controller.start()).toBe(false);
    expect(bridge.startedConfigs).toHaveLength(0);
    expect(controller.getState().error).toContain('khóa');
  });
});
