import { describe, it, expect, beforeEach } from 'vitest';
import { LogsController, toViewLog, type ILogsBridge } from '../logsController';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../../../shared/schemas/log.schema';

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

  logs = {
    list: async (): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>> => {
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
});
