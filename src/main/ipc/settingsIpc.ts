import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import type { SettingsService } from '../services/SettingsService';
import type { ServiceConnectionManager } from '../services/ServiceConnectionManager';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
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
        return {
          success: false,
          error: {
            code: 'ERR_VALIDATION_FAILED',
            message: 'Invalid settings save payload.'
          }
        };
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
    IPC_CHANNELS.CREDENTIALS_TEST,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<SanitizedDiagnosticResult>> => {
      const validation = IpcContractRegistry.credentials.test.request.safeParse(request);
      if (!validation.success) {
        return {
          success: false,
          error: {
            code: 'ERR_VALIDATION_FAILED',
            message: 'Invalid credential test payload.'
          }
        };
      }

      try {
        const result = await connectionManager.testConnection(validation.data.serviceName);
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
    registrar.removeHandler(IPC_CHANNELS.CREDENTIALS_TEST);
  };
}
