import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { MIGRATIONS, type MigrationItem } from './migrations';

export { type MigrationItem };

export class MigrationChecksumMismatchError extends Error {
  constructor(version: number, expected: string, actual: string) {
    super(`Checksum mismatch for migration version ${version}. Stored: ${expected}, Current: ${actual}`);
    this.name = 'MigrationChecksumMismatchError';
  }
}

export interface AppliedMigrationRecord {
  version: number;
  checksum: string;
  applied_at: string;
}

export function computeMigrationChecksum(sql: string): string {
  return crypto.createHash('sha256').update(sql.trim()).digest('hex');
}

export function validateMigrationRegistry(migrations: MigrationItem[]): void {
  const versions = new Set<number>();
  const names = new Set<string>();
  let expectedVersion = 1;

  for (const m of migrations) {
    if (typeof m.version !== 'number' || m.version <= 0 || !Number.isInteger(m.version)) {
      throw new Error(`Invalid migration version: ${m.version}. Version must be a positive integer.`);
    }
    if (versions.has(m.version)) {
      throw new Error(`Duplicate migration version detected: ${m.version}`);
    }
    if (m.version !== expectedVersion) {
      throw new Error(`Migration version gap detected: expected ${expectedVersion}, got ${m.version}`);
    }
    if (!m.name || typeof m.name !== 'string' || m.name.trim().length === 0) {
      throw new Error(`Migration version ${m.version} has an empty or invalid name.`);
    }
    if (names.has(m.name)) {
      throw new Error(`Duplicate migration name detected: ${m.name}`);
    }
    if (!m.sql || typeof m.sql !== 'string' || m.sql.trim().length === 0) {
      throw new Error(`Empty SQL in migration version ${m.version}`);
    }
    versions.add(m.version);
    names.add(m.name);
    expectedVersion++;
  }
}

function bootstrapMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getAppliedMigrations(db: Database.Database): AppliedMigrationRecord[] {
  bootstrapMigrationsTable(db);
  const rows = db.prepare('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version ASC').all() as AppliedMigrationRecord[];
  return rows;
}

export function runMigrations(
  db: Database.Database,
  customMigrations?: MigrationItem[]
): { appliedCount: number } {
  bootstrapMigrationsTable(db);
  const migrations = customMigrations ?? MIGRATIONS;
  validateMigrationRegistry(migrations);

  const appliedRecords = getAppliedMigrations(db);
  const appliedMap = new Map<number, string>(appliedRecords.map((r) => [r.version, r.checksum]));
  const migrationMap = new Map<number, MigrationItem>(migrations.map((m) => [m.version, m]));

  // Verify all already-applied migrations match the registry checksums
  for (const record of appliedRecords) {
    const migration = migrationMap.get(record.version);
    if (!migration) {
      throw new MigrationChecksumMismatchError(record.version, record.checksum, 'NOT_FOUND_IN_REGISTRY');
    }
    const currentChecksum = computeMigrationChecksum(migration.sql);
    if (record.checksum !== currentChecksum) {
      throw new MigrationChecksumMismatchError(record.version, record.checksum, currentChecksum);
    }
  }

  let appliedCount = 0;

  for (const migration of migrations) {
    if (appliedMap.has(migration.version)) {
      continue;
    }

    const currentChecksum = computeMigrationChecksum(migration.sql);

    // Apply migration SQL and schema_migrations record in the EXACT same synchronous transaction
    const executeMigrationTransaction = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO schema_migrations (version, checksum, applied_at)
        VALUES (?, ?, datetime('now'))
      `).run(migration.version, currentChecksum);
    });

    executeMigrationTransaction();
    appliedCount++;
  }

  return { appliedCount };
}
