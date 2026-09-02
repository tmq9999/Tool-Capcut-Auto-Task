export const migration001 = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_credentials (
  service_name TEXT PRIMARY KEY,
  encrypted_credentials BLOB NOT NULL,
  metadata TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_provider TEXT NOT NULL,
  email_password_encrypted BLOB,
  password_capcut_encrypted BLOB,
  email_data_encrypted BLOB,
  credit INTEGER NOT NULL DEFAULT 0,
  subscription TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  automation_step TEXT,
  proxy TEXT,
  browser_provider TEXT,
  browser_profile_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_email_provider ON accounts(email_provider);
CREATE INDEX IF NOT EXISTS idx_accounts_browser_provider ON accounts(browser_provider);

CREATE TABLE IF NOT EXISTS runtime_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  email TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON runtime_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_email ON runtime_logs(email);
CREATE INDEX IF NOT EXISTS idx_logs_status ON runtime_logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_account_id ON runtime_logs(account_id);
`;
