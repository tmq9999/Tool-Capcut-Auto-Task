import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export class DatabaseConfigurationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseConfigurationError';
  }
}

export function createDatabaseConnection(databasePath: string): Database.Database {
  if (!databasePath || typeof databasePath !== 'string' || databasePath.trim().length === 0) {
    throw new DatabaseConfigurationError('Database path must be a non-empty string.');
  }

  const parentDir = path.dirname(databasePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  let db: Database.Database | null = null;

  try {
    db = new Database(databasePath, {
      timeout: 5000
    });

    // Enforce mandatory PRAGMAs per AGENTS.md Section 9
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    // Read back and verify effective PRAGMA configuration
    const journalMode = db.pragma('journal_mode', { simple: true });
    if (typeof journalMode !== 'string' || journalMode.toLowerCase() !== 'wal') {
      throw new DatabaseConfigurationError('Failed to verify WAL journal mode.');
    }

    const synchronous = db.pragma('synchronous', { simple: true });
    if (synchronous !== 1) {
      throw new DatabaseConfigurationError('Failed to verify NORMAL synchronous mode.');
    }

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    if (foreignKeys !== 1) {
      throw new DatabaseConfigurationError('Failed to verify foreign_keys ON.');
    }

    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    if (busyTimeout !== 5000) {
      throw new DatabaseConfigurationError('Failed to verify busy_timeout 5000ms.');
    }

    return db;
  } catch (err: unknown) {
    if (db && db.open) {
      try {
        db.close();
      } catch {
        throw new DatabaseConfigurationError('Failed to close database connection during initialization cleanup.');
      }
    }
    if (err instanceof DatabaseConfigurationError) {
      throw err;
    }
    /**
     * Mang theo nguyên nhân GỐC (AGENTS.md §27). Bản cũ chỉ ném câu chung, nên
     * bản đóng gói 04/09/2026 chết với đúng một dòng "Failed to initialize and
     * configure SQLite database connection." — không phân biệt được `.node`
     * không load được, đường dẫn DB sai, hay không có quyền ghi. Đường dẫn DB
     * do `app.getPath('userData')` sinh ra, không phải secret.
     */
    const cause = err instanceof Error ? err.message : String(err);
    throw new DatabaseConfigurationError(
      'Failed to initialize and configure SQLite database connection: ' + cause,
      { cause: err }
    );
  }
}
