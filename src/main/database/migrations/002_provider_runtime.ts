export const migration002 = `
CREATE TABLE IF NOT EXISTS purchased_emails (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  password_encrypted BLOB,
  refresh_token_encrypted BLOB,
  client_id TEXT,
  order_id TEXT,
  service TEXT,
  raw_payload_encrypted BLOB,
  account_id TEXT,
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchased_emails_provider_email
  ON purchased_emails(provider, email);
CREATE INDEX IF NOT EXISTS idx_purchased_emails_consumed_at
  ON purchased_emails(consumed_at);
CREATE INDEX IF NOT EXISTS idx_purchased_emails_purchased_at
  ON purchased_emails(purchased_at);
CREATE INDEX IF NOT EXISTS idx_purchased_emails_account_id
  ON purchased_emails(account_id);

CREATE TABLE IF NOT EXISTS proxy_leases (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  ip TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL,
  account_id TEXT,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_leases_ip ON proxy_leases(ip);
CREATE INDEX IF NOT EXISTS idx_proxy_leases_key_hash ON proxy_leases(key_hash);
CREATE INDEX IF NOT EXISTS idx_proxy_leases_released_at ON proxy_leases(released_at);
`;
