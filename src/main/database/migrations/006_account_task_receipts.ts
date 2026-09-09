export const migration006 = `
CREATE TABLE IF NOT EXISTS account_task_receipts (
  account_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_alias TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  required_after TEXT NOT NULL,
  server_total INTEGER NOT NULL,
  server_done INTEGER NOT NULL,
  is_fresh INTEGER NOT NULL,
  is_final INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_task_receipt_items (
  account_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  status INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (account_id, task_key),
  FOREIGN KEY (account_id) REFERENCES account_task_receipts(account_id) ON DELETE CASCADE
);
`.trim();
