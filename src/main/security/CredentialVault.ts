export class VaultUnavailableError extends Error {
  public readonly code = 'ERR_VAULT_UNAVAILABLE';

  constructor(message = 'Operating system credential encryption (safeStorage) is unavailable.') {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

export class CredentialEncryptionError extends Error {
  public readonly code = 'ERR_CREDENTIAL_ENCRYPTION_FAILED';

  constructor(message = 'Failed to encrypt sensitive credential payload.') {
    super(message);
    this.name = 'CredentialEncryptionError';
  }
}

export class CredentialDecryptionError extends Error {
  public readonly code = 'ERR_CREDENTIAL_DECRYPTION_FAILED';

  constructor(message = 'Failed to decrypt sensitive credential payload.') {
    super(message);
    this.name = 'CredentialDecryptionError';
  }
}

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ICredentialVault {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

export class CredentialVault implements ICredentialVault {
  constructor(private readonly backend: SafeStorageBackend) {}

  isAvailable(): boolean {
    try {
      return this.backend.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  encrypt(plainText: string): Buffer {
    if (!this.isAvailable()) {
      throw new VaultUnavailableError();
    }

    if (!plainText || typeof plainText !== 'string' || plainText.trim().length === 0) {
      throw new CredentialEncryptionError('Plaintext credential must be a non-empty string.');
    }

    try {
      return this.backend.encryptString(plainText);
    } catch {
      throw new CredentialEncryptionError('Failed to encrypt sensitive credential payload.');
    }
  }

  decrypt(encrypted: Buffer): string {
    if (!this.isAvailable()) {
      throw new VaultUnavailableError();
    }

    if (!encrypted || !Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new CredentialDecryptionError('Encrypted credential must be a non-empty Buffer.');
    }

    try {
      return this.backend.decryptString(encrypted);
    } catch {
      throw new CredentialDecryptionError('Failed to decrypt sensitive credential payload.');
    }
  }
}
