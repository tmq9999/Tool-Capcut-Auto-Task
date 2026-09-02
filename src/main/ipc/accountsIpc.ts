import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import { ok, toErrorEnvelope, VALIDATION_ERROR } from './ipcResult';
import type { AccountService } from '../services/AccountService';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import type { AccountListItemDTO } from '../../shared/schemas/account.schema';

export function registerAccountsIpc(
  registrar: IpcRegistrar,
  accountService: AccountService
): () => void {
  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_LIST,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
      const parsed = IpcContractRegistry.accounts.list.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok(accountService.list(parsed.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_CREATE,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ id: string }>> => {
      const parsed = IpcContractRegistry.accounts.create.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok(accountService.create(parsed.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_UPDATE,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ success: boolean }>> => {
      const parsed = IpcContractRegistry.accounts.update.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok(accountService.update(parsed.data.id, parsed.data.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_DELETE,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ deletedCount: number }>> => {
      const parsed = IpcContractRegistry.accounts.delete.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok(accountService.remove(parsed.data.ids));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_LIST);
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_CREATE);
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_UPDATE);
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_DELETE);
  };
}
