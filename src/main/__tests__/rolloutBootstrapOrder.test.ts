import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ events: [] as string[], dataPath: '', opened: '', ready: Promise.resolve() }));
vi.mock('electron', () => ({
  app: {
    getPath: () => state.dataPath,
    setPath: (_name: string, value: string) => { state.events.push('user-data'); state.dataPath = value; },
    getName: () => 'offline-test', setAppUserModelId: () => {}, on: () => {}, quit: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => state.ready,
    exit: () => { state.events.push('exit'); }
  },
  BrowserWindow: vi.fn(() => { throw new Error('WINDOW_MUST_NOT_START'); }),
  dialog: {}, ipcMain: {}, safeStorage: {}
}));
vi.mock('../database/connection', () => ({
  createDatabaseConnection: (file: string) => {
    state.events.push('db'); state.opened = file;
    throw new Error('OFFLINE_STOP_AT_DB_BOUNDARY');
  }
}));

describe('main bootstrap applies rollout userData before persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    state.events = []; state.opened = ''; state.dataPath = 'unused';
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('opens its first database only under the validated override', async () => {
    const directory = path.join(os.tmpdir(), 'rollout-bootstrap-offline');
    vi.stubEnv('AUTOMANAGER_ROLLOUT_USER_DATA_DIR', directory);
    await import('../main');
    await state.ready;
    expect(state.events).toEqual(['user-data', 'db', 'exit']);
    expect(state.opened).toBe(path.join(directory, 'automanager.db'));
  });

  it('rejects an unsafe override before any persistence or window creation', async () => {
    vi.stubEnv('AUTOMANAGER_ROLLOUT_USER_DATA_DIR', '.');
    await expect(import('../main')).rejects.toThrow();
    expect(state.events).toEqual([]);
  });
});
