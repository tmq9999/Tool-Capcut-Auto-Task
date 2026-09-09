import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { DatabaseTransactionRunner } from '../../database/transaction';
import { SettingsRepository } from '../../repositories/SettingsRepository';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import { SettingsService } from '../SettingsService';
import {
  ServiceConnectionManager,
  type IProviderRegistry,
  type StatusPublisher,
} from '../ServiceConnectionManager';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { AppSettingsDTO } from '../../../shared/schemas/settings.schema';
import {
  SanitizedDiagnosticResultSchema,
  CredentialStatusDTOSchema,
  type CredentialStatusDTO,
  type CredentialDiagnosticMetadata,
} from '../../../shared/schemas/diagnostics.schema';
import type { SettingsSaveRequestDTO } from '../../../shared/schemas/settings-save.schema';

class FakeCredentialVault implements ICredentialVault {
  public failOnSecond = false;
  public encryptCallCount = 0;
  public decryptCallCount = 0;

  isAvailable(): boolean {
    return true;
  }

  encrypt(plainText: string): Buffer {
    this.encryptCallCount++;
    if (this.failOnSecond && this.encryptCallCount >= 2) {
      throw new Error('Simulated encryption failure on replacement secret');
    }
    return Buffer.from(`encrypted:${plainText}`);
  }

  decrypt(encrypted: Buffer): string {
    this.decryptCallCount++;
    const raw = encrypted.toString('utf8');
    return raw.startsWith('encrypted:') ? raw.slice('encrypted:'.length) : raw;
  }
}

class InstrumentedProviderRegistry implements IProviderRegistry {
  public getCalls: string[] = [];
  public hasCalls: string[] = [];

  get(serviceName: string): unknown | undefined {
    this.getCalls.push(serviceName);
    return undefined;
  }

  has(serviceName: string): boolean {
    this.hasCalls.push(serviceName);
    return false;
  }
}

class ThrowingSecondMutationCredentialRepo extends CredentialRepository {
  public mutationCount = 0;

  override saveCredential(
    serviceName: string,
    encryptedCredentials: Buffer,
    metadata?: CredentialDiagnosticMetadata
  ): void {
    this.mutationCount++;
    if (this.mutationCount >= 2) {
      throw new Error('Simulated repository failure on second credential mutation');
    }
    super.saveCredential(serviceName, encryptedCredentials, metadata);
  }
}

describe('SettingsService & ServiceConnectionManager Suite (Task 2.1.1 RED)', () => {
  let db: Database.Database | null = null;
  let tempDir = '';
  let dbPath = '';
  let vault: FakeCredentialVault;
  let registry: InstrumentedProviderRegistry;
  let publishedStatuses: CredentialStatusDTO[] | null = null;

  const fixedNow = Date.parse('2026-09-01T12:00:00.000Z');
  const clock = { now: () => fixedNow };
  const statusPublisher: StatusPublisher = (statuses: CredentialStatusDTO[]) => {
    publishedStatuses = statuses;
  };

  const validSettings: AppSettingsDTO = {
    general: {
      theme: 'dark',
      language: 'vi',
      autoSaveConfig: true,
      sessionRestore: true,
    },
    browser: {
      provider: 'gpm',
      gpm: { port: 19995 },
      multilogin: { port: 35000, launcher: 'xcli' },
      gologin: { autoPort: true },
      camoufox: { headless: false },
      patchright: { headless: false },
    },
    logs: {
      retention: '30',
    },
    automation: {
      maxBillablePurchases: 0,
      threadCount: 10,
      browser: 'multilogin',
      headless: false,
      retryCount: 3,
      stepDelayMinMs: 500,
      stepDelayMaxMs: 2000,
      typeDelayMinMs: 50,
      typeDelayMaxMs: 150,
      module: 'trial',
      skipWithoutTrial: false,
      proxyMode: 'direct',
      proxyRegion: 'random',
      emailSourceMode: 'manual',
      emailApiProvider: 'gmail94',
      otpService: 'facebook',
      passwordMode: 'random',
      passwordLength: 12,
      includeUppercase: true,
      includeNumbers: true,
      includeSpecial: false,
    },
    customEmail: {
      domain: 'oldevlk.com',
      apiBaseUrl: 'http://103.116.38.76:3000',
      senderFilter: 'capcut',
    },
    exportConfig: {
      defaultFormat: 'xlsx',
      checkedFields: ['email', 'passwordCapcut', 'createdAt'],
      availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
    },
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-settings-svc-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = createDatabaseConnection(dbPath);
    runMigrations(db);
    vault = new FakeCredentialVault();
    registry = new InstrumentedProviderRegistry();
    publishedStatuses = null;
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
      db = null;
    }
    if (tempDir) {
      const normalizedTempDir = path.normalize(tempDir);
      const normalizedOsTmp = path.normalize(os.tmpdir());
      if (normalizedTempDir.startsWith(normalizedOsTmp) && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
          }
        }
      }
      tempDir = '';
      dbPath = '';
    }
  });

  describe('Diagnostics & Status Schemas', () => {
    it('diagnostics schema accepts PROVIDER_NOT_IMPLEMENTED code', () => {
      const validDiagResult = SanitizedDiagnosticResultSchema.parse({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.',
        timestamp: '2026-09-01T12:00:00.000Z',
      });
      expect(validDiagResult.code).toBe('PROVIDER_NOT_IMPLEMENTED');
    });

    it('credential status DTO requires isStale boolean property', () => {
      const validStatusDTO = CredentialStatusDTOSchema.parse({
        serviceName: 'gmail94',
        isConfigured: true,
        isStale: false,
        metadata: {
          maskedHint: 'sk-live-••••',
          status: 'unknown',
        },
      });
      expect(validStatusDTO.isStale).toBe(false);

      expect(() => {
        CredentialStatusDTOSchema.parse({
          serviceName: 'gmail94',
          isConfigured: true,
          metadata: {
            maskedHint: 'sk-live-••••',
            status: 'unknown',
          },
        });
      }).toThrow();
    });
  });

  describe('Legacy Settings Backward Compatibility', () => {
    it('legacy persisted settings without logs load with retention 30', () => {
      if (!db) throw new Error('Database not initialized');
      const legacySettingsJson = JSON.stringify({
        general: {
          theme: 'light',
          language: 'vi',
          autoSaveConfig: true,
          sessionRestore: true,
        },
        browser: {
          provider: 'gpm',
          gpm: { port: 19995 },
          multilogin: { port: 35000, launcher: 'xcli' },
          gologin: { autoPort: true },
          camoufox: { headless: false },
          patchright: { headless: false },
        },
        automation: {
          maxBillablePurchases: 0,
          threadCount: 10,
          browser: 'multilogin',
          headless: false,
          retryCount: 3,
          stepDelayMinMs: 500,
          stepDelayMaxMs: 2000,
          typeDelayMinMs: 50,
          typeDelayMaxMs: 150,
          module: 'trial',
          proxyMode: 'direct',
          emailSourceMode: 'manual',
          emailApiProvider: 'gmail94',
          otpService: 'facebook',
          passwordMode: 'random',
          passwordLength: 12,
          includeUppercase: true,
          includeNumbers: true,
          includeSpecial: false,
        },
        customEmail: {
          domain: 'oldevlk.com',
          apiBaseUrl: 'http://103.116.38.76:3000',
          senderFilter: 'capcut',
        },
        exportConfig: {
          defaultFormat: 'xlsx',
          checkedFields: ['email'],
          availableFields: ['email'],
        },
      });

      db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('app_settings', ?, '2026-08-31T00:00:00.000Z')")
        .run(legacySettingsJson);

      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      const result = settingsService.getSettingsWithCredentials();
      expect(result.settings.logs).toBeDefined();
      expect(result.settings.logs.retention).toBe('30');
      expect(result.settings.general.theme).toBe('light');
    });

    it('legacy settings read preserves raw database record without rewrite or deletion', () => {
      if (!db) throw new Error('Database not initialized');
      const legacySettingsJson = JSON.stringify({
        general: {
          theme: 'light',
          language: 'vi',
          autoSaveConfig: true,
          sessionRestore: true,
        },
        browser: {
          provider: 'gpm',
          gpm: { port: 19995 },
          multilogin: { port: 35000, launcher: 'xcli' },
          gologin: { autoPort: true },
          camoufox: { headless: false },
          patchright: { headless: false },
        },
        automation: {
          maxBillablePurchases: 0,
          threadCount: 10,
          browser: 'multilogin',
          headless: false,
          retryCount: 3,
          stepDelayMinMs: 500,
          stepDelayMaxMs: 2000,
          typeDelayMinMs: 50,
          typeDelayMaxMs: 150,
          module: 'trial',
          proxyMode: 'direct',
          emailSourceMode: 'manual',
          emailApiProvider: 'gmail94',
          otpService: 'facebook',
          passwordMode: 'random',
          passwordLength: 12,
          includeUppercase: true,
          includeNumbers: true,
          includeSpecial: false,
        },
        customEmail: {
          domain: 'oldevlk.com',
          apiBaseUrl: 'http://103.116.38.76:3000',
          senderFilter: 'capcut',
        },
        exportConfig: {
          defaultFormat: 'xlsx',
          checkedFields: ['email'],
          availableFields: ['email'],
        },
      });

      db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('app_settings', ?, '2026-08-31T00:00:00.000Z')")
        .run(legacySettingsJson);

      const rawBefore = db.prepare("SELECT key, value, updated_at FROM app_settings WHERE key = 'app_settings'").get() as { key: string; value: string; updated_at: string };
      const countBefore = (db.prepare('SELECT COUNT(*) as count FROM app_settings').get() as { count: number }).count;

      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      settingsService.getSettingsWithCredentials();

      const rawAfter = db.prepare("SELECT key, value, updated_at FROM app_settings WHERE key = 'app_settings'").get() as { key: string; value: string; updated_at: string };
      const countAfter = (db.prepare('SELECT COUNT(*) as count FROM app_settings').get() as { count: number }).count;

      expect(countAfter).toBe(countBefore);
      expect(rawAfter.key).toBe(rawBefore.key);
      expect(rawAfter.value).toBe(rawBefore.value);
      expect(rawAfter.updated_at).toBe(rawBefore.updated_at);
    });
  });

  describe('Settings Save & Credential Mutations', () => {
    it('settings save preserves credential when operation is keep', () => {
      if (!db) throw new Error('Database not initialized');
      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      credRepo.saveCredential('gmail94', Buffer.from('encrypted:original-gmail-key'), {
        maskedHint: 'sk-live-••••',
        status: 'unknown',
      });

      const saveRequest: SettingsSaveRequestDTO = {
        settings: validSettings,
        credentials: [
          {
            serviceName: 'gmail94',
            operation: { action: 'keep' },
          },
        ],
      };

      settingsService.saveSettingsWithCredentials(saveRequest);

      const cred = credRepo.getCredential('gmail94');
      expect(cred).toBeDefined();
      expect(cred?.encryptedCredentials.toString('utf8')).toBe('encrypted:original-gmail-key');
    });

    it('settings save writes encrypted ciphertext when operation is replace', () => {
      if (!db) throw new Error('Database not initialized');
      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      const saveRequest: SettingsSaveRequestDTO = {
        settings: validSettings,
        credentials: [
          {
            serviceName: 'kiotproxy',
            operation: { action: 'replace', value: 'secret-kiot-token' },
          },
        ],
      };

      settingsService.saveSettingsWithCredentials(saveRequest);

      const cred = credRepo.getCredential('kiotproxy');
      expect(cred).toBeDefined();
      expect(cred?.encryptedCredentials.toString('utf8')).toBe('encrypted:secret-kiot-token');
      expect(cred?.metadata.maskedHint).toBe('••••••••');
      expect(cred?.metadata.status).toBe('unknown');
    });

    it('settings save removes credential row when operation is clear', () => {
      if (!db) throw new Error('Database not initialized');
      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      credRepo.saveCredential('dongvanfb', Buffer.from('encrypted:old-dongvan-key'), {
        maskedHint: 'dongvan-••••',
        status: 'unknown',
      });

      const saveRequest: SettingsSaveRequestDTO = {
        settings: validSettings,
        credentials: [
          {
            serviceName: 'dongvanfb',
            operation: { action: 'clear' },
          },
        ],
      };

      settingsService.saveSettingsWithCredentials(saveRequest);

      const cred = credRepo.getCredential('dongvanfb');
      expect(cred).toBeNull();
    });

    it('pre-encryption failure on second replacement prevents transaction from starting and makes zero repository writes', () => {
      if (!db) throw new Error('Database not initialized');
      const settingsRepo = new SettingsRepository(db);
      const credRepo = new CredentialRepository(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, credRepo, runner, vault, connectionManager);

      settingsRepo.saveAppSettings(validSettings);
      credRepo.saveCredential('gmail94', Buffer.from('encrypted:initial-gmail-key'), {
        maskedHint: 'initial-••••',
        status: 'unknown',
      });

      vault.failOnSecond = true;

      const failingRequest: SettingsSaveRequestDTO = {
        settings: {
          ...validSettings,
          general: { ...validSettings.general, theme: 'light' },
        },
        credentials: [
          {
            serviceName: 'gmail94',
            operation: { action: 'replace', value: 'first-replacement-key' },
          },
          {
            serviceName: 'gologin',
            operation: { action: 'replace', value: 'second-replacement-fails' },
          },
        ],
      };

      expect(() => {
        settingsService.saveSettingsWithCredentials(failingRequest);
      }).toThrow('Simulated encryption failure on replacement secret');

      const settingsAfter = settingsRepo.getAppSettings();
      expect(settingsAfter?.general.theme).toBe('dark');

      const gmailAfter = credRepo.getCredential('gmail94');
      expect(gmailAfter?.encryptedCredentials.toString('utf8')).toBe('encrypted:initial-gmail-key');

      const gologinAfter = credRepo.getCredential('gologin');
      expect(gologinAfter).toBeNull();
    });

    it('repository failure on second credential mutation rolls back settings and credential writes inside transaction', () => {
      if (!db) throw new Error('Database not initialized');
      const settingsRepo = new SettingsRepository(db);
      const seedCredRepo = new CredentialRepository(db);

      settingsRepo.saveAppSettings(validSettings);
      seedCredRepo.saveCredential('gmail94', Buffer.from('encrypted:initial-gmail-key'), {
        maskedHint: 'initial-••••',
        status: 'unknown',
      });
      seedCredRepo.saveCredential('gologin', Buffer.from('encrypted:initial-gologin-token'), {
        maskedHint: 'gologin-••••',
        status: 'unknown',
      });

      const throwingCredRepo = new ThrowingSecondMutationCredentialRepo(db);
      const runner = new DatabaseTransactionRunner(db);
      const connectionManager = new ServiceConnectionManager(throwingCredRepo, vault, registry, clock, statusPublisher);
      const settingsService = new SettingsService(settingsRepo, throwingCredRepo, runner, vault, connectionManager);

      throwingCredRepo.mutationCount = 0;

      const multiMutationRequest: SettingsSaveRequestDTO = {
        settings: {
          ...validSettings,
          general: { ...validSettings.general, theme: 'light' },
        },
        credentials: [
          {
            serviceName: 'gmail94',
            operation: { action: 'replace', value: 'new-gmail-key' },
          },
          {
            serviceName: 'gologin',
            operation: { action: 'replace', value: 'new-gologin-token' },
          },
        ],
      };

      expect(() => {
        settingsService.saveSettingsWithCredentials(multiMutationRequest);
      }).toThrow('Simulated repository failure on second credential mutation');

      const settingsAfter = settingsRepo.getAppSettings();
      expect(settingsAfter?.general.theme).toBe('dark');

      const gmailAfter = seedCredRepo.getCredential('gmail94');
      expect(gmailAfter?.encryptedCredentials.toString('utf8')).toBe('encrypted:initial-gmail-key');

      const gologinAfter = seedCredRepo.getCredential('gologin');
      expect(gologinAfter?.encryptedCredentials.toString('utf8')).toBe('encrypted:initial-gologin-token');
    });
  });

  describe('ServiceConnectionManager Diagnostics & Connectivity', () => {
    it('ServiceConnectionManager getDiagnosticStatuses makes zero provider network calls', () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      credRepo.saveCredential('gmail94', Buffer.from('encrypted:gmail-key'), {
        maskedHint: 'gmail-••••',
        status: 'connected',
      });

      connectionManager.getDiagnosticStatuses();

      expect(registry.getCalls.length).toBe(0);
      expect(registry.hasCalls.length).toBe(0);
      expect(vault.decryptCallCount).toBe(0);
    });

    it('ServiceConnectionManager derives stale true when lastTestedAt exceeds 24 hours', () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      const staleTime = new Date(fixedNow - 25 * 3600 * 1000).toISOString();
      credRepo.saveCredential('gmail94', Buffer.from('encrypted:gmail-key'), {
        maskedHint: 'gmail-••••',
        status: 'connected',
        lastTestedAt: staleTime,
      });

      const statuses = connectionManager.getDiagnosticStatuses();
      const gmailStatus = statuses.find((s) => s.serviceName === 'gmail94');
      expect(gmailStatus).toBeDefined();
      expect(gmailStatus?.isStale).toBe(true);
    });

    it('ServiceConnectionManager derives stale false when lastTestedAt is within 24 hours', () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      const freshTime = new Date(fixedNow - 1 * 3600 * 1000).toISOString();
      credRepo.saveCredential('gologin', Buffer.from('encrypted:gologin-token'), {
        maskedHint: 'gologin-••••',
        status: 'connected',
        lastTestedAt: freshTime,
      });

      const statuses = connectionManager.getDiagnosticStatuses();
      const gologinStatus = statuses.find((s) => s.serviceName === 'gologin');
      expect(gologinStatus).toBeDefined();
      expect(gologinStatus?.isStale).toBe(false);
    });

    it('ServiceConnectionManager derives stale false when lastTestedAt is missing', () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      credRepo.saveCredential('kiotproxy', Buffer.from('encrypted:kiot-key'), {
        maskedHint: 'kiot-••••',
        status: 'unknown',
      });

      const statuses = connectionManager.getDiagnosticStatuses();
      const kiotStatus = statuses.find((s) => s.serviceName === 'kiotproxy');
      expect(kiotStatus).toBeDefined();
      expect(kiotStatus?.isStale).toBe(false);
    });

    it('ServiceConnectionManager publishes sanitized status array on status query', () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      credRepo.saveCredential('gmail94', Buffer.from('encrypted:gmail-key'), {
        maskedHint: 'gmail-••••',
        status: 'unknown',
      });

      const statuses = connectionManager.getDiagnosticStatuses();
      expect(publishedStatuses).toBeDefined();
      expect(publishedStatuses).toEqual(statuses);
    });

    it('testConnection with unregistered provider returns PROVIDER_NOT_IMPLEMENTED without altering cached metadata', async () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      credRepo.saveCredential('gmail94', Buffer.from('encrypted:gmail-key'), {
        maskedHint: 'gmail-••••',
        status: 'unknown',
      });

      const result = await connectionManager.testConnection('gmail94');

      expect(result).toEqual({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.',
        timestamp: new Date(fixedNow).toISOString(),
      });

      const credAfterTest = credRepo.getCredential('gmail94');
      expect(credAfterTest).toBeDefined();
      expect(credAfterTest?.metadata.status).toBe('unknown');
      expect(credAfterTest?.metadata.lastTestResult).toBeUndefined();
    });

    it('testConnection with unregistered provider does not publish fake status event', async () => {
      if (!db) throw new Error('Database not initialized');
      const credRepo = new CredentialRepository(db);
      const connectionManager = new ServiceConnectionManager(credRepo, vault, registry, clock, statusPublisher);

      credRepo.saveCredential('gmail94', Buffer.from('encrypted:gmail-key'), {
        maskedHint: 'gmail-••••',
        status: 'unknown',
      });

      publishedStatuses = null;
      await connectionManager.testConnection('gmail94');

      expect(publishedStatuses).toBeNull();
    });
  });
});
