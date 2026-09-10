import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import { ok, toErrorEnvelope, validationError } from './ipcResult';
import type { LogRepository } from '../repositories/LogRepository';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import type { CanonicalRuntimeLog } from '../../shared/schemas/log.schema';

import type { LogBus } from '../services/LogBus';

export function registerLogsIpc(
  registrar: IpcRegistrar,
  logRepo: Pick<LogRepository, 'queryLogs' | 'clearAllLogs'>,
  logBus?: Pick<LogBus, 'clear'>
): () => void {
  registrar.handle(
    IPC_CHANNELS.LOGS_LIST,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>> => {
      const parsed = IpcContractRegistry.logs.list.request.safeParse(request);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(logRepo.queryLogs(parsed.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.LOGS_CLEAR,
    async (): Promise<IpcEnvelope<{ success: boolean; clearedThrough?: number }>> => {
      try {
        let clearedThrough: number | undefined;
        if (logBus) {
          clearedThrough = logBus.clear(() => logRepo.clearAllLogs());
        } else {
          logRepo.clearAllLogs();
        }
        return ok({ success: true, ...(clearedThrough !== undefined ? { clearedThrough } : {}) });
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    registrar.removeHandler(IPC_CHANNELS.LOGS_LIST);
    registrar.removeHandler(IPC_CHANNELS.LOGS_CLEAR);
  };
}
