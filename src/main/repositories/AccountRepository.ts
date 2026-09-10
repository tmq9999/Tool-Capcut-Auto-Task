import type Database from 'better-sqlite3';
import { AccountTaskRepository } from './AccountTaskRepository';
import type { AccountStatus, AccountListItemDTO, AccountFilterDTO } from '../../shared/schemas/account.schema';
import { ACCOUNT_PAGE_SIZE_MAX } from '../../shared/schemas/account.schema';

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

/**
 * Đổi mốc ISO của renderer sang dạng ngày mà cột `created_at` đang lưu
 * (`YYYY-MM-DD HH:MM:SS`, UTC). Giá trị không parse được thì bỏ bộ lọc thay vì
 * ném — lọc sai còn tệ hơn không lọc, nhưng làm vỡ cả trang thì tệ nhất.
 */
function toSqliteDateTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
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

  /** Một dòng SQL thành một bản ghi domain. Dùng chung cho đọc một và đọc nhiều. */
  private toRecord(row: AccountDbRow): AccountDbRecord {
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

  getAccountById(id: string): AccountDbRecord | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountDbRow | undefined;
    if (!row) return null;

    return this.toRecord(row);
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

  /**
   * Dựng mệnh đề WHERE dùng chung cho đếm, phân trang và xuất file. Một nguồn
   * duy nhất vì `accounts.list` và `accounts.export` phải lọc GIỐNG NHAU — lệch
   * một dấu là bản xuất khác hẳn cái người dùng đang nhìn trên lưới.
   */
  private buildFilterClause(filter: {
    query?: string;
    status?: string;
    emailProvider?: string;
    browserProvider?: string;
    createdFrom?: string;
  }): { whereClause: string; values: SqliteBindValue[] } {
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
    if (filter.browserProvider && filter.browserProvider !== 'all') {
      conditions.push('browser_provider = ?');
      values.push(filter.browserProvider);
    }
    /**
     * `created_at` là TEXT `YYYY-MM-DD HH:MM:SS` theo UTC (`datetime('now')` ở
     * migration 001), nên mốc ISO phải đổi về đúng dạng đó — so `'2026-09-01T…Z'`
     * với `'2026-09-04 10:00:00'` là so chuỗi, chữ `T` lớn hơn dấu cách nên lọc
     * trượt hết. Có sẵn `idx_accounts_created_at` nên phép so này dùng index.
     */
    const createdFrom = toSqliteDateTime(filter.createdFrom);
    if (createdFrom) {
      conditions.push('created_at >= ?');
      values.push(createdFrom);
    }

    return {
      whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values
    };
  }

  /**
   * Đọc bản ghi ĐẦY ĐỦ (còn nguyên buffer đã mã hoá) để xuất file. KHÔNG phân
   * trang: xuất "tất cả" nghĩa là tất cả, không phải 500 dòng đầu như
   * `listAccounts`. Giải mã là việc của service ở main process (AGENTS §13).
   */
  queryAccountsForExport(scope: {
    ids?: string[];
    query?: string;
    status?: string;
    emailProvider?: string;
    browserProvider?: string;
    createdFrom?: string;
  }): AccountDbRecord[] {

    let whereClause: string;
    let values: SqliteBindValue[];

    if (scope.ids) {
      if (scope.ids.length === 0) return [];
      whereClause = `WHERE id IN (${scope.ids.map(() => '?').join(',')})`;
      values = [...scope.ids];
    } else {
      const built = this.buildFilterClause(scope);
      whereClause = built.whereClause;
      values = built.values;
    }

    const rows = this.db.prepare(`
      SELECT * FROM accounts ${whereClause}
      ORDER BY created_at DESC, id ASC
    `).all(...values) as AccountDbRow[];

    return rows.map((row) => this.toRecord(row));
  }

  listAccounts(filter: AccountFilterDTO): { items: AccountListItemDTO[]; total: number } {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(Math.max(1, filter.pageSize ?? 50), ACCOUNT_PAGE_SIZE_MAX);
    const offset = (page - 1) * pageSize;

    const { whereClause, values } = this.buildFilterClause(filter);
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
    const tasks = new AccountTaskRepository(this.db);
    const remove = this.db.prepare('DELETE FROM accounts WHERE id = ?');
    return this.db.transaction(() => {
      let deleted = 0;
      for (const id of new Set(ids)) {
        tasks.deleteByAccount(id);
        deleted += remove.run(id).changes;
      }
      return deleted;
    })();
  }
}
