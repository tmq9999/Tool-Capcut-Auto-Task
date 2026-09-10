import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import type { SettingsService } from '../services/SettingsService';
import type { ServiceConnectionManager } from '../services/ServiceConnectionManager';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import { validationError } from './ipcResult';
import type { AppSettingsDTO } from '../../shared/schemas/settings.schema';
import type { CredentialStatusDTO, SanitizedDiagnosticResult } from '../../shared/schemas/diagnostics.schema';

export function registerSettingsIpc(
  registrar: IpcRegistrar,
  settingsService: SettingsService,
  connectionManager: ServiceConnectionManager
): () => void {
  registrar.handle(
    IPC_CHANNELS.SETTINGS_GET,
    async (): Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>> => {
      try {
        const result = settingsService.getSettingsWithCredentials();
        return {
          success: true,
          data: result
        };
      } catch {
        return {
          success: false,
          error: {
            code: 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to retrieve application settings or credentials.'
          }
        };
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.SETTINGS_SAVE,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ success: boolean }>> => {
      const validation = IpcContractRegistry.settings.save.request.safeParse(request);
      if (!validation.success) {
        // Câu cũ là "Invalid settings save payload." — tiếng Anh giữa UI tiếng
        // Việt và không nói field nào sai. Xoá trắng ô "Luồng" trên Dashboard là
        // rơi vào đây (`threadCount: 0` vi phạm `.min(1)`), autosave hỏng im lặng.
        return validationError(validation.error);
      }

      try {
        settingsService.saveSettingsWithCredentials(validation.data);
        return {
          success: true,
          data: {
            success: true
          }
        };
      } catch {
        return {
          success: false,
          error: {
            code: 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to persist application settings or credentials.'
          }
        };
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.SETTINGS_SAVE_AUTOMATION,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ success: boolean }>> => {
      const validation = IpcContractRegistry.settings.saveAutomation.request.safeParse(request);
      if (!validation.success) {
        return validationError(validation.error);
      }

      try {
        settingsService.saveAutomationSettings(validation.data);
        return {
          success: true,
          data: {
            success: true
          }
        };
      } catch {
        return {
          success: false,
          error: {
            code: 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to persist automation settings.'
          }
        };
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.CREDENTIALS_TEST,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<SanitizedDiagnosticResult>> => {
      const validation = IpcContractRegistry.credentials.test.request.safeParse(request);
      if (!validation.success) {
        return validationError(validation.error);
      }

      try {
        const { serviceName, draftSecret, multiloginDraft } = validation.data;
        const result =
          draftSecret !== undefined || multiloginDraft !== undefined
            ? await connectionManager.testConnection(serviceName, draftSecret, multiloginDraft)
            : await connectionManager.testConnection(serviceName);
        return {
          success: true,
          data: result
        };
      } catch {
        return {
          success: false,
          error: {
            code: 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to test service credentials.'
          }
        };
      }
    }
  );

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    registrar.removeHandler(IPC_CHANNELS.SETTINGS_GET);
    registrar.removeHandler(IPC_CHANNELS.SETTINGS_SAVE);
    registrar.removeHandler(IPC_CHANNELS.SETTINGS_SAVE_AUTOMATION);
    registrar.removeHandler(IPC_CHANNELS.CREDENTIALS_TEST);
  };
}
