import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import type { PingResponse } from '../../shared/contracts/api';

export type IpcHandler<TReq = unknown, TRes = unknown> = (
  event?: unknown,
  request?: TReq
) => Promise<IpcEnvelope<TRes>> | IpcEnvelope<TRes>;

export interface IpcRegistrar {
  handle(channel: string, listener: (event?: unknown, request?: unknown) => Promise<unknown> | unknown): void;
  removeHandler(channel: string): void;
}

export interface ClockProvider {
  now(): number;
}

const defaultClock: ClockProvider = {
  now: () => Date.now()
};

export function registerBaselineIpc(
  registrar: IpcRegistrar,
  clock: ClockProvider = defaultClock
): () => void {
  registrar.handle(IPC_CHANNELS.PING, async (): Promise<IpcEnvelope<PingResponse>> => {
    return {
      success: true,
      data: {
        pong: true,
        timestamp: clock.now()
      }
    };
  });

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    registrar.removeHandler(IPC_CHANNELS.PING);
  };
}
