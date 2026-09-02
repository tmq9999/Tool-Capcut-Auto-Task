import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPC_CHANNELS, IPC_EVENTS } from '../../shared/contracts/ipc-channels';
import type { ElectronBridge } from '../../shared/contracts/api';
import type { SettingsSaveRequestDTO } from '../../shared/schemas/settings-save.schema';

interface MockContextBridge {
  exposeInMainWorld: ReturnType<typeof vi.fn>;
}

interface MockIpcRenderer {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}

const mockContextBridge: MockContextBridge = {
  exposeInMainWorld: vi.fn(),
};

const mockIpcRenderer: MockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
};

vi.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer,
}));

describe('Preload Bridge (Task 2.1.3 RED)', () => {
  const SETTINGS_GET_CHANNEL = IPC_CHANNELS.SETTINGS_GET;
  const SETTINGS_SAVE_CHANNEL = IPC_CHANNELS.SETTINGS_SAVE;
  const CREDENTIALS_TEST_CHANNEL = IPC_CHANNELS.CREDENTIALS_TEST;

  beforeEach(() => {
    vi.resetModules();
    mockContextBridge.exposeInMainWorld.mockClear();
    mockIpcRenderer.invoke.mockClear();
    mockIpcRenderer.on.mockClear();
    mockIpcRenderer.removeListener.mockClear();
  });

  it('exposes narrow typed electronAPI bridge in main world with platform, version, ping, settings, and credentials', async () => {
    await import('../preload');

    expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);

    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    expect(callArgs[0]).toBe('electronAPI');

    const bridge = callArgs[1];
    expect(bridge).toBeDefined();
    expect(typeof bridge.platform).toBe('string');
    expect(bridge.platform.length).toBeGreaterThan(0);
    expect(typeof bridge.version).toBe('string');
    expect(bridge.version.length).toBeGreaterThan(0);
    expect(typeof bridge.ping).toBe('function');

    expect(bridge.settings).toBeDefined();
    expect(typeof bridge.settings.get).toBe('function');
    expect(typeof bridge.settings.save).toBe('function');

    expect(bridge.credentials).toBeDefined();
    expect(typeof bridge.credentials.test).toBe('function');

    expect(bridge.accounts).toBeDefined();
    expect(typeof bridge.accounts.list).toBe('function');
    expect(typeof bridge.accounts.create).toBe('function');
    expect(typeof bridge.accounts.update).toBe('function');
    expect(typeof bridge.accounts.remove).toBe('function');

    expect(bridge.logs).toBeDefined();
    expect(typeof bridge.logs.list).toBe('function');
    expect(typeof bridge.logs.clear).toBe('function');
    expect(typeof bridge.logs.onEntry).toBe('function');

    expect(bridge.run).toBeDefined();
    expect(typeof bridge.run.start).toBe('function');
    expect(typeof bridge.run.stop).toBe('function');
    expect(typeof bridge.run.progress).toBe('function');
    expect(typeof bridge.run.onProgress).toBe('function');

    expect(bridge.email).toBeDefined();
    expect(typeof bridge.email.providers).toBe('function');
    expect(typeof bridge.email.readOtp).toBe('function');

    expect(bridge.services).toBeDefined();
    expect(typeof bridge.services.onStatusChanged).toBe('function');

    // Assert only approved properties exist on bridge
    const exposedKeys = Object.keys(bridge);
    expect(exposedKeys.sort()).toEqual([
      'accounts', 'credentials', 'email', 'logs', 'ping', 'platform', 'run', 'services', 'settings', 'version'
    ].sort());

    // Assert no raw IPC methods or properties are leaked on the bridge
    const bridgeRecord = bridge as unknown as Record<string, unknown>;
    expect(bridgeRecord.send).toBeUndefined();
    expect(bridgeRecord.invoke).toBeUndefined();
    expect(bridgeRecord.postMessage).toBeUndefined();
    expect(bridgeRecord.ipcRenderer).toBeUndefined();
    expect(bridgeRecord.require).toBeUndefined();
    expect(bridgeRecord.process).toBeUndefined();
  });

  it('calling bridge.ping() invokes exactly IPC_CHANNELS.PING with no extra arguments', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({
      success: true,
      data: { pong: true, timestamp: Date.now() },
    });

    await import('../preload');

    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    const bridge = callArgs[1];

    const result = await bridge.ping();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PING);
    expect(result.success).toBe(true);
  });

  it('calling bridge.settings.get() invokes SETTINGS_GET with no request payload', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({
      success: true,
      data: { settings: {}, credentials: [] },
    });

    await import('../preload');

    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    const bridge = callArgs[1];

    const result = await bridge.settings.get();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(SETTINGS_GET_CHANNEL);
    expect(result.success).toBe(true);
  });

  it('calling bridge.settings.save(req) invokes SETTINGS_SAVE with exactly the typed composite request', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({
      success: true,
      data: { success: true },
    });

    await import('../preload');

    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    const bridge = callArgs[1];

    const sampleSaveReq = {
      settings: {
        general: { theme: 'dark', language: 'vi', autoSaveConfig: true, sessionRestore: true },
        browser: { provider: 'gpm', gpm: { port: 19995 }, multilogin: { port: 35000, launcher: 'xcli' }, gologin: { autoPort: true }, camoufox: { headless: false }, patchright: { headless: false } },
        logs: { retention: '30' },
        exportConfig: { defaultFormat: 'xlsx', checkedFields: ['email'], availableFields: ['email'] },
      },
      credentials: [
        { serviceName: 'gmail94', operation: { action: 'keep' } },
      ],
    } as SettingsSaveRequestDTO;

    const result = await bridge.settings.save(sampleSaveReq);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(SETTINGS_SAVE_CHANNEL, sampleSaveReq);
    expect(result.success).toBe(true);
  });

  it("calling bridge.credentials.test('gmail94') invokes CREDENTIALS_TEST with exactly { serviceName: 'gmail94' }", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({
      success: true,
      data: { code: 'PROVIDER_NOT_IMPLEMENTED', message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.', timestamp: '2026-09-01T12:00:00.000Z' },
    });

    await import('../preload');

    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    const bridge = callArgs[1];

    const result = await bridge.credentials.test('gmail94');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(CREDENTIALS_TEST_CHANNEL, { serviceName: 'gmail94' });
    expect(result.success).toBe(true);
  });
});

describe('Preload runtime channels', () => {
  beforeEach(() => {
    vi.resetModules();
    mockContextBridge.exposeInMainWorld.mockClear();
    mockIpcRenderer.invoke.mockClear();
    mockIpcRenderer.on.mockClear();
    mockIpcRenderer.removeListener.mockClear();
  });

  async function loadBridge(): Promise<ElectronBridge> {
    await import('../preload');
    const callArgs = mockContextBridge.exposeInMainWorld.mock.calls[0] as [string, ElectronBridge];
    return callArgs[1];
  }

  it('forwards accounts.list to the accounts list channel with the filter', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: { items: [], total: 0 } });
    const bridge = await loadBridge();

    await bridge.accounts.list({ page: 1, pageSize: 50 });

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ACCOUNTS_LIST, { page: 1, pageSize: 50 });
  });

  it('forwards accounts.update as one payload holding id and data', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: { success: true } });
    const bridge = await loadBridge();

    await bridge.accounts.update('acc-1', { status: 'done' });

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ACCOUNTS_UPDATE, {
      id: 'acc-1',
      data: { status: 'done' }
    });
  });

  it('forwards accounts.remove as an ids payload', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: { deletedCount: 1 } });
    const bridge = await loadBridge();

    await bridge.accounts.remove(['acc-1']);

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ACCOUNTS_DELETE, { ids: ['acc-1'] });
  });

  it('forwards email.readOtp with the optional type', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: { otp: null } });
    const bridge = await loadBridge();

    await bridge.email.readOtp('pe-1', 'facebook');

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EMAIL_READ_OTP, {
      purchasedEmailId: 'pe-1',
      type: 'facebook'
    });
  });

  it('subscribes to log entries and returns a working unsubscribe', async () => {
    const bridge = await loadBridge();
    const received: unknown[] = [];

    const unsubscribe = bridge.logs.onEntry((log) => received.push(log));

    expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_EVENTS.LOG_ENTRY, expect.any(Function));
    const listener = mockIpcRenderer.on.mock.calls[0][1] as (event: unknown, payload: unknown) => void;
    listener({}, { id: 'log-1' });
    expect(received).toEqual([{ id: 'log-1' }]);

    unsubscribe();
    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(IPC_EVENTS.LOG_ENTRY, listener);
  });

  it('subscribes to run progress on its own channel', async () => {
    const bridge = await loadBridge();

    bridge.run.onProgress(() => {});

    expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_EVENTS.RUN_PROGRESS, expect.any(Function));
  });

  it('never exposes a generic invoke or send helper', async () => {
    const bridge = await loadBridge();
    const record = bridge as unknown as Record<string, unknown>;
    expect(record.invoke).toBeUndefined();
    expect(record.send).toBeUndefined();
    expect(record.on).toBeUndefined();
  });
});
