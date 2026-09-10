import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { SettingsRepository } from '../SettingsRepository';
import { CredentialRepository, DataCorruptionError } from '../CredentialRepository';
import { AccountRepository, type CreateAccountRecordInput, type UpdateAccountRecordInput } from '../AccountRepository';
import { LogRepository } from '../LogRepository';
import type { AppSettingsDTO } from '../../../shared/schemas/settings.schema';
import type { CredentialDiagnosticMetadata } from '../../../shared/schemas/diagnostics.schema';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';
import type Database from 'better-sqlite3';

describe('Repository Layer Behavior Suite (Task 6 RED)', () => {
  let db: Database.Database | null = null;
  let tempDir = '';
  let dbPath = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-repo-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = createDatabaseConnection(dbPath);
    runMigrations(db);
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

  describe('SettingsRepository', () => {
    const validSettings: AppSettingsDTO = {
      general: {
        theme: 'dark',
        language: 'vi',
        autoSaveConfig: true,
        sessionRestore: true
      },
      browser: {
        provider: 'gpm',
        gpm: { port: 19995 },
        multilogin: { port: 35000, launcher: 'xcli' },
        gologin: { autoPort: true },
        camoufox: { headless: false },
        patchright: { headless: false }
      },
      logs: {
        retention: '30'
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
        proxyList: '',
        proxyKeyList: '',
        emailSourceMode: 'manual',
        emailApiProvider: 'gmail94',
        emailRetryIntervalSeconds: 15,
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
        checkedFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
        availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt']
      }
    };

    it('returns null when settings are not configured', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new SettingsRepository(db);
      expect(repo.getAppSettings()).toBeNull();
    });

    it('upserts and reads AppSettingsDTO faithfully', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new SettingsRepository(db);

      repo.saveAppSettings(validSettings);
      const retrieved = repo.getAppSettings();

      expect(retrieved).toEqual(validSettings);

      // Update settings
      const updatedSettings: AppSettingsDTO = {
        ...validSettings,
        general: { ...validSettings.general, theme: 'light' }
      };
      repo.saveAppSettings(updatedSettings);

      const secondRetrieved = repo.getAppSettings();
      expect(secondRetrieved?.general.theme).toBe('light');
    });

    it('throws DataCorruptionError when stored app_settings JSON is corrupted', () => {
      if (!db) throw new Error('DB is not initialized');
      const activeDb = db;
      const repo = new SettingsRepository(activeDb);

      activeDb.prepare("INSERT INTO app_settings (key, value) VALUES ('app_settings', '{corrupt-json-payload')").run();

      expect(() => repo.getAppSettings()).toThrow(DataCorruptionError);
    });
  });

  describe('CredentialRepository', () => {
    const validMetadata: CredentialDiagnosticMetadata = {
      maskedHint: 'gl-••••36a3',
      status: 'connected',
      lastTestedAt: '2026-09-01T00:00:00.000Z',
      lastTestResult: {
        code: 'OK',
        message: 'Connection verified',
        timestamp: '2026-09-01T00:00:00.000Z',
        details: { latencyMs: 120, profileCount: 4 }
      },
      balance: 500000,
      balanceFetchedAt: '2026-09-01T00:00:00.000Z'
    };

    it('stores Buffer ciphertext byte-for-byte and returns parsed metadata', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new CredentialRepository(db);
      const rawSecretBytes = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37, 0xde, 0xad, 0xbe, 0xef]);

      repo.saveCredential('gologin', rawSecretBytes, validMetadata);

      const record = repo.getCredential('gologin');
      expect(record).not.toBeNull();
      expect(record?.serviceName).toBe('gologin');
      expect(Buffer.isBuffer(record?.encryptedCredentials)).toBe(true);
      expect(Buffer.compare(record?.encryptedCredentials ?? Buffer.alloc(0), rawSecretBytes)).toBe(0);
      expect(record?.metadata).toEqual(validMetadata);
    });

    it('updates metadata without modifying existing ciphertext', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new CredentialRepository(db);
      const rawSecretBytes = Buffer.from('original_encrypted_payload');

      repo.saveCredential('multilogin', rawSecretBytes, validMetadata);

      const updatedMeta: CredentialDiagnosticMetadata = {
        ...validMetadata,
        status: 'offline',
        lastTestResult: {
          code: 'NETWORK_ERROR',
          message: 'Host unreachable',
          timestamp: '2026-09-01T01:00:00.000Z'
        }
      };

      repo.updateMetadata('multilogin', updatedMeta);

      const record = repo.getCredential('multilogin');
      expect(record?.metadata.status).toBe('offline');
      expect(record?.metadata.lastTestResult?.code).toBe('NETWORK_ERROR');
      expect(Buffer.compare(record?.encryptedCredentials ?? Buffer.alloc(0), rawSecretBytes)).toBe(0);
    });

    it('throws DataCorruptionError when stored metadata is invalid JSON, redacting raw content', () => {
      if (!db) throw new Error('DB is not initialized');
      const activeDb = db;
      const repo = new CredentialRepository(activeDb);
      const fakeCipher = Buffer.from('secret-cipher');

      activeDb.prepare("INSERT INTO service_credentials (service_name, encrypted_credentials, metadata) VALUES ('gmail94', ?, 'CORRUPT_NOT_JSON')").run(fakeCipher);

      let thrownError: Error | null = null;
      try {
        repo.getCredential('gmail94');
      } catch (err: unknown) {
        if (err instanceof Error) {
          thrownError = err;
        }
      }

      expect(thrownError).toBeInstanceOf(DataCorruptionError);
      expect(thrownError?.message).not.toContain('CORRUPT_NOT_JSON');
    });
  });

  describe('AccountRepository', () => {
    /**
     * Bộ lọc "Ngày tạo" trên toolbar Accounts trước đây chỉ đổi state rồi bật chip
     * "Active Filters" — không một dòng SQL nào dùng tới (audit 04/09/2026).
     * `created_at` lưu dạng `YYYY-MM-DD HH:MM:SS` UTC nên repo phải tự đổi mốc ISO
     * sang đúng dạng đó, không thì phép so chuỗi trượt sạch.
     */
    it('lọc theo createdFrom, đổi mốc ISO sang dạng ngày của SQLite', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      repo.createAccount({ id: 'old', email: 'old@x.com', emailProvider: 'gmail94' });
      repo.createAccount({ id: 'new', email: 'new@x.com', emailProvider: 'gmail94' });
      db.prepare("UPDATE accounts SET created_at = '2026-08-01 10:00:00' WHERE id = 'old'").run();
      db.prepare("UPDATE accounts SET created_at = '2026-09-04 10:00:00' WHERE id = 'new'").run();

      const result = repo.listAccounts({
        page: 1,
        pageSize: 50,
        createdFrom: '2026-09-01T00:00:00.000Z'
      });

      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe('new');
    });

    it('xuất file dùng CHUNG bộ lọc ngày với danh sách', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      repo.createAccount({ id: 'old', email: 'old@x.com', emailProvider: 'gmail94' });
      repo.createAccount({ id: 'new', email: 'new@x.com', emailProvider: 'gmail94' });
      db.prepare("UPDATE accounts SET created_at = '2026-08-01 10:00:00' WHERE id = 'old'").run();

      const rows = repo.queryAccountsForExport({ createdFrom: '2026-09-01T00:00:00.000Z' });

      expect(rows.map((r) => r.id)).toEqual(['new']);
    });

    it('UI-01 filters export and list by browserProvider', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      repo.createAccount({ id: 'ml', email: 'ml@x.com', emailProvider: 'gmail94', browserProvider: 'multilogin' });
      repo.createAccount({ id: 'gpm', email: 'gpm@x.com', emailProvider: 'gmail94', browserProvider: 'gpm' });

      const exported = repo.queryAccountsForExport({ browserProvider: 'multilogin' });
      expect(exported.map((r) => r.id)).toEqual(['ml']);

      const listed = repo.listAccounts({ page: 1, pageSize: 50, browserProvider: 'multilogin' });
      expect(listed.total).toBe(1);
      expect(listed.items.map((r) => r.id)).toEqual(['ml']);
    });

    it('UI-01 iterates 1201 accounts without omission or duplication', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      db.transaction(() => {
        for (let i = 1; i <= 1201; i++) {
          repo.createAccount({
            id: `acc-${i}`,
            email: `worker-${i}@example.com`,
            emailProvider: 'gmail94'
          });
        }
      })();

      const collected: string[] = [];
      let page = 1;
      const pageSize = 500;
      while (true) {
        const result = repo.listAccounts({ page, pageSize });
        collected.push(...result.items.map((item) => item.id));
        if (collected.length >= result.total || result.items.length === 0) break;
        page++;
      }

      expect(collected).toHaveLength(1201);
      expect(new Set(collected).size).toBe(1201);
    });

    it('creates, gets, and maps AccountListItemDTO with boolean indicators and zero plaintext secrets', () => {

      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      const createInput: CreateAccountRecordInput = {
        id: 'acc-uuid-1',
        email: 'worker@domain.com',
        emailProvider: 'gmail94',
        emailPasswordEncrypted: Buffer.from('encEmailPass'),
        passwordCapcutEncrypted: Buffer.from('encCapcutPass'),
        emailDataEncrypted: null,
        credit: 15,
        subscription: 'Free Trial',
        status: 'active',
        automationStep: 'Idle',
        proxy: '10.0.0.1:8080',
        browserProvider: 'gpm',
        browserProfileId: 'gpm-profile-1',
        notes: 'Worker Node 1'
      };

      repo.createAccount(createInput);

      const direct = repo.getAccountById('acc-uuid-1');
      expect(direct).not.toBeNull();
      expect(direct?.email).toBe('worker@domain.com');
      expect(Buffer.isBuffer(direct?.passwordCapcutEncrypted)).toBe(true);

      const listResult = repo.listAccounts({ page: 1, pageSize: 50 });
      expect(listResult.total).toBe(1);
      expect(listResult.items.length).toBe(1);

      const item = listResult.items[0];
      expect(item.id).toBe('acc-uuid-1');
      expect(item.email).toBe('worker@domain.com');
      expect(item.hasEmailPassword).toBe(true);
      expect(item.hasPasswordCapcut).toBe(true);
      expect(item.hasEmailData).toBe(false);
      expect((item as Record<string, unknown>).passwordCapcut).toBeUndefined();
      expect((item as Record<string, unknown>).emailPassword).toBeUndefined();
    });

    it('performs write-only secret keep/replace/clear operations correctly', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      const initialCapcutPass = Buffer.from('initialCapcutPass');
      const initialEmailPass = Buffer.from('initialEmailPass');

      repo.createAccount({
        id: 'acc-uuid-2',
        email: 'user2@domain.com',
        emailProvider: 'dongvanfb',
        passwordCapcutEncrypted: initialCapcutPass,
        emailPasswordEncrypted: initialEmailPass
      });

      // Update: keep passwordCapcut, replace emailPassword, clear emailData
      const newEmailPass = Buffer.from('newEmailPass');
      const updateInput: UpdateAccountRecordInput = {
        passwordCapcutOp: { action: 'keep' },
        emailPasswordOp: { action: 'replace', encryptedValue: newEmailPass },
        emailDataOp: { action: 'clear' },
        credit: 99
      };

      const updated = repo.updateAccount('acc-uuid-2', updateInput);
      expect(updated).toBe(true);

      const record = repo.getAccountById('acc-uuid-2');
      expect(record?.credit).toBe(99);
      expect(Buffer.compare(record?.passwordCapcutEncrypted ?? Buffer.alloc(0), initialCapcutPass)).toBe(0);
      expect(Buffer.compare(record?.emailPasswordEncrypted ?? Buffer.alloc(0), newEmailPass)).toBe(0);
      expect(record?.emailDataEncrypted).toBeNull();
    });

    it('handles search queries safely with SQL-injection-like inputs and pagination bounds (1–500)', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      for (let i = 1; i <= 5; i++) {
        repo.createAccount({
          id: `acc-${i}`,
          email: `test${i}@domain.com`,
          emailProvider: 'gmail94',
          status: 'active'
        });
      }

      // SQL injection query string should be safely bound
      const sqlInjectionQuery = "' OR '1'='1";
      const injectionResult = repo.listAccounts({ query: sqlInjectionQuery, page: 1, pageSize: 50 });
      expect(injectionResult.total).toBe(0);

      // Pagination bounds
      const clampedLow = repo.listAccounts({ page: -5, pageSize: -10 });
      expect(clampedLow.items.length).toBe(1); // clamped to page 1, pageSize default/min (1)
      expect(clampedLow.total).toBe(5);

      const clampedHigh = repo.listAccounts({ page: 1, pageSize: 9999 });
      expect(clampedHigh.items.length).toBe(5); // clamped to max 500
    });

    it('handles empty IDs array deletion without invalid SQL', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      const deletedCount = repo.deleteAccounts([]);
      expect(deletedCount).toBe(0);
    });

    it('deletes selected accounts by IDs', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new AccountRepository(db);

      repo.createAccount({ id: 'acc-del-1', email: 'd1@test.com', emailProvider: 'gmail94' });
      repo.createAccount({ id: 'acc-del-2', email: 'd2@test.com', emailProvider: 'gmail94' });

      const deleted = repo.deleteAccounts(['acc-del-1', 'acc-del-2']);
      expect(deleted).toBe(2);
      expect(repo.getAccountById('acc-del-1')).toBeNull();
    });
  });

  describe('LogRepository', () => {
    beforeEach(() => {
      if (db) {
        db.prepare("INSERT INTO accounts (id, email, email_provider) VALUES ('acc-log-1', 'logger@domain.com', 'gmail94')").run();
      }
    });

    const createSampleLog = (id: string, status: CanonicalRuntimeLog['status'] = 'INFO', offsetDays = 0): CanonicalRuntimeLog => {
      const date = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
      return {
        id,
        accountId: 'acc-log-1',
        email: 'logger@domain.com',
        step: 'Proxy',
        status,
        message: `Log message for ${id}`,
        createdAt: date.toISOString()
      };
    };

    it('inserts logs in a single synchronous transaction and queries them with bounds', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new LogRepository(db);

      const logs: CanonicalRuntimeLog[] = [
        createSampleLog('log-1', 'INFO'),
        createSampleLog('log-2', 'SUCCESS'),
        createSampleLog('log-3', 'ERROR')
      ];

      repo.insertBatch(logs);

      const result = repo.queryLogs({ page: 1, pageSize: 50 });
      expect(result.total).toBe(3);
      expect(result.items.length).toBe(3);
      expect(result.items[0].status).toBeDefined();
    });

    it('rolls back entire batch if an invalid log causes insertion failure', () => {
      if (!db) throw new Error('DB is not initialized');
      const activeDb = db;
      const repo = new LogRepository(activeDb);

      const initialLog = createSampleLog('log-existing', 'INFO');
      repo.insertBatch([initialLog]);

      const duplicateBatch: CanonicalRuntimeLog[] = [
        createSampleLog('log-new-1', 'INFO'),
        createSampleLog('log-existing', 'ERROR') // duplicate primary key causes failure
      ];

      expect(() => repo.insertBatch(duplicateBatch)).toThrow();

      const result = repo.queryLogs({ page: 1, pageSize: 50 });
      expect(result.total).toBe(1); // Only the initial log exists; log-new-1 was rolled back
    });

    it('filters logs by level, email, and safe parameter bindings', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new LogRepository(db);

      repo.insertBatch([
        createSampleLog('log-a', 'INFO'),
        createSampleLog('log-b', 'ERROR'),
        createSampleLog('log-c', 'WARNING')
      ]);

      const infoOnly = repo.queryLogs({ level: 'INFO', page: 1, pageSize: 50 });
      expect(infoOnly.total).toBe(1);
      expect(infoOnly.items[0].status).toBe('INFO');

      const injectionQuery = repo.queryLogs({ email: "' OR '1'='1", page: 1, pageSize: 50 });
      expect(injectionQuery.total).toBe(0);
    });

    it('cleans up logs older than retention days (7, 30, 90) and rejects negative retention days', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new LogRepository(db);

      repo.insertBatch([
        createSampleLog('log-today', 'INFO', 0),
        createSampleLog('log-10days', 'INFO', 10),
        createSampleLog('log-40days', 'INFO', 40),
        createSampleLog('log-100days', 'INFO', 100)
      ]);

      expect(() => repo.cleanupOldLogs(-5)).toThrow(/Retention days must be non-negative/);

      // Clean logs older than 30 days
      const deleted = repo.cleanupOldLogs(30);
      expect(deleted).toBe(2); // 40days and 100days deleted

      const remaining = repo.queryLogs({ page: 1, pageSize: 50 });
      expect(remaining.total).toBe(2); // today and 10days remaining
    });

    it('clears all logs on clearAllLogs()', () => {
      if (!db) throw new Error('DB is not initialized');
      const repo = new LogRepository(db);

      repo.insertBatch([createSampleLog('l1'), createSampleLog('l2')]);
      expect(repo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(2);

      repo.clearAllLogs();
      expect(repo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(0);
    });
  });
});
