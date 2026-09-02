import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError } from '../providers/ProviderError';

/**
 * Single place that turns a stored credential row back into a usable secret.
 * Decryption stays in the main process; callers receive the plaintext only for
 * the duration of an outbound API call.
 */
export class SecretReader {
  constructor(
    private readonly credRepo: CredentialRepository,
    private readonly vault: ICredentialVault
  ) {}

  isConfigured(serviceName: string): boolean {
    return this.credRepo.getCredential(serviceName) !== null;
  }

  maskedHint(serviceName: string): string {
    return this.credRepo.getCredential(serviceName)?.metadata.maskedHint ?? '••••••••';
  }

  /** Reads a single-value secret such as an API key or API token. */
  readSimpleKey(serviceName: string): string {
    const record = this.credRepo.getCredential(serviceName);
    if (!record) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Chưa cấu hình API key cho ' + serviceName + ' trong Settings.',
        serviceName
      );
    }

    let decrypted: string;
    try {
      decrypted = this.vault.decrypt(record.encryptedCredentials).trim();
    } catch {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không đọc được API key đã lưu của ' + serviceName + '.',
        serviceName
      );
    }

    if (decrypted.length === 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'API key đã lưu của ' + serviceName + ' đang trống.',
        serviceName
      );
    }

    return decrypted;
  }
}
