import { describe, it, expect, vi } from 'vitest';
import {
  CredentialVault,
  VaultUnavailableError,
  CredentialEncryptionError,
  CredentialDecryptionError,
  type ICredentialVault,
  type SafeStorageBackend
} from '../CredentialVault';

class FakeSafeStorageBackend implements SafeStorageBackend {
  constructor(
    public available = true,
    public shouldFailEncrypt = false,
    public shouldFailDecrypt = false
  ) {}

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(plainText: string): Buffer {
    if (this.shouldFailEncrypt) {
      throw new Error('OS encryption internal failure with sensitive plainText: ' + plainText);
    }
    return Buffer.from(`enc:${plainText}`, 'utf-8');
  }

  decryptString(encrypted: Buffer): string {
    if (this.shouldFailDecrypt) {
      throw new Error('OS decryption internal failure on cipher bytes');
    }
    const str = encrypted.toString('utf-8');
    if (!str.startsWith('enc:')) {
      throw new Error('Invalid cipher format');
    }
    return str.slice(4);
  }
}

class InMemoryFakeVault implements ICredentialVault {
  isAvailable(): boolean {
    return true;
  }
  encrypt(plainText: string): Buffer {
    return Buffer.from(`mock_enc:${plainText}`);
  }
  decrypt(encrypted: Buffer): string {
    return encrypted.toString('utf-8').replace(/^mock_enc:/, '');
  }
}

describe('CredentialVault (Task 7 RED)', () => {
  it('isAvailable accurately reflects underlying safeStorage backend state', () => {
    const enabledBackend = new FakeSafeStorageBackend(true);
    const vaultEnabled = new CredentialVault(enabledBackend);
    expect(vaultEnabled.isAvailable()).toBe(true);

    const disabledBackend = new FakeSafeStorageBackend(false);
    const vaultDisabled = new CredentialVault(disabledBackend);
    expect(vaultDisabled.isAvailable()).toBe(false);
  });

  it('fails closed and immediately throws VaultUnavailableError without calling crypto methods when backend is unavailable', () => {
    const disabledBackend = new FakeSafeStorageBackend(false);
    const encryptSpy = vi.spyOn(disabledBackend, 'encryptString');
    const decryptSpy = vi.spyOn(disabledBackend, 'decryptString');

    const vault = new CredentialVault(disabledBackend);

    expect(() => vault.encrypt('secret_token_123')).toThrow(VaultUnavailableError);
    expect(encryptSpy).not.toHaveBeenCalled();

    expect(() => vault.decrypt(Buffer.from('some_ciphertext'))).toThrow(VaultUnavailableError);
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it('performs round-trip encryption and decryption using available backend', () => {
    const backend = new FakeSafeStorageBackend(true);
    const vault = new CredentialVault(backend);

    const secretSentinel = 'my-super-secret-api-token-value';
    const ciphertext = vault.encrypt(secretSentinel);

    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.length).toBeGreaterThan(0);

    const decrypted = vault.decrypt(ciphertext);
    expect(decrypted).toBe(secretSentinel);
  });

  it('rejects empty or whitespace-only plaintext with static CredentialEncryptionError', () => {
    const backend = new FakeSafeStorageBackend(true);
    const encryptSpy = vi.spyOn(backend, 'encryptString');
    const vault = new CredentialVault(backend);

    expect(() => vault.encrypt('')).toThrow(CredentialEncryptionError);
    expect(() => vault.encrypt('   \t\n  ')).toThrow(CredentialEncryptionError);
    expect(encryptSpy).not.toHaveBeenCalled();
  });

  it('normalizes backend encryption thrown errors to static CredentialEncryptionError without leaking secret or stack', () => {
    const failingBackend = new FakeSafeStorageBackend(true, true, false);
    const vault = new CredentialVault(failingBackend);

    const sensitiveSecret = 'VERY_SENSITIVE_PLAINTEXT_SECRET';
    let thrownError: Error | null = null;

    try {
      vault.encrypt(sensitiveSecret);
    } catch (err: unknown) {
      if (err instanceof Error) {
        thrownError = err;
      }
    }

    expect(thrownError).toBeInstanceOf(CredentialEncryptionError);
    expect(thrownError?.message).not.toContain(sensitiveSecret);
    expect(thrownError?.message).not.toContain('sensitive plainText');
    expect(thrownError?.message).toBe('Failed to encrypt sensitive credential payload.');
  });

  it('normalizes backend decryption thrown errors to static CredentialDecryptionError without leaking raw backend text', () => {
    const failingBackend = new FakeSafeStorageBackend(true, false, true);
    const vault = new CredentialVault(failingBackend);

    let thrownError: Error | null = null;
    try {
      vault.decrypt(Buffer.from('enc:invalid_corrupt_cipher'));
    } catch (err: unknown) {
      if (err instanceof Error) {
        thrownError = err;
      }
    }

    expect(thrownError).toBeInstanceOf(CredentialDecryptionError);
    expect(thrownError?.message).not.toContain('OS decryption internal failure');
    expect(thrownError?.message).toBe('Failed to decrypt sensitive credential payload.');
  });

  it('supports ICredentialVault interface for service-level in-memory fakes', () => {
    const inMemoryVault: ICredentialVault = new InMemoryFakeVault();
    expect(inMemoryVault.isAvailable()).toBe(true);

    const cipher = inMemoryVault.encrypt('in-memory-token');
    expect(inMemoryVault.decrypt(cipher)).toBe('in-memory-token');
  });
});
