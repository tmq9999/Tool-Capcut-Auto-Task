import {
  SettingsSaveRequestSchema,
  type SettingsSaveRequestDTO,
} from '../../shared/schemas/settings-save.schema';
import type { AppSettingsDTO } from '../../shared/schemas/settings.schema';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings/default-settings';
import type { SettingsRepository } from '../repositories/SettingsRepository';
import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { ITransactionRunner } from '../database/transaction';
import type { ICredentialVault } from '../security/CredentialVault';
import type { ServiceConnectionManager } from './ServiceConnectionManager';
import type { CredentialStatusDTO } from '../../shared/schemas/diagnostics.schema';

interface PreEncryptedCredentialMutation {
  serviceName: string;
  action: 'keep' | 'replace' | 'clear';
  encryptedBuffer?: Buffer;
  maskedHint?: string;
}

export class SettingsService {
  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly credRepo: CredentialRepository,
    private readonly transactionRunner: ITransactionRunner,
    private readonly vault: ICredentialVault,
    private readonly connectionManager: ServiceConnectionManager
  ) {}

  getSettingsWithCredentials(): {
    settings: AppSettingsDTO;
    credentials: CredentialStatusDTO[];
  } {
    const storedSettings = this.settingsRepo.getAppSettings();
    const settings = storedSettings ?? DEFAULT_APP_SETTINGS;
    const credentials = this.connectionManager.getDiagnosticStatuses();

    return {
      settings,
      credentials,
    };
  }

  saveSettingsWithCredentials(request: SettingsSaveRequestDTO): void {
    // 1. Complete validation before encryption
    const validatedRequest = SettingsSaveRequestSchema.parse(request);

    // 2. Pre-encrypt every replacement BEFORE entering the synchronous transaction
    const plannedMutations: PreEncryptedCredentialMutation[] = [];

    for (const credMutation of validatedRequest.credentials) {
      const op = credMutation.operation;
      if (op.action === 'keep') {
        plannedMutations.push({
          serviceName: credMutation.serviceName,
          action: 'keep',
        });
      } else if (op.action === 'clear') {
        plannedMutations.push({
          serviceName: credMutation.serviceName,
          action: 'clear',
        });
      } else if (op.action === 'replace') {
        let plainTextToEncrypt: string;
        const maskedHint = '••••••••';

        if (credMutation.serviceName === 'multilogin') {
          const auth = (op as { action: 'replace'; auth: unknown }).auth;
          plainTextToEncrypt = JSON.stringify(auth);
        } else {
          plainTextToEncrypt = (op as { action: 'replace'; value: string }).value;
        }

        const encryptedBuffer = this.vault.encrypt(plainTextToEncrypt);
        plannedMutations.push({
          serviceName: credMutation.serviceName,
          action: 'replace',
          encryptedBuffer,
          maskedHint,
        });
      }
    }

    // 3. Inside one synchronous transaction: save settings and apply planned mutations
    this.transactionRunner.run(() => {
      this.settingsRepo.saveAppSettings(validatedRequest.settings);

      for (const mutation of plannedMutations) {
        if (mutation.action === 'keep') {
          // No-op
          continue;
        } else if (mutation.action === 'clear') {
          this.credRepo.delete(mutation.serviceName);
        } else if (mutation.action === 'replace' && mutation.encryptedBuffer) {
          this.credRepo.saveCredential(mutation.serviceName, mutation.encryptedBuffer, {
            maskedHint: mutation.maskedHint ?? '••••••••',
            status: 'unknown',
          });
        }
      }
    });
  }
}
