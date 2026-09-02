import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createDatabaseConnection } from '../connection';
import type Database from 'better-sqlite3';

interface SimpleValueRow {
  id: number;
  value: string;
}

describe('SQLite Connection Factory (Task 4 RED)', () => {
  let db: Database.Database | null = null;
  let tempDir = '';

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
    }
  });

  it('creates SQLite connection and enforces all mandatory PRAGMAs effectively', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-conn-test-'));
    const dbPath = path.join(tempDir, 'test.db');

    db = createDatabaseConnection(dbPath);
    expect(db.open).toBe(true);

    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(String(journalMode).toLowerCase()).toBe('wal');

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    expect(foreignKeys).toBe(1);

    const synchronous = db.pragma('synchronous', { simple: true });
    expect(synchronous).toBe(1); // 1 = NORMAL in SQLite

    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    expect(busyTimeout).toBe(5000);
  });

  it('persists data across connection close and reopen on the same file path', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-persist-test-'));
    const dbPath = path.join(tempDir, 'persist.db');

    db = createDatabaseConnection(dbPath);
    db.exec('CREATE TABLE test_persist (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
    db.prepare('INSERT INTO test_persist (id, value) VALUES (?, ?)').run(1, 'persisted_data');
    db.close();
    db = null;

    // Reopen connection on the exact same database file path
    const reopenedDb = createDatabaseConnection(dbPath);
    db = reopenedDb;

    const row = reopenedDb.prepare('SELECT id, value FROM test_persist WHERE id = ?').get(1) as SimpleValueRow | undefined;
    expect(row).toBeDefined();
    expect(row?.id).toBe(1);
    expect(row?.value).toBe('persisted_data');
  });
});
