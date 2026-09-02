import { describe, it, expect } from 'vitest';
import {
  registerBaselineIpc,
  type IpcRegistrar,
  type ClockProvider,
  type IpcHandler
} from '../registerIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { PingEnvelopeSchema } from '../../../shared/contracts/api';

class FakeIpcRegistrar implements IpcRegistrar {
  public handlers = new Map<string, IpcHandler>();
  public removedChannels: string[] = [];

  handle(channel: string, listener: IpcHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Handler already registered for channel: ${channel}`);
    }
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
    this.removedChannels.push(channel);
  }
}

describe('registerBaselineIpc (Task 8 RED)', () => {
  it('registers exactly IPC_CHANNELS.PING and returns valid PingEnvelopeSchema response', async () => {
    const registrar = new FakeIpcRegistrar();
    const fixedTimestamp = 1725148800000;
    const fakeClock: ClockProvider = { now: () => fixedTimestamp };

    const cleanup = registerBaselineIpc(registrar, fakeClock);

    expect(registrar.handlers.size).toBe(1);
    expect(registrar.handlers.has(IPC_CHANNELS.PING)).toBe(true);

    const pingHandler = registrar.handlers.get(IPC_CHANNELS.PING);
    expect(pingHandler).toBeDefined();

    if (!pingHandler) throw new Error('pingHandler is undefined');

    const result = await pingHandler();
    const parsed = PingEnvelopeSchema.safeParse(result);
    expect(parsed.success).toBe(true);

    if (parsed.success && parsed.data.success) {
      expect(parsed.data.data.pong).toBe(true);
      expect(parsed.data.data.timestamp).toBe(fixedTimestamp);
    }

    // Verify cleanup removes handler idempotently
    cleanup();
    expect(registrar.handlers.has(IPC_CHANNELS.PING)).toBe(false);
    expect(registrar.removedChannels).toEqual([IPC_CHANNELS.PING]);

    // Second cleanup call should not throw
    expect(() => cleanup()).not.toThrow();
  });
});
