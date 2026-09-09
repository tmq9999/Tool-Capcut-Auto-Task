export const migration008 = `
CREATE TABLE diagnostic_approvals (
  authority_ref TEXT PRIMARY KEY,
  budget_owner_ref TEXT NOT NULL,
  provider TEXT NOT NULL,
  approved_units INTEGER NOT NULL CHECK (
    typeof(approved_units) = 'integer' AND approved_units >= 0 AND approved_units <= 9007199254740991
  ),
  consumed_units INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(consumed_units) = 'integer' AND consumed_units >= 0 AND consumed_units <= approved_units
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_diagnostic_approvals_budget_owner
  ON diagnostic_approvals(budget_owner_ref);

CREATE TABLE account_mutation_bindings (
  owner_ref TEXT PRIMARY KEY,
  mailbox_ref TEXT UNIQUE,
  account_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE account_mutation_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  authority_ref TEXT NOT NULL,
  budget_owner_ref TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  account_id TEXT,
  run_id TEXT NOT NULL,
  session_alias TEXT,
  step_attempt_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  task_key TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('purchase', 'upload', 'export', 'generate', 'ui')),
  operation_key TEXT NOT NULL,
  billable_units INTEGER NOT NULL CHECK (billable_units IN (0, 1)),
  intent_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'outcome-unknown' CHECK (
    state IN ('outcome-unknown', 'effect-confirmed', 'no-effect-confirmed')
  ),
  evidence_ref TEXT,
  settled_at TEXT,
  UNIQUE(authority_ref, operation_key),
  FOREIGN KEY (authority_ref) REFERENCES diagnostic_approvals(authority_ref)
);

CREATE UNIQUE INDEX idx_account_mutation_intents_owner_attempt
  ON account_mutation_intents(owner_ref, step_attempt_id);

CREATE INDEX idx_account_mutation_intents_unknown_budget
  ON account_mutation_intents(state, operation, budget_owner_ref);

CREATE INDEX idx_account_mutation_intents_unknown_identity
  ON account_mutation_intents(state, operation, owner_ref, account_id);
`.trim();
