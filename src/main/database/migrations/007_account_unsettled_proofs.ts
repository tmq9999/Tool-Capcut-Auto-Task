export const migration007 = `
CREATE TABLE IF NOT EXISTS account_unsettled_proofs (
  account_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  op_id TEXT NOT NULL,
  proved_at TEXT NOT NULL,
  PRIMARY KEY (account_id, run_id, task_key),
  FOREIGN KEY (account_id) REFERENCES account_task_receipts(account_id) ON DELETE CASCADE
);
`.trim();
