import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createDatabaseConnection } from '../connection';
import {
  runMigrations,
  getAppliedMigrations,
  validateMigrationRegistry,
  computeMigrationChecksum,
  MigrationChecksumMismatchError,
  type MigrationItem
} from '../migrator';
import { MIGRATIONS } from '../migrations';
import type Database from 'better-sqlite3';

interface SqliteMasterRow {
  name: string;
}

interface QueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

interface AppliedMigrationRow {
  version: number;
  checksum: string;
  applied_at: string;
}

interface SettingRow {
  key: string;
  value: string;
}

interface AccountTestRow {
  id: string;
  email: string;
}

describe('Migration Engine & Schema Integrity (Task 5 RED)', () => {
  let db: Database.Database | null = null;
  let tempDir = '';
  let dbPath = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-migrator-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = createDatabaseConnection(dbPath);
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

  describe('Registry Validation', () => {
    it('validates production MIGRATIONS registry passes integrity check', () => {
      expect(() => validateMigrationRegistry(MIGRATIONS)).not.toThrow();
    });

    it('rejects duplicate migration versions', () => {
      const duplicateVersion: MigrationItem[] = [
        { version: 1, name: '001_initial', sql: 'CREATE TABLE t1 (id TEXT);' },
        { version: 1, name: '001_duplicate', sql: 'CREATE TABLE t2 (id TEXT);' }
      ];
      expect(() => validateMigrationRegistry(duplicateVersion)).toThrow(/Duplicate migration version/);
    });

    it('rejects version sequence gaps', () => {
      const gappedVersion: MigrationItem[] = [
        { version: 1, name: '001_initial', sql: 'CREATE TABLE t1 (id TEXT);' },
        { version: 3, name: '003_future', sql: 'CREATE TABLE t3 (id TEXT);' }
      ];
      expect(() => validateMigrationRegistry(gappedVersion)).toThrow(/Migration version gap/);
    });

    it('rejects empty or whitespace-only migration SQL', () => {
      const emptySql: MigrationItem[] = [
        { version: 1, name: '001_initial', sql: '   \n\t  ' }
      ];
      expect(() => validateMigrationRegistry(emptySql)).toThrow(/Empty SQL/);
    });

    it('rejects duplicate migration names', () => {
      const duplicateNames: MigrationItem[] = [
        { version: 1, name: '001_same_name', sql: 'CREATE TABLE t1 (id TEXT);' },
        { version: 2, name: '001_same_name', sql: 'CREATE TABLE t2 (id TEXT);' }
      ];
      expect(() => validateMigrationRegistry(duplicateNames)).toThrow(/Duplicate migration name/);
    });
  });

  describe('Migration Execution & Schema Verification', () => {
    it('creates schema_migrations with version/checksum/applied_at and initial domain tables', () => {
      if (!db) throw new Error('DB is not initialized');

      const result = runMigrations(db);
      expect(result.appliedCount).toBe(MIGRATIONS.length);

      const applied = getAppliedMigrations(db);
      expect(applied.length).toBe(MIGRATIONS.length);
      expect(applied[0].version).toBe(1);
      expect(typeof applied[0].checksum).toBe('string');
      expect(applied[0].checksum.length).toBe(64); // SHA-256 hex length
      expect(typeof applied[0].applied_at).toBe('string');

      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[];
      const tableNames = rows.map((r) => r.name);

      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('app_settings');
      expect(tableNames).toContain('service_credentials');
      expect(tableNames).toContain('accounts');
      expect(tableNames).toContain('runtime_logs');
    });

    it('creates query-driven indexes and EXPLAIN QUERY PLAN confirms their usage', () => {
      if (!db) throw new Error('DB is not initialized');
      runMigrations(db);

      // Verify accounts status index
      const statusPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM accounts WHERE status = ?').all('active') as QueryPlanRow[];
      expect(statusPlan.some((p) => p.detail.includes('USING INDEX idx_accounts_status'))).toBe(true);

      // Verify accounts email_provider index
      const emailProviderPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM accounts WHERE email_provider = ?').all('gmail94') as QueryPlanRow[];
      expect(emailProviderPlan.some((p) => p.detail.includes('USING INDEX idx_accounts_email_provider'))).toBe(true);

      // Verify accounts browser_provider index
      const browserProviderPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM accounts WHERE browser_provider = ?').all('gpm') as QueryPlanRow[];
      expect(browserProviderPlan.some((p) => p.detail.includes('USING INDEX idx_accounts_browser_provider'))).toBe(true);

      // Verify runtime_logs status index
      const logStatusPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM runtime_logs WHERE status = ?').all('INFO') as QueryPlanRow[];
      expect(logStatusPlan.some((p) => p.detail.includes('USING INDEX idx_logs_status'))).toBe(true);

      // Verify runtime_logs account_id index
      const logAccountPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM runtime_logs WHERE account_id = ?').all('acc-123') as QueryPlanRow[];
      expect(logAccountPlan.some((p) => p.detail.includes('USING INDEX idx_logs_account_id'))).toBe(true);
    });

    it('commits migration DDL and schema_migrations record in the same synchronous transaction', () => {
      if (!db) throw new Error('DB is not initialized');
      runMigrations(db);

      const appliedRow = db.prepare('SELECT version, checksum, applied_at FROM schema_migrations WHERE version = 1').get() as AppliedMigrationRow | undefined;
      expect(appliedRow).toBeDefined();
      expect(appliedRow?.version).toBe(1);

      const expectedChecksum = computeMigrationChecksum(MIGRATIONS[0].sql);
      expect(appliedRow?.checksum).toBe(expectedChecksum);
    });

    it('rolls back completely if invalid SQL statement occurs after valid DDL in migration', () => {
      if (!db) throw new Error('DB is not initialized');
      const activeDb = db;

      const brokenMigrations: MigrationItem[] = [
        {
          version: 1,
          name: '001_initial',
          sql: 'CREATE TABLE atomic_table (id TEXT); THIS_IS_INVALID_SQL_SYNTAX;'
        }
      ];

      expect(() => runMigrations(activeDb, brokenMigrations)).toThrow();

      // schema_migrations bootstrap table may exist, but its rows must remain empty
      const applied = getAppliedMigrations(activeDb);
      expect(applied.length).toBe(0);

      // atomic_table created before the invalid syntax must be rolled back completely
      const rows = activeDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[];
      const tableNames = rows.map((r) => r.name);
      expect(tableNames).not.toContain('atomic_table');
    });

    it('persists data and is idempotent on reopen without reapplying migrations', () => {
      if (!db) throw new Error('DB is not initialized');
      runMigrations(db);

      db.prepare("INSERT INTO app_settings (key, value) VALUES ('general_theme', '\"dark\"')").run();
      db.prepare("INSERT INTO accounts (id, email, email_provider) VALUES ('acc-1', 'user@example.com', 'gmail')").run();
      db.close();
      db = null;

      // Reopen file
      const reopenedDb = createDatabaseConnection(dbPath);
      db = reopenedDb;

      // Second runMigrations call should detect version 1 already applied and do nothing
      const rerunResult = runMigrations(reopenedDb);
      expect(rerunResult.appliedCount).toBe(0);

      // Verify persisted data survived
      const settingRow = reopenedDb.prepare("SELECT value FROM app_settings WHERE key = 'general_theme'").get() as SettingRow | undefined;
      expect(settingRow).toBeDefined();
      expect(JSON.parse(settingRow?.value ?? '')).toBe('dark');

      const accountRow = reopenedDb.prepare("SELECT id, email FROM accounts WHERE id = 'acc-1'").get() as AccountTestRow | undefined;
      expect(accountRow?.email).toBe('user@example.com');
    });

    it('throws static MigrationChecksumMismatchError when applied migration SQL is altered', () => {
      if (!db) throw new Error('DB is not initialized');
      const activeDb = db;
      runMigrations(activeDb);

      const tamperedMigrations: MigrationItem[] = [
        {
          version: 1,
          name: '001_initial_schema',
          sql: '-- ALTERED SQL CONTENT THAT CHANGES CHECKSUM'
        }
      ];

      expect(() => runMigrations(activeDb, tamperedMigrations)).toThrow(MigrationChecksumMismatchError);

      // Ensure database remains accessible and untampered
      const applied = getAppliedMigrations(activeDb);
      expect(applied.length).toBe(MIGRATIONS.length);
    });

    it('applies future consecutive migrations incrementally', () => {
      if (!db) throw new Error('DB is not initialized');
      const firstRun = runMigrations(db);
      expect(firstRun.appliedCount).toBe(MIGRATIONS.length);

      const nextVersion = MIGRATIONS.length + 1;
      const extendedMigrations: MigrationItem[] = [
        ...MIGRATIONS,
        {
          version: nextVersion,
          name: String(nextVersion).padStart(3, '0') + '_add_test_feature_table',
          sql: 'CREATE TABLE test_feature (id TEXT PRIMARY KEY, description TEXT);'
        }
      ];

      const secondRun = runMigrations(db, extendedMigrations);
      expect(secondRun.appliedCount).toBe(1);

      const applied = getAppliedMigrations(db);
      expect(applied.map((a) => a.version)).toEqual(
        Array.from({ length: nextVersion }, (_unused, index) => index + 1)
      );

      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[];
      const tableNames = rows.map((r) => r.name);
      expect(tableNames).toContain('test_feature');
    });
  });
});
