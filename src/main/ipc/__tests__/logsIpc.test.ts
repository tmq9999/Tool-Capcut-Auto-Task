import { describe, it, expect, vi } from 'vitest';
import { registerLogsIpc } from '../logsIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import type { IpcRegistrar, IpcHandler } from '../registerIpc';
import type { LogRepository } from '../../repositories/LogRepository';
import type { LogBus } from '../../services/LogBus';

class FakeIpcRegistrar implements IpcRegistrar {
  public handlers = new Map<string, IpcHandler>();
  public removedChannels: string[] = [];

  handle(channel: string, listener: IpcHandler): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
    this.removedChannels.push(channel);
  }
}

describe('registerLogsIpc', () => {
  it('registers list and clear handlers, and returns clearedThrough on clear with logBus', async () => {
    const registrar = new FakeIpcRegistrar();
    const mockRepo: Pick<LogRepository, 'queryLogs' | 'clearAllLogs'> = {
      queryLogs: vi.fn().mockReturnValue({ items: [], total: 0 }),
      clearAllLogs: vi.fn()
    };
    const mockLogBus: Pick<LogBus, 'clear'> = {
      clear: vi.fn((fn: () => void) => {
        fn();
        return 42;
      })
    };

    const cleanup = registerLogsIpc(registrar, mockRepo, mockLogBus);

    expect(registrar.handlers.has(IPC_CHANNELS.LOGS_LIST)).toBe(true);
    expect(registrar.handlers.has(IPC_CHANNELS.LOGS_CLEAR)).toBe(true);

    const clearHandler = registrar.handlers.get(IPC_CHANNELS.LOGS_CLEAR);
    expect(clearHandler).toBeDefined();

    const res = await clearHandler!({}, undefined);
    expect(res).toEqual({
      success: true,
      data: {
        success: true,
        clearedThrough: 42
      }
    });
    expect(mockRepo.clearAllLogs).toHaveBeenCalled();

    cleanup();
    expect(registrar.handlers.has(IPC_CHANNELS.LOGS_LIST)).toBe(false);
    expect(registrar.handlers.has(IPC_CHANNELS.LOGS_CLEAR)).toBe(false);
  });
});
