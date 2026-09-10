export const migration009 = `
CREATE TABLE account_unsettled_proofs_next (
  account_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  op_id TEXT NOT NULL,
  proved_at TEXT NOT NULL,
  PRIMARY KEY (account_id, run_id, task_key)
);
INSERT INTO account_unsettled_proofs_next
  SELECT account_id, run_id, task_key, op_id, proved_at FROM account_unsettled_proofs;
DROP TABLE account_unsettled_proofs;
ALTER TABLE account_unsettled_proofs_next RENAME TO account_unsettled_proofs;
`.trim();
