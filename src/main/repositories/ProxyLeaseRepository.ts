import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

/**
 * Another profile is currently running on this IP. Released IPs are reusable —
 * only concurrent sharing is forbidden.
 */
export class ProxyIpInUseError extends Error {
  public readonly code = 'ERR_PROXY_IP_IN_USE';

  constructor(ip: string) {
    super('Proxy IP ' + ip + ' is already held by an active lease.');
    this.name = 'ProxyIpInUseError';
  }
}

export type ProxyProtocol = 'http' | 'socks5';

export interface RecordProxyLeaseInput {
  id: string;
  /** Raw proxy key. Only its SHA-256 digest is persisted. */
  keyValue: string;
  ip: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  accountId?: string | null;
}

export interface ProxyLeaseRecord {
  id: string;
  keyHash: string;
  ip: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  accountId: string | null;
  acquiredAt: string;
  releasedAt: string | null;
}

interface ProxyLeaseRow {
  id: string;
  key_hash: string;
  ip: string;
  host: string;
  port: number;
  protocol: string;
  account_id: string | null;
  acquired_at: string;
  released_at: string | null;
}

export function hashProxyKey(keyValue: string): string {
  return crypto.createHash('sha256').update(keyValue).digest('hex');
}

function toRecord(row: ProxyLeaseRow): ProxyLeaseRecord {
  return {
    id: row.id,
    keyHash: row.key_hash,
    ip: row.ip,
    host: row.host,
    port: row.port,
    protocol: row.protocol as ProxyProtocol,
    accountId: row.account_id,
    acquiredAt: row.acquired_at,
    releasedAt: row.released_at
  };
}

export class ProxyLeaseRepository {
  constructor(private readonly db: Database.Database) {}

  recordLease(input: RecordProxyLeaseInput): void {
    if (this.isIpActive(input.ip)) {
      throw new ProxyIpInUseError(input.ip);
    }

    this.db.prepare(
        'INSERT INTO proxy_leases (' +
        ' id, key_hash, ip, host, port, protocol, account_id, acquired_at' +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(
      input.id,
      hashProxyKey(input.keyValue),
      input.ip,
      input.host,
      input.port,
      input.protocol,
      input.accountId ?? null
    );
  }

  /** True while a profile is still running on this IP. */
  isIpActive(ip: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS hit FROM proxy_leases WHERE ip = ? AND released_at IS NULL LIMIT 1'
    ).get(ip) as { hit: number } | undefined;
    return row !== undefined;
  }

  activeIps(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT ip FROM proxy_leases WHERE released_at IS NULL ORDER BY ip ASC'
    ).all() as Array<{ ip: string }>;
    return rows.map((row) => row.ip);
  }

  listActive(): ProxyLeaseRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM proxy_leases WHERE released_at IS NULL ORDER BY acquired_at ASC'
    ).all() as ProxyLeaseRow[];
    return rows.map(toRecord);
  }

  countActiveForKey(keyValue: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM proxy_leases WHERE key_hash = ? AND released_at IS NULL'
    ).get(hashProxyKey(keyValue)) as { count: number };
    return row.count;
  }

  release(id: string): boolean {
    const result = this.db.prepare(
      "UPDATE proxy_leases SET released_at = datetime('now')" +
      ' WHERE id = ? AND released_at IS NULL'
    ).run(id);
    return result.changes > 0;
  }

  releaseAll(): number {
    const result = this.db.prepare(
      "UPDATE proxy_leases SET released_at = datetime('now') WHERE released_at IS NULL"
    ).run();
    return result.changes;
  }
}
