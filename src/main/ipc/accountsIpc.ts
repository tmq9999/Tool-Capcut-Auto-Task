import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import { ok, toErrorEnvelope, validationError } from './ipcResult';
import type { AccountService } from '../services/AccountService';
import type { AccountExportService } from '../services/AccountExportService';
import type { AccountTaskService } from '../services/AccountTaskService';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import type { AccountListItemDTO } from '../../shared/schemas/account.schema';
import type { AccountExportResultDTO } from '../../shared/schemas/account-export.schema';
import type { AccountTasksResponseDTO } from '../../shared/schemas/account-task.schema';

export function registerAccountsIpc(
  registrar: IpcRegistrar,
  accountService: AccountService,
  exportService: AccountExportService,
  taskService: AccountTaskService
): () => void {
  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_LIST,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>> => {
      const parsed = IpcContractRegistry.accounts.list.request.safeParse(request);
      if (!parsed.success) return validationError(parsed.error);
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
      if (!parsed.success) return validationError(parsed.error);
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
      if (!parsed.success) return validationError(parsed.error);
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
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(accountService.remove(parsed.data.ids));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_EXPORT,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<AccountExportResultDTO>> => {
      const parsed = IpcContractRegistry.accounts.export.request.safeParse(request);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(await exportService.export(parsed.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.ACCOUNTS_TASKS,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<AccountTasksResponseDTO>> => {
      const parsed = IpcContractRegistry.accounts.tasks.request.safeParse(request);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(taskService.listByAccount(parsed.data));
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
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_EXPORT);
    registrar.removeHandler(IPC_CHANNELS.ACCOUNTS_TASKS);
  };
}
