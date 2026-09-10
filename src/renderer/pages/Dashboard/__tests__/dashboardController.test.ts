import { describe, it, expect, beforeEach } from 'vitest';
import { DashboardController, type IDashboardBridge } from '../dashboardController';
import { DEFAULT_AUTOMATION_CONFIG } from '../automationConfig';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type { AccountListItemDTO, AccountFilterDTO } from '../../../../shared/schemas/account.schema';
import type { CanonicalRuntimeLog, LogsResetPayload } from '../../../../shared/schemas/log.schema';
import type {
  AutomationRunConfigDTO,
  AutomationRunProgressDTO,
  RunningThreadInfoDTO
} from '../../../../shared/schemas/automation.schema';
import type { EmailProviderConfigDTO } from '../../../../shared/schemas/provider.schema';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings/default-settings';
import type { AppSettingsDTO, AutomationConfigSettingsDTO } from '../../../../shared/schemas/settings.schema';
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
  public savedAutomationSettings: AutomationConfigSettingsDTO[] = [];
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
    },
    saveAutomation: async (req: AutomationConfigSettingsDTO): Promise<IpcEnvelope<{ success: boolean }>> => {
      if (this.saveFails) {
        return { success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'đĩa lỗi' } };
      }
      this.savedAutomationSettings.push(req);
      this.storedSettings.automation = req;
      return { success: true, data: { success: true } };
    }
  };
  public logListeners: Array<(entry: CanonicalRuntimeLog) => void> = [];
  public resetListeners: Array<(payload: LogsResetPayload) => void> = [];
  public progressListeners: Array<(progress: AutomationRunProgressDTO) => void> = [];
  public unsubscribeCalls = 0;

  public accountRows: AccountListItemDTO[] = [account('acc-1')];
  public removed: string[][] = [];
  public startEnvelope: IpcEnvelope<{ runId: string; artifactBasename?: string; clearedThrough?: number }> = {
    success: true,
    data: { runId: 'run-1' }
  };
  public listFails = false;

  public threadsCalls = 0;
  public useDeferredAccounts = false;
  public accountsDeferred: Array<{
    resolve: (val: IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>) => void;
    reject: (err: unknown) => void;
  }> = [];

  public useDeferredThreads = false;
  public threadsDeferred: Array<{
    resolve: (val: IpcEnvelope<RunningThreadInfoDTO[]>) => void;
    reject: (err: unknown) => void;
  }> = [];

  accounts = {
    list: (_filter?: AccountFilterDTO): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
      this.accountsListCalls += 1;
      if (this.useDeferredAccounts) {
        return new Promise((resolve, reject) => {
          this.accountsDeferred.push({ resolve, reject });
        });
      }
      if (this.listFails) {
        return Promise.resolve({ success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'db down' } });
      }
      return Promise.resolve({ success: true, data: { items: this.accountRows, total: this.accountRows.length } });
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
      return () => {
        this.unsubscribeCalls += 1;
        const idx = this.logListeners.indexOf(listener);
        if (idx >= 0) this.logListeners.splice(idx, 1);
      };
    },
    onReset: (listener: (payload: LogsResetPayload) => void): (() => void) => {
      this.resetListeners.push(listener);
      return () => {
        this.unsubscribeCalls += 1;
        const idx = this.resetListeners.indexOf(listener);
        if (idx >= 0) this.resetListeners.splice(idx, 1);
      };
    },
    clear: async (): Promise<IpcEnvelope<{ success: boolean }>> => {
      this.clearLogsCalls += 1;
      return { success: true, data: { success: true } };
    }
  };

  run = {
    start: async (
      config: AutomationRunConfigDTO
    ): Promise<IpcEnvelope<{ runId: string; artifactBasename?: string; clearedThrough?: number }>> => {
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
    threads: (): Promise<IpcEnvelope<RunningThreadInfoDTO[]>> => {
      this.threadsCalls += 1;
      if (this.useDeferredThreads) {
        return new Promise((resolve, reject) => {
          this.threadsDeferred.push({ resolve, reject });
        });
      }
      return Promise.resolve({
        success: true,
        data: this.runningThreads
      });
    },
    progress: async (): Promise<IpcEnvelope<AutomationRunProgressDTO>> => ({ success: true, data: IDLE }),
    onProgress: (listener: (progress: AutomationRunProgressDTO) => void): (() => void) => {
      this.progressListeners.push(listener);
      return () => {
        this.unsubscribeCalls += 1;
        const idx = this.progressListeners.indexOf(listener);
        if (idx >= 0) this.progressListeners.splice(idx, 1);
      };
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

  pushReset(payload: LogsResetPayload): void {
    for (const listener of this.resetListeners) listener(payload);
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

    expect(bridge.unsubscribeCalls).toBe(3);
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
    const payload = bridge.savedAutomationSettings[0];
    expect(payload.threadCount).toBe(7);
    expect(payload.module).toBe('team');
    expect(bridge.storedSettings.exportConfig).toEqual(DEFAULT_APP_SETTINGS.exportConfig);
    expect(bridge.storedSettings.general).toEqual(DEFAULT_APP_SETTINGS.general);
  });

  it('không gửi credential nào khi chỉ lưu cấu hình', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();

    await controller.saveConfig();

    expect(bridge.savedSettings).toHaveLength(0);
    expect(bridge.savedAutomationSettings).toHaveLength(1);
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

    const asJson = JSON.stringify(bridge.savedAutomationSettings[0]);
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

    expect(bridge.savedAutomationSettings).toHaveLength(1);
    expect(bridge.savedAutomationSettings[0].threadCount).toBe(12);
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

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('DashboardController - S03 Coalesced Snapshot Refresh', () => {
  it('S03-A: giữ pair1 deferred, phát 100 progress + poll tick -> accounts=1, threads=1; state.progress là event cuối', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    for (let i = 0; i < 100; i++) {
      bridge.pushProgress({
        ...IDLE,
        state: 'running',
        workerTarget: 2,
        accountsAccepted: i + 1,
        message: `event ${i + 1}`
      });
    }

    expect(bridge.accountsListCalls).toBe(1);
    expect(bridge.threadsCalls).toBe(1);
    expect(controller.getState().progress.accountsAccepted).toBe(100);
    expect(controller.getState().progress.message).toBe('event 100');

    controller.dispose();
  });

  it('S03-B: settle một nửa -> không pair2; settle nửa còn lại -> đúng một trailing pair; hết events -> dừng ở 2', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    // Push events to initiate Pair 1 and mark pending
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 1 });
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 2 });

    expect(bridge.accountsListCalls).toBe(1);
    expect(bridge.threadsCalls).toBe(1);
    expect(bridge.accountsDeferred).toHaveLength(1);
    expect(bridge.threadsDeferred).toHaveLength(1);

    // Settle accounts half of pair 1
    bridge.accountsDeferred[0].resolve({
      success: true,
      data: { items: [account('acc-1')], total: 1 }
    });
    await flush();

    // Still no pair 2!
    expect(bridge.accountsListCalls).toBe(1);
    expect(bridge.threadsCalls).toBe(1);

    // Settle threads half of pair 1
    bridge.threadsDeferred[0].resolve({
      success: true,
      data: []
    });
    await flush();

    // Exactly one trailing pair started!
    expect(bridge.accountsListCalls).toBe(2);
    expect(bridge.threadsCalls).toBe(2);
    expect(bridge.accountsDeferred).toHaveLength(2);
    expect(bridge.threadsDeferred).toHaveLength(2);

    // Settle pair 2
    bridge.accountsDeferred[1].resolve({
      success: true,
      data: { items: [account('acc-1'), account('acc-2')], total: 2 }
    });
    bridge.threadsDeferred[1].resolve({
      success: true,
      data: []
    });
    await flush();

    // Stops at 2, no pair 3!
    expect(bridge.accountsListCalls).toBe(2);
    expect(bridge.threadsCalls).toBe(2);
    controller.dispose();
  });

  it('S03-C: một bên reject, bên kia pending -> gate vẫn giữ; không unhandled rejection', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, state: 'running' });
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 3 });

    expect(bridge.accountsDeferred).toHaveLength(1);
    expect(bridge.threadsDeferred).toHaveLength(1);

    // Reject accounts immediately
    bridge.accountsDeferred[0].reject(new Error('accounts network dropped'));
    await flush();

    // Gate still holds because threads is pending
    expect(bridge.accountsListCalls).toBe(1);
    expect(bridge.threadsCalls).toBe(1);

    // Settle threads
    bridge.threadsDeferred[0].resolve({ success: true, data: [] });
    await flush();

    // Trailing pair started and error is recorded safely
    expect(bridge.accountsListCalls).toBe(2);
    expect(controller.getState().error).toContain('accounts network dropped');

    // Clean up pair 2
    bridge.accountsDeferred[1].resolve({ success: true, data: { items: [], total: 0 } });
    bridge.threadsDeferred[1].resolve({ success: true, data: [] });
    await flush();
    controller.dispose();
  });

  it('S03-D: terminal event trong pair1 -> pair2 đọc final rows; Stop/counter không bị trì hoãn', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    // Start running
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 1 });
    expect(bridge.accountsListCalls).toBe(1);

    // While pair 1 is running, terminal event arrives
    bridge.pushProgress({
      ...IDLE,
      state: 'completed',
      accountsAccepted: 1,
      accountsCompleted: 1,
      message: 'Đã hoàn thành toàn bộ'
    });

    // Counter/progress updated immediately
    expect(controller.getState().progress.state).toBe('completed');
    expect(controller.getState().progress.accountsCompleted).toBe(1);

    // Settle pair 1
    bridge.accountsDeferred[0].resolve({ success: true, data: { items: [account('acc-1')], total: 1 } });
    bridge.threadsDeferred[0].resolve({ success: true, data: [] });
    await flush();

    // Pair 2 runs to read final rows
    expect(bridge.accountsListCalls).toBe(2);
    bridge.accountsDeferred[1].resolve({ success: true, data: { items: [account('acc-1')], total: 1 } });
    bridge.threadsDeferred[1].resolve({ success: true, data: [] });
    await flush();
    controller.dispose();
  });

  it('S03-E: dispose/attach + old response -> không stale publish/duplicate physical pair', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    bridge.pushProgress({ ...IDLE, state: 'running' });
    expect(bridge.accountsListCalls).toBe(1);

    // Dispose while pair 1 is in-flight
    controller.dispose();

    // Re-attach and push new progress
    controller.attach();
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 10 });

    // Physical gate still held (pair 1 was running), no duplicate physical pair started yet
    expect(bridge.accountsListCalls).toBe(1);

    // Pair 1 finishes with old data
    bridge.accountsDeferred[0].resolve({
      success: true,
      data: { items: [account('acc-old')], total: 1 }
    });
    bridge.threadsDeferred[0].resolve({ success: true, data: [] });
    await flush();

    // Old data was NOT published because generation changed on dispose
    expect(controller.getState().accounts.map((a) => a.id)).not.toContain('acc-old');

    // Trailing pair for the new generation started!
    expect(bridge.accountsListCalls).toBe(2);
    bridge.accountsDeferred[1].resolve({
      success: true,
      data: { items: [account('acc-new')], total: 1 }
    });
    bridge.threadsDeferred[1].resolve({ success: true, data: [] });
    await flush();

    // New data is published
    expect(controller.getState().accounts.map((a) => a.id)).toEqual(['acc-new']);
    controller.dispose();
  });

  it('S03-F: stopThread and removeAccounts coordinate through the snapshot gate', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);

    const stopPromise = controller.stopThread('acc-1');
    await flush();
    expect(bridge.stoppedThreads).toEqual(['acc-1']);
    // Snapshot pair started
    expect(bridge.accountsListCalls).toBe(1);
    expect(bridge.threadsCalls).toBe(1);

    bridge.accountsDeferred[0].resolve({ success: true, data: { items: [], total: 0 } });
    bridge.threadsDeferred[0].resolve({ success: true, data: [] });
    await flush();
    const result = await stopPromise;
    expect(result).toBe(true);
  });

  it('S03-G: progress/poll tiếp tục đến trong mọi pair; caller awaited vẫn settle sau pair phục vụ nó, không chờ queue yên mãi', async () => {
    bridge.useDeferredAccounts = true;
    bridge.useDeferredThreads = true;
    const controller = new DashboardController(bridge);
    controller.attach();

    // Pair 1 starts
    bridge.pushProgress({ ...IDLE, state: 'running' });
    expect(bridge.accountsListCalls).toBe(1);

    // Caller A arrives while Pair 1 is running -> gets nextCompletion (Pair 2)
    let callerASettled = false;
    const callerAPromise = controller.stopThread('acc-target').then(() => {
      callerASettled = true;
    });

    // Pair 1 finishes
    bridge.accountsDeferred[0].resolve({ success: true, data: { items: [account('acc-1')], total: 1 } });
    bridge.threadsDeferred[0].resolve({ success: true, data: [] });
    await flush();

    // Pair 2 starts (serving Caller A)
    expect(bridge.accountsListCalls).toBe(2);
    expect(callerASettled).toBe(false);

    // While Pair 2 is running, more progress events keep arriving!
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 50 });
    bridge.pushProgress({ ...IDLE, state: 'running', accountsAccepted: 51 });

    // Now Pair 2 settles
    bridge.accountsDeferred[1].resolve({ success: true, data: { items: [account('acc-1')], total: 1 } });
    bridge.threadsDeferred[1].resolve({ success: true, data: [] });
    await flush();

    // Caller A MUST BE SETTLED NOW! It must NOT wait for Pair 3!
    expect(callerASettled).toBe(true);
    await callerAPromise;

    // Pair 3 started for the later events
    expect(bridge.accountsListCalls).toBe(3);
    bridge.accountsDeferred[2].resolve({ success: true, data: { items: [], total: 0 } });
    bridge.threadsDeferred[2].resolve({ success: true, data: [] });
    await flush();
    controller.dispose();
  });
});

describe('T08: Settings Revision & Save Queue', () => {
  it('increments configRevision and saves automation settings via bridge', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();

    expect(controller.getConfigRevision()).toBe(0);
    controller.updateConfig({ threadCount: 7 });
    expect(controller.getConfigRevision()).toBe(1);

    await controller.flushPendingSave();
    expect(controller.getLastSavedRevision()).toBe(1);
    expect(bridge.savedAutomationSettings).toHaveLength(1);
    expect(bridge.savedAutomationSettings[0].threadCount).toBe(7);
  });

  it('queues multiple config updates sequentially without dropping the latest revision', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();

    controller.updateConfig({ threadCount: 3 });
    controller.updateConfig({ threadCount: 5 });
    controller.updateConfig({ threadCount: 9 });

    expect(controller.getConfigRevision()).toBe(3);
    await controller.flushPendingSave();

    expect(controller.getLastSavedRevision()).toBe(3);
    const lastSaved = bridge.savedAutomationSettings[bridge.savedAutomationSettings.length - 1];
    expect(lastSaved.threadCount).toBe(9);
  });

  it('start() flushes pending save before sending start command', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({ emailList: 'fixture@example.com|pass', threadCount: 4 });

    expect(controller.getLastSavedRevision()).toBe(0);

    await controller.start();

    expect(controller.getLastSavedRevision()).toBe(1);
    expect(bridge.startedConfigs[0].threadCount).toBe(4);
  });

  it('sets error when saveAutomation fails', async () => {
    bridge.saveFails = true;
    const controller = new DashboardController(bridge);
    await controller.load();

    controller.updateConfig({ threadCount: 8 });
    await controller.flushPendingSave();

    expect(controller.getState().error).toContain('đĩa lỗi');
  });
});

describe('T07-B: Logs Reset Synchronization', () => {
  it('start() does not clear logs optimistically if start fails', async () => {
    bridge.startEnvelope = { success: false, error: { code: 'ERR_START_FAILED', message: 'preflight failed' } };
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.updateConfig({ emailList: 'fixture@example.com|pass' });

    expect(controller.getState().logs).toHaveLength(1);

    const started = await controller.start();
    expect(started).toBe(false);
    expect(controller.getState().logs).toHaveLength(1);
    expect(controller.getState().error).toContain('preflight failed');
  });

  it('start() applies clearedThrough watermark from successful start response', async () => {
    bridge.startEnvelope = { success: true, data: { runId: 'run-new', clearedThrough: 100 } };
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.attach();
    controller.updateConfig({ emailList: 'fixture@example.com|pass' });

    const logOld: CanonicalRuntimeLog = { ...log('old-1'), streamSequence: 50 };
    const logNew: CanonicalRuntimeLog = { ...log('new-1'), streamSequence: 101 };
    bridge.pushLog(logOld);
    bridge.pushLog(logNew);

    await controller.start();

    const logs = controller.getState().logs;
    expect(logs.some((l) => l.id === 'old-1')).toBe(false);
    expect(logs.some((l) => l.id === 'new-1')).toBe(true);
    controller.dispose();
  });

  it('attaches onReset listener and clears logs according to payload clearedThrough', async () => {
    const controller = new DashboardController(bridge);
    await controller.load();
    controller.attach();

    const log1: CanonicalRuntimeLog = { ...log('l1'), streamSequence: 10 };
    const log2: CanonicalRuntimeLog = { ...log('l2'), streamSequence: 25 };
    bridge.pushLog(log1);
    bridge.pushLog(log2);

    expect(controller.getState().logs.map((l) => l.id)).toEqual(['l2', 'l1', 'log-1']);

    bridge.pushReset({ clearedThrough: 20 });

    const remaining = controller.getState().logs;
    expect(remaining.map((l) => l.id)).toEqual(['l2']);

    controller.dispose();
  });

  it('disposes onReset listener on controller.dispose()', () => {
    const controller = new DashboardController(bridge);
    controller.attach();
    expect(bridge.resetListeners).toHaveLength(1);

    controller.dispose();
    expect(bridge.resetListeners).toHaveLength(0);
  });
});

