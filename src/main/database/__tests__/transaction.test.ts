import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../connection';
import { runMigrations } from '../migrator';
import { DatabaseTransactionRunner } from '../transaction';
import { SettingsRepository } from '../../repositories/SettingsRepository';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import type { AppSettingsDTO } from '../../../shared/schemas/settings.schema';

describe('DatabaseTransactionRunner (Task 2.1.1 RED)', () => {
  let db: Database.Database | null = null;
  let tempDir = '';
  let dbPath = '';

  const sampleSettings: AppSettingsDTO = {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-tx-test-'));
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

  it('synchronous transaction runner returns a value', () => {
    if (!db) throw new Error('Database not initialized');
    const runner = new DatabaseTransactionRunner(db);

    const result = runner.run(() => {
      db!.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('test_key', '\"test_val\"', '2026-09-01T00:00:00.000Z')").run();
      return 12345;
    });

    expect(result).toBe(12345);
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'test_key'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.value).toBe('"test_val"');
  });

  it('thrown transaction rolls back writes across settings and credential repositories sharing one connection', () => {
    if (!db) throw new Error('Database not initialized');
    const runner = new DatabaseTransactionRunner(db);
    const settingsRepo = new SettingsRepository(db);
    const credRepo = new CredentialRepository(db);

    expect(() => {
      runner.run(() => {
        settingsRepo.saveAppSettings(sampleSettings);
        credRepo.saveCredential('gmail94', Buffer.from('cipher-payload'), {
          maskedHint: 'sk-live-••••',
          status: 'unknown',
        });
        throw new Error('Simulated atomic write failure inside transaction');
      });
    }).toThrow('Simulated atomic write failure inside transaction');

    const storedSettings = settingsRepo.getAppSettings();
    expect(storedSettings).toBeNull();

    const storedCred = credRepo.getCredential('gmail94');
    expect(storedCred).toBeNull();
  });
});
