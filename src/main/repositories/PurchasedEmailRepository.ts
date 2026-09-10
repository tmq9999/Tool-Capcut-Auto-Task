import type Database from 'better-sqlite3';
import type { EmailSourceProvider, PurchasedEmailDTO } from '../../shared/schemas/provider.schema';

export interface InsertPurchasedEmailInput {
  id: string;
  provider: EmailSourceProvider;
  email: string;
  passwordEncrypted?: Buffer | null;
  refreshTokenEncrypted?: Buffer | null;
  clientId?: string | null;
  orderId?: string | null;
  service?: string | null;
  rawPayloadEncrypted?: Buffer | null;
}

export interface PurchasedEmailSecrets {
  id: string;
  email: string;
  provider: EmailSourceProvider;
  passwordEncrypted: Buffer | null;
  refreshTokenEncrypted: Buffer | null;
  clientId: string | null;
  orderId: string | null;
  service: string | null;
}

interface PurchasedEmailRow {
  id: string;
  provider: string;
  email: string;
  password_encrypted: Buffer | null;
  refresh_token_encrypted: Buffer | null;
  client_id: string | null;
  order_id: string | null;
  service: string | null;
  account_id: string | null;
  reserved_by: string | null;
  reserved_at: string | null;
  purchased_at: string;
  consumed_at: string | null;
}

function toIso(sqliteTimestamp: string): string {
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  if (sqliteTimestamp.includes('T')) return sqliteTimestamp;
  return sqliteTimestamp.replace(' ', 'T') + '.000Z';
}

function toDto(row: PurchasedEmailRow): PurchasedEmailDTO {
  return {
    id: row.id,
    provider: row.provider as EmailSourceProvider,
    email: row.email,
    hasPassword: row.password_encrypted !== null,
    hasOauth: row.refresh_token_encrypted !== null && row.client_id !== null,
    orderId: row.order_id,
    service: row.service,
    purchasedAt: toIso(row.purchased_at),
    consumedAt: row.consumed_at ? toIso(row.consumed_at) : null
  };
}

export class PurchasedEmailRepository {
  constructor(private readonly db: Database.Database) {}

  getDtoById(id: string): PurchasedEmailDTO | null {
    const row = this.db.prepare('SELECT * FROM purchased_emails WHERE id = ?')
      .get(id) as PurchasedEmailRow | undefined;
    return row ? toDto(row) : null;
  }

  insert(input: InsertPurchasedEmailInput): void {
    this.db.prepare(
      'INSERT INTO purchased_emails (' +
      ' id, provider, email, password_encrypted, refresh_token_encrypted,' +
      ' client_id, order_id, service, raw_payload_encrypted, purchased_at' +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(
      input.id,
      input.provider,
      input.email,
      input.passwordEncrypted ?? null,
      input.refreshTokenEncrypted ?? null,
      input.clientId ?? null,
      input.orderId ?? null,
      input.service ?? null,
      input.rawPayloadEncrypted ?? null
    );
  }

  insertReserved(input: InsertPurchasedEmailInput, reservationId: string): PurchasedEmailDTO {
    this.db.prepare(
      'INSERT INTO purchased_emails (' +
      ' id, provider, email, password_encrypted, refresh_token_encrypted,' +
      ' client_id, order_id, service, raw_payload_encrypted, reserved_by, reserved_at, purchased_at' +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run(
      input.id,
      input.provider,
      input.email,
      input.passwordEncrypted ?? null,
      input.refreshTokenEncrypted ?? null,
      input.clientId ?? null,
      input.orderId ?? null,
      input.service ?? null,
      input.rawPayloadEncrypted ?? null,
      reservationId
    );
    const row = this.getDtoById(input.id);
    if (!row) throw new Error('Purchased email insert did not return its row.');
    return row;
  }

  reserveOldestAvailable(
    provider: EmailSourceProvider,
    reservationId: string,
    requiredService?: string
  ): PurchasedEmailDTO | null {
    return this.db.transaction(() => {
      const candidate = requiredService
        ? this.db.prepare(
            'SELECT id FROM purchased_emails' +
            ' WHERE provider = ? AND service = ?' +
            ' AND consumed_at IS NULL AND reserved_by IS NULL' +
            ' ORDER BY purchased_at ASC, id ASC LIMIT 1'
          ).get(provider, requiredService) as { id: string } | undefined
        : this.db.prepare(
            'SELECT id FROM purchased_emails' +
            ' WHERE provider = ?' +
            ' AND consumed_at IS NULL AND reserved_by IS NULL' +
            ' ORDER BY purchased_at ASC, id ASC LIMIT 1'
          ).get(provider) as { id: string } | undefined;
      if (!candidate) return null;

      const changed = this.db.prepare(
        "UPDATE purchased_emails SET reserved_by = ?, reserved_at = datetime('now')" +
        ' WHERE id = ? AND consumed_at IS NULL AND reserved_by IS NULL'
      ).run(reservationId, candidate.id);
      if (changed.changes !== 1) return null;
      return this.getDtoById(candidate.id);
    })();
  }

  consumeReserved(id: string, reservationId: string, accountId: string | null): boolean {
    const changed = this.db.prepare(
      "UPDATE purchased_emails SET consumed_at = datetime('now'), account_id = ?," +
      ' reserved_by = NULL, reserved_at = NULL' +
      ' WHERE id = ? AND consumed_at IS NULL AND reserved_by = ?'
    ).run(accountId, id, reservationId);
    return changed.changes === 1;
  }

  releaseReservation(id: string, reservationId: string): boolean {
    const changed = this.db.prepare(
      'UPDATE purchased_emails SET reserved_by = NULL, reserved_at = NULL' +
      ' WHERE id = ? AND consumed_at IS NULL AND reserved_by = ?'
    ).run(id, reservationId);
    return changed.changes === 1;
  }

  updateReservedOauth(
    id: string,
    reservationId: string,
    encryptedRefresh: Buffer,
    clientId: string
  ): boolean {
    const changed = this.db.prepare(
      'UPDATE purchased_emails SET refresh_token_encrypted = ?, client_id = ?' +
      ' WHERE id = ? AND reserved_by = ? AND consumed_at IS NULL'
    ).run(encryptedRefresh, clientId, id, reservationId);
    return changed.changes === 1;
  }

  countAvailable(
    provider: EmailSourceProvider,
    requiredService?: string
  ): number {
    const row = requiredService
      ? this.db.prepare(
          'SELECT COUNT(*) AS count FROM purchased_emails' +
          ' WHERE provider = ? AND service = ?' +
          ' AND consumed_at IS NULL AND reserved_by IS NULL'
        ).get(provider, requiredService) as { count: number }
      : this.db.prepare(
          'SELECT COUNT(*) AS count FROM purchased_emails' +
          ' WHERE provider = ?' +
          ' AND consumed_at IS NULL AND reserved_by IS NULL'
        ).get(provider) as { count: number };
    return row.count;
  }

  clearStaleReservations(): number {
    const changed = this.db.prepare(
      'UPDATE purchased_emails SET reserved_by = NULL, reserved_at = NULL' +
      ' WHERE consumed_at IS NULL AND reserved_by IS NOT NULL'
    ).run();
    return changed.changes;
  }

  listUnconsumed(provider: EmailSourceProvider, limit: number): PurchasedEmailDTO[] {
    const rows = this.db.prepare(
      'SELECT * FROM purchased_emails WHERE provider = ? AND consumed_at IS NULL AND reserved_by IS NULL' +
      ' ORDER BY purchased_at ASC, id ASC LIMIT ?'
    ).all(provider, Math.max(1, limit)) as PurchasedEmailRow[];
    return rows.map(toDto);
  }

  listRecent(limit: number): PurchasedEmailDTO[] {
    const rows = this.db.prepare(
      'SELECT * FROM purchased_emails ORDER BY purchased_at DESC, id ASC LIMIT ?'
    ).all(Math.max(1, limit)) as PurchasedEmailRow[];
    return rows.map(toDto);
  }

  getSecretsById(id: string): PurchasedEmailSecrets | null {
    const row = this.db.prepare('SELECT * FROM purchased_emails WHERE id = ?')
      .get(id) as PurchasedEmailRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      provider: row.provider as EmailSourceProvider,
      passwordEncrypted: row.password_encrypted,
      refreshTokenEncrypted: row.refresh_token_encrypted,
      clientId: row.client_id,
      orderId: row.order_id,
      service: row.service
    };
  }

  getSecretsByEmail(provider: EmailSourceProvider, email: string): PurchasedEmailSecrets | null {
    const row = this.db.prepare(
      'SELECT id FROM purchased_emails WHERE provider = ? AND email = ?'
    ).get(provider, email) as { id: string } | undefined;
    if (!row) return null;
    return this.getSecretsById(row.id);
  }

  markConsumed(id: string, accountId: string | null): boolean {
    const result = this.db.prepare(
      "UPDATE purchased_emails SET consumed_at = datetime('now'), account_id = ?" +
      ' WHERE id = ? AND consumed_at IS NULL'
    ).run(accountId, id);
    return result.changes > 0;
  }

  /**
   * Đưa một hộp thư đã bị đánh dấu "đã tiêu" trở lại hàng chờ.
   *
   * `AutomationRunService` gọi `markConsumed` ngay lúc tạo account, tức là TRƯỚC
   * khi browser mở. Lượt 04/09/2026: `xcli profile-quick` lỗi vì launcher
   * Multilogin đã tắt, nên hộp thư vừa thuê (đã trả tiền, `order_id` còn nguyên)
   * bị đánh dấu đã tiêu mà chưa dùng gì. Hàm này để luồng thất bại nhả nó ra.
   */
  release(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE purchased_emails SET consumed_at = NULL, account_id = NULL WHERE id = ?'
    ).run(id);
    return result.changes > 0;
  }
}
