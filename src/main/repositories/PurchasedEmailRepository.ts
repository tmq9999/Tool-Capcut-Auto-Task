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

  listUnconsumed(provider: EmailSourceProvider, limit: number): PurchasedEmailDTO[] {
    const rows = this.db.prepare(
      'SELECT * FROM purchased_emails WHERE provider = ? AND consumed_at IS NULL' +
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
}
