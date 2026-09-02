import type Database from 'better-sqlite3';
import type { CanonicalRuntimeLog, CanonicalLogStatus, LogFilterDTO } from '../../shared/schemas/log.schema';
import type { SqliteBindValue } from './AccountRepository';

interface LogDbRow {
  id: string;
  account_id: string | null;
  email: string;
  step: string;
  status: string;
  message: string;
  created_at: string;
}

interface CountDbRow {
  count: number;
}

export class LogRepository {
  constructor(private readonly db: Database.Database) {}

  insertBatch(logs: CanonicalRuntimeLog[]): void {
    if (logs.length === 0) return;

    const insertStmt = this.db.prepare(`
      INSERT INTO runtime_logs (id, account_id, email, step, status, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: CanonicalRuntimeLog[]) => {
      for (const log of items) {
        insertStmt.run(
          log.id,
          log.accountId ?? null,
          log.email,
          log.step,
          log.status,
          log.message,
          log.createdAt
        );
      }
    });

    transaction(logs);
  }

  queryLogs(params: LogFilterDTO): { items: CanonicalRuntimeLog[]; total: number } {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(Math.max(1, params.pageSize ?? 50), 500);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: SqliteBindValue[] = [];

    if (params.level && params.level !== 'ALL') {
      conditions.push('status = ?');
      values.push(params.level);
    }
    if (params.email && params.email.trim().length > 0) {
      conditions.push('email LIKE ?');
      values.push(`%${params.email.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM runtime_logs ${whereClause}`).get(...values) as CountDbRow;

    const rows = this.db.prepare(`
      SELECT * FROM runtime_logs ${whereClause}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values, pageSize, offset) as LogDbRow[];

    const items: CanonicalRuntimeLog[] = rows.map((r) => ({
      id: r.id,
      accountId: r.account_id ?? undefined,
      email: r.email,
      step: r.step,
      status: r.status as CanonicalLogStatus,
      message: r.message,
      createdAt: r.created_at
    }));

    return { items, total: totalRow.count };
  }

  cleanupOldLogs(retentionDays: number): number {
    if (typeof retentionDays !== 'number' || retentionDays < 0 || !Number.isFinite(retentionDays)) {
      throw new Error(`Retention days must be non-negative. Received: ${retentionDays}`);
    }

    const result = this.db.prepare(`
      DELETE FROM runtime_logs
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(retentionDays);

    return result.changes;
  }

  clearAllLogs(): void {
    this.db.prepare('DELETE FROM runtime_logs').run();
  }
}
