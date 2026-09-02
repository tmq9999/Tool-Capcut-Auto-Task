import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
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
    throw new DatabaseConfigurationError('Failed to initialize and configure SQLite database connection.');
  }
}
