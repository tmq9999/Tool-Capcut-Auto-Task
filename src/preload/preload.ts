import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/contracts/ipc-channels';
import type { ElectronBridge } from '../shared/contracts/api';
import type { SettingsSaveRequestDTO } from '../shared/schemas/settings-save.schema';
import type { AutomationConfigSettingsDTO } from '../shared/schemas/settings.schema';
import type {
  AccountCreateInputDTO,
  AccountFilterDTO,
  AccountUpdateInputDTO
} from '../shared/schemas/account.schema';
import type { AccountExportRequestDTO } from '../shared/schemas/account-export.schema';
import type { AccountTasksRequestDTO } from '../shared/schemas/account-task.schema';
import type { LogFilterDTO, CanonicalRuntimeLog, LogsResetPayload } from '../shared/schemas/log.schema';
import type {
  AutomationRunConfigDTO,
  AutomationRunProgressDTO
} from '../shared/schemas/automation.schema';
import type { CredentialStatusDTO } from '../shared/schemas/diagnostics.schema';

/**
 * Wires one main-to-renderer push channel to a typed callback and returns the
 * matching unsubscribe. Only these three channels are listenable; no generic
 * ipcRenderer surface is exposed.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

declare const __APP_VERSION__: string | undefined;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.0.4';

const bridge: ElectronBridge = {
  platform: process.platform,
  version: APP_VERSION,
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.PING),
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    save: (req: SettingsSaveRequestDTO) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, req),
    saveAutomation: (req: AutomationConfigSettingsDTO) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_AUTOMATION, req)
  },
  credentials: {
    test: (request: string | { serviceName: string; draftSecret?: string; multiloginDraft?: unknown }) => {
      const payload = typeof request === 'string' ? { serviceName: request } : request;
      return ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_TEST, payload);
    }
  },
  accounts: {
    list: (filter: AccountFilterDTO) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_LIST, filter),
    create: (input: AccountCreateInputDTO) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_CREATE, input),
    update: (id: string, data: AccountUpdateInputDTO) =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_UPDATE, { id, data }),
    remove: (ids: string[]) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_DELETE, { ids }),
    export: (request: AccountExportRequestDTO) =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_EXPORT, request),
    tasks: (request: AccountTasksRequestDTO) =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNTS_TASKS, request)
  },
  logs: {
    list: (filter: LogFilterDTO) => ipcRenderer.invoke(IPC_CHANNELS.LOGS_LIST, filter),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_CLEAR),
    onEntry: (listener: (log: CanonicalRuntimeLog) => void) =>
      subscribe<CanonicalRuntimeLog>(IPC_EVENTS.LOG_ENTRY, listener),
    onReset: (listener: (payload: LogsResetPayload) => void) =>
      subscribe<LogsResetPayload>(IPC_EVENTS.LOGS_RESET, listener)
  },
  run: {
    start: (config: AutomationRunConfigDTO) => ipcRenderer.invoke(IPC_CHANNELS.RUN_START, config),
    health: (input) => ipcRenderer.invoke(IPC_CHANNELS.RUN_HEALTH, input),
    userData: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_USER_DATA),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_STOP),
    stopThread: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUN_STOP_THREAD, { accountId }),
    threads: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_THREADS),
    progress: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_PROGRESS),
    onProgress: (listener: (progress: AutomationRunProgressDTO) => void) =>
      subscribe<AutomationRunProgressDTO>(IPC_EVENTS.RUN_PROGRESS, listener)
  },
  email: {
    providers: () => ipcRenderer.invoke(IPC_CHANNELS.EMAIL_PROVIDERS),
    readOtp: (purchasedEmailId: string, type?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EMAIL_READ_OTP, { purchasedEmailId, type })
  },
  services: {
    onStatusChanged: (listener: (statuses: CredentialStatusDTO[]) => void) =>
      subscribe<CredentialStatusDTO[]>(IPC_EVENTS.SERVICE_STATUS, listener)
  }
};

contextBridge.exposeInMainWorld('electronAPI', bridge);
