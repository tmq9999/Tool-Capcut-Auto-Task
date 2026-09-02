import type Database from 'better-sqlite3';
import type { AccountStatus, AccountListItemDTO, AccountFilterDTO } from '../../shared/schemas/account.schema';

export type SqliteBindValue = string | number | bigint | Buffer | null;

export interface CreateAccountRecordInput {
  id: string;
  email: string;
  emailProvider: string;
  emailPasswordEncrypted?: Buffer | null;
  passwordCapcutEncrypted?: Buffer | null;
  emailDataEncrypted?: Buffer | null;
  credit?: number;
  subscription?: string | null;
  status?: AccountStatus;
  automationStep?: string | null;
  proxy?: string | null;
  browserProvider?: string | null;
  browserProfileId?: string | null;
  notes?: string | null;
}

export type SecretBufferOp =
  | { action: 'keep' }
  | { action: 'replace'; encryptedValue: Buffer }
  | { action: 'clear' };

export interface UpdateAccountRecordInput {
  email?: string;
  emailProvider?: string;
  emailPasswordOp?: SecretBufferOp;
  passwordCapcutOp?: SecretBufferOp;
  emailDataOp?: SecretBufferOp;
  credit?: number;
  subscription?: string | null;
  status?: AccountStatus;
  automationStep?: string | null;
  proxy?: string | null;
  browserProvider?: string | null;
  browserProfileId?: string | null;
  notes?: string | null;
}

export interface AccountDbRecord {
  id: string;
  email: string;
  emailProvider: string;
  emailPasswordEncrypted: Buffer | null;
  passwordCapcutEncrypted: Buffer | null;
  emailDataEncrypted: Buffer | null;
  credit: number;
  subscription: string | null;
  status: AccountStatus;
  automationStep: string | null;
  proxy: string | null;
  browserProvider: string | null;
  browserProfileId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AccountDbRow {
  id: string;
  email: string;
  email_provider: string;
  email_password_encrypted: Buffer | null;
  password_capcut_encrypted: Buffer | null;
  email_data_encrypted: Buffer | null;
  credit: number;
  subscription: string | null;
  status: string;
  automation_step: string | null;
  proxy: string | null;
  browser_provider: string | null;
  browser_profile_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CountDbRow {
  count: number;
}

export class AccountRepository {
  constructor(private readonly db: Database.Database) {}

  createAccount(input: CreateAccountRecordInput): void {
    this.db.prepare(`
      INSERT INTO accounts (
        id, email, email_provider, email_password_encrypted, password_capcut_encrypted,
        email_data_encrypted, credit, subscription, status, automation_step, proxy,
        browser_provider, browser_profile_id, notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, datetime('now'), datetime('now')
      )
    `).run(
      input.id,
      input.email,
      input.emailProvider,
      input.emailPasswordEncrypted ?? null,
      input.passwordCapcutEncrypted ?? null,
      input.emailDataEncrypted ?? null,
      input.credit ?? 0,
      input.subscription ?? null,
      input.status ?? 'active',
      input.automationStep ?? null,
      input.proxy ?? null,
      input.browserProvider ?? null,
      input.browserProfileId ?? null,
      input.notes ?? null
    );
  }

  getAccountById(id: string): AccountDbRecord | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountDbRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      emailProvider: row.email_provider,
      emailPasswordEncrypted: row.email_password_encrypted,
      passwordCapcutEncrypted: row.password_capcut_encrypted,
      emailDataEncrypted: row.email_data_encrypted,
      credit: row.credit,
      subscription: row.subscription,
      status: row.status as AccountStatus,
      automationStep: row.automation_step,
      proxy: row.proxy,
      browserProvider: row.browser_provider,
      browserProfileId: row.browser_profile_id,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  updateAccount(id: string, input: UpdateAccountRecordInput): boolean {
    const existing = this.getAccountById(id);
    if (!existing) return false;

    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const values: SqliteBindValue[] = [];

    if (input.email !== undefined) {
      setClauses.push('email = ?');
      values.push(input.email);
    }
    if (input.emailProvider !== undefined) {
      setClauses.push('email_provider = ?');
      values.push(input.emailProvider);
    }
    if (input.credit !== undefined) {
      setClauses.push('credit = ?');
      values.push(input.credit);
    }
    if (input.subscription !== undefined) {
      setClauses.push('subscription = ?');
      values.push(input.subscription);
    }
    if (input.status !== undefined) {
      setClauses.push('status = ?');
      values.push(input.status);
    }
    if (input.automationStep !== undefined) {
      setClauses.push('automation_step = ?');
      values.push(input.automationStep);
    }
    if (input.proxy !== undefined) {
      setClauses.push('proxy = ?');
      values.push(input.proxy);
    }
    if (input.browserProvider !== undefined) {
      setClauses.push('browser_provider = ?');
      values.push(input.browserProvider);
    }
    if (input.browserProfileId !== undefined) {
      setClauses.push('browser_profile_id = ?');
      values.push(input.browserProfileId);
    }
    if (input.notes !== undefined) {
      setClauses.push('notes = ?');
      values.push(input.notes);
    }

    // Secret operations: keep (no-op), replace (new Buffer), clear (null)
    if (input.passwordCapcutOp) {
      if (input.passwordCapcutOp.action === 'replace') {
        setClauses.push('password_capcut_encrypted = ?');
        values.push(input.passwordCapcutOp.encryptedValue);
      } else if (input.passwordCapcutOp.action === 'clear') {
        setClauses.push('password_capcut_encrypted = NULL');
      }
    }

    if (input.emailPasswordOp) {
      if (input.emailPasswordOp.action === 'replace') {
        setClauses.push('email_password_encrypted = ?');
        values.push(input.emailPasswordOp.encryptedValue);
      } else if (input.emailPasswordOp.action === 'clear') {
        setClauses.push('email_password_encrypted = NULL');
      }
    }

    if (input.emailDataOp) {
      if (input.emailDataOp.action === 'replace') {
        setClauses.push('email_data_encrypted = ?');
        values.push(input.emailDataOp.encryptedValue);
      } else if (input.emailDataOp.action === 'clear') {
        setClauses.push('email_data_encrypted = NULL');
      }
    }

    values.push(id);
    const result = this.db.prepare(`
      UPDATE accounts
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).run(...values);

    return result.changes > 0;
  }

  listAccounts(filter: AccountFilterDTO): { items: AccountListItemDTO[]; total: number } {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(Math.max(1, filter.pageSize ?? 50), 500);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: SqliteBindValue[] = [];

    if (filter.query && filter.query.trim().length > 0) {
      conditions.push('(email LIKE ? OR notes LIKE ?)');
      values.push(`%${filter.query.trim()}%`, `%${filter.query.trim()}%`);
    }
    if (filter.status && filter.status !== 'all') {
      conditions.push('status = ?');
      values.push(filter.status);
    }
    if (filter.emailProvider && filter.emailProvider !== 'all') {
      conditions.push('email_provider = ?');
      values.push(filter.emailProvider);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM accounts ${whereClause}`).get(...values) as CountDbRow;

    const rows = this.db.prepare(`
      SELECT * FROM accounts ${whereClause}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values, pageSize, offset) as AccountDbRow[];

    const items: AccountListItemDTO[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      emailProvider: r.email_provider,
      hasEmailPassword: r.email_password_encrypted !== null,
      hasPasswordCapcut: r.password_capcut_encrypted !== null,
      hasEmailData: r.email_data_encrypted !== null,
      credit: r.credit,
      subscription: r.subscription,
      status: r.status as AccountStatus,
      automationStep: r.automation_step,
      proxy: r.proxy,
      browserProvider: r.browser_provider,
      browserProfileId: r.browser_profile_id,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));

    return { items, total: totalRow.count };
  }

  deleteAccounts(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  }
}
