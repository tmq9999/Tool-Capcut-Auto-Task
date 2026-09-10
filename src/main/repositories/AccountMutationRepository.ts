import type Database from 'better-sqlite3';

export type IntentState = 'outcome-unknown' | 'effect-confirmed' | 'no-effect-confirmed';
export type MutationOperation = 'purchase' | 'upload' | 'export' | 'generate' | 'ui';

export interface MutationIntent {
  authorityRef: string;
  budgetOwnerRef: string;
  ownerRef: string;
  accountId: string | null;
  runId: string;
  sessionAlias: string | null;
  stepAttemptId: string;
  stepId: string;
  taskKey: string | null;
  operation: MutationOperation;
  operationKey: string;
  intentAt: string;
  state: IntentState;
  evidenceRef: string | null;
}

export interface StoredMutationIntent extends MutationIntent {
  billableUnits: 0 | 1;
}

export interface ApprovalInput {
  authorityRef: string;
  budgetOwnerRef: string;
  provider: string;
  approvedUnits: number;
}

export interface ApprovalSnapshot extends ApprovalInput {
  consumedUnits: number;
}

export interface MutationIdentity {
  authorityRef: string;
  budgetOwnerRef: string;
  ownerRef: string;
  accountId?: string;
  mailboxRef?: string;
  operation: MutationOperation;
}

export interface AccountMutationPort {
  recordIntent(intent: MutationIntent, billableUnits: 0 | 1): void;
  bindAccount(ownerRef: string, accountId: string): void;
  assertNoUnknown(identity: MutationIdentity): void;
  settleIntent(
    ownerRef: string,
    stepAttemptId: string,
    state: Exclude<IntentState, 'outcome-unknown'>,
    evidenceRef: string
  ): void;
  getOwnerByMailbox?(mailboxRef: string): string | null;
  getBinding?(ownerRef: string): { ownerRef: string; mailboxRef: string | null; accountId: string | null } | null;
}


interface ApprovalRow {
  authority_ref: string;
  budget_owner_ref: string;
  provider: string;
  approved_units: number;
  consumed_units: number;
}

interface IntentRow {
  authority_ref: string;
  budget_owner_ref: string;
  owner_ref: string;
  account_id: string | null;
  run_id: string;
  session_alias: string | null;
  step_attempt_id: string;
  step_id: string;
  task_key: string | null;
  operation: MutationOperation;
  operation_key: string;
  billable_units: 0 | 1;
  intent_at: string;
  state: IntentState;
  evidence_ref: string | null;
  binding_mailbox_ref?: string | null;
  binding_account_id?: string | null;
}

interface BindingRow {
  owner_ref: string;
  mailbox_ref: string | null;
  account_id: string | null;
}

const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const OPERATIONS = new Set<MutationOperation>(['purchase', 'upload', 'export', 'generate', 'ui']);

export class ApprovalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalConflictError';
  }
}

export class ApprovalExhaustedError extends Error {
  constructor() {
    super('Diagnostic approval has no remaining units.');
    this.name = 'ApprovalExhaustedError';
  }
}

export class IntentAlreadyRecordedError extends Error {
  constructor(public readonly existing: StoredMutationIntent) {
    super('Mutation intent is already recorded; dispatch is not permitted again.');
    this.name = 'IntentAlreadyRecordedError';
  }
}

export class UnknownMutationError extends Error {
  constructor(public readonly blocking: readonly StoredMutationIntent[]) {
    super('An outcome-unknown mutation blocks this operation until explicit reconciliation.');
    this.name = 'UnknownMutationError';
  }
}

export class IdentityBindingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityBindingConflictError';
  }
}

function requireRef(value: string, label: string): void {
  if (!SAFE_REF.test(value)) throw new Error(`${label} must be a safe opaque reference.`);
}

function requireOptionalRef(value: string | null, label: string): void {
  if (value !== null) requireRef(value, label);
}

function toIntent(row: IntentRow): StoredMutationIntent {
  return {
    authorityRef: row.authority_ref,
    budgetOwnerRef: row.budget_owner_ref,
    ownerRef: row.owner_ref,
    accountId: row.account_id,
    runId: row.run_id,
    sessionAlias: row.session_alias,
    stepAttemptId: row.step_attempt_id,
    stepId: row.step_id,
    taskKey: row.task_key,
    operation: row.operation,
    operationKey: row.operation_key,
    billableUnits: row.billable_units,
    intentAt: row.intent_at,
    state: row.state,
    evidenceRef: row.evidence_ref
  };
}

function sameNewIntent(existing: StoredMutationIntent, incoming: MutationIntent, billableUnits: 0 | 1): boolean {
  return existing.authorityRef === incoming.authorityRef &&
    existing.budgetOwnerRef === incoming.budgetOwnerRef &&
    existing.ownerRef === incoming.ownerRef &&
    existing.accountId === incoming.accountId &&
    existing.runId === incoming.runId &&
    existing.sessionAlias === incoming.sessionAlias &&
    existing.stepAttemptId === incoming.stepAttemptId &&
    existing.stepId === incoming.stepId &&
    existing.taskKey === incoming.taskKey &&
    existing.operation === incoming.operation &&
    existing.operationKey === incoming.operationKey &&
    existing.billableUnits === billableUnits &&
    existing.intentAt === incoming.intentAt;
}

export class AccountMutationRepository implements AccountMutationPort {
  constructor(private readonly db: Database.Database) {}

  registerApproval(input: ApprovalInput): void {
    requireRef(input.authorityRef, 'authorityRef');
    requireRef(input.budgetOwnerRef, 'budgetOwnerRef');
    requireRef(input.provider, 'provider');
    if (!Number.isSafeInteger(input.approvedUnits) || input.approvedUnits < 0) {
      throw new Error(`approvedUnits must be an integer from 0 to ${SAFE_INTEGER_MAX}.`);
    }

    this.db.transaction(() => {
      const existing = this.readApproval(input.authorityRef);
      if (existing) {
        if (existing.budgetOwnerRef !== input.budgetOwnerRef ||
            existing.provider !== input.provider ||
            existing.approvedUnits !== input.approvedUnits) {
          throw new ApprovalConflictError('Approval authority is immutable and conflicts with the stored approval.');
        }
        return;
      }
      const budgetOwner = this.db.prepare(`SELECT provider FROM diagnostic_approvals
        WHERE budget_owner_ref = ? LIMIT 1`).get(input.budgetOwnerRef) as { provider: string } | undefined;
      if (budgetOwner && budgetOwner.provider !== input.provider) {
        throw new ApprovalConflictError('Budget owner is already registered to a different provider.');
      }
      this.db.prepare(`INSERT INTO diagnostic_approvals
        (authority_ref,budget_owner_ref,provider,approved_units,consumed_units)
        VALUES (?,?,?,?,0)`).run(
        input.authorityRef, input.budgetOwnerRef, input.provider, input.approvedUnits
      );
    })();
  }

  getApproval(authorityRef: string): ApprovalSnapshot | null {
    requireRef(authorityRef, 'authorityRef');
    return this.readApproval(authorityRef);
  }

  private readApproval(authorityRef: string): ApprovalSnapshot | null {
    const row = this.db.prepare(`SELECT authority_ref,budget_owner_ref,provider,approved_units,consumed_units
      FROM diagnostic_approvals WHERE authority_ref = ?`).get(authorityRef) as ApprovalRow | undefined;
    return row ? {
      authorityRef: row.authority_ref,
      budgetOwnerRef: row.budget_owner_ref,
      provider: row.provider,
      approvedUnits: row.approved_units,
      consumedUnits: row.consumed_units
    } : null;
  }

  recordIntent(intent: MutationIntent, billableUnits: 0 | 1): void {
    this.validateNewIntent(intent, billableUnits);
    this.db.transaction(() => {
      const existing = this.getIntent(intent.authorityRef, intent.operationKey);
      if (existing) {
        if (!sameNewIntent(existing, intent, billableUnits)) {
          throw new Error('Duplicate operation key has a conflicting intent.');
        }
        throw new IntentAlreadyRecordedError(existing);
      }

      const approval = this.readApproval(intent.authorityRef);
      if (!approval) throw new Error('A persisted diagnostic approval is required before recording an intent.');
      if (approval.budgetOwnerRef !== intent.budgetOwnerRef) {
        throw new ApprovalConflictError('Intent budget owner does not match its immutable approval.');
      }
      if (intent.accountId !== null) {
        const binding = this.readBinding(intent.ownerRef);
        if (binding?.accountId !== null && binding?.accountId !== undefined &&
            binding.accountId !== intent.accountId) {
          throw new IdentityBindingConflictError('Intent account contradicts the durable owner binding.');
        }
        const otherBinding = this.db.prepare(`SELECT owner_ref FROM account_mutation_bindings
          WHERE account_id = ? AND owner_ref <> ?`).get(intent.accountId, intent.ownerRef) as
          { owner_ref: string } | undefined;
        if (otherBinding) {
          throw new IdentityBindingConflictError('Intent account is already bound to another owner.');
        }
      }

      this.assertNoUnknown({
        authorityRef: intent.authorityRef,
        budgetOwnerRef: intent.budgetOwnerRef,
        ownerRef: intent.ownerRef,
        accountId: intent.accountId ?? undefined,
        operation: intent.operation
      });

      if (billableUnits === 1) {
        const changed = this.db.prepare(`UPDATE diagnostic_approvals
          SET consumed_units = consumed_units + 1
          WHERE authority_ref = ? AND consumed_units + 1 <= approved_units`).run(intent.authorityRef);
        if (changed.changes !== 1) throw new ApprovalExhaustedError();
      }

      this.db.prepare(`INSERT INTO account_mutation_intents (
        authority_ref,budget_owner_ref,owner_ref,account_id,run_id,session_alias,
        step_attempt_id,step_id,task_key,operation,operation_key,billable_units,
        intent_at,state,evidence_ref
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'outcome-unknown',NULL)`).run(
        intent.authorityRef, intent.budgetOwnerRef, intent.ownerRef, intent.accountId,
        intent.runId, intent.sessionAlias, intent.stepAttemptId, intent.stepId, intent.taskKey,
        intent.operation, intent.operationKey, billableUnits, intent.intentAt
      );
    })();
  }

  private validateNewIntent(intent: MutationIntent, billableUnits: 0 | 1): void {
    requireRef(intent.authorityRef, 'authorityRef');
    requireRef(intent.budgetOwnerRef, 'budgetOwnerRef');
    requireRef(intent.ownerRef, 'ownerRef');
    requireOptionalRef(intent.accountId, 'accountId');
    requireRef(intent.runId, 'runId');
    requireOptionalRef(intent.sessionAlias, 'sessionAlias');
    requireRef(intent.stepAttemptId, 'stepAttemptId');
    requireRef(intent.stepId, 'stepId');
    requireOptionalRef(intent.taskKey, 'taskKey');
    requireRef(intent.operationKey, 'operationKey');
    if (!OPERATIONS.has(intent.operation)) throw new Error('Unsupported mutation operation.');
    if (billableUnits !== 0 && billableUnits !== 1) throw new Error('billableUnits must be 0 or 1.');
    if (intent.operation === 'purchase' && billableUnits !== 1) {
      throw new Error('Every purchase intent must consume exactly one approval unit.');
    }
    if (intent.operation !== 'purchase' && billableUnits !== 0) {
      throw new Error('Only purchase intents may consume approval units.');
    }
    if (intent.operation !== 'purchase' && intent.accountId === null) {
      throw new Error('accountId is required for non-purchase mutation intents.');
    }
    if (intent.state !== 'outcome-unknown' || intent.evidenceRef !== null) {
      throw new Error('recordIntent accepts only a new UNKNOWN intent without evidence.');
    }
    if (!Number.isFinite(Date.parse(intent.intentAt))) throw new Error('intentAt must be an ISO timestamp.');
  }

  getIntent(authorityRef: string, operationKey: string): StoredMutationIntent | null {
    const row = this.db.prepare(`SELECT * FROM account_mutation_intents
      WHERE authority_ref = ? AND operation_key = ?`).get(authorityRef, operationKey) as IntentRow | undefined;
    return row ? toIntent(row) : null;
  }

  listBlocking(identity: MutationIdentity): StoredMutationIntent[] {
    requireRef(identity.authorityRef, 'authorityRef');
    requireRef(identity.budgetOwnerRef, 'budgetOwnerRef');
    requireOptionalRef(identity.ownerRef, 'ownerRef');
    if (identity.accountId !== undefined) requireRef(identity.accountId, 'accountId');
    if (identity.mailboxRef !== undefined) requireRef(identity.mailboxRef, 'mailboxRef');
    if (!OPERATIONS.has(identity.operation)) throw new Error('Unsupported mutation operation.');

    const rows = this.db.prepare(`SELECT i.*,
        b.mailbox_ref AS binding_mailbox_ref, b.account_id AS binding_account_id
      FROM account_mutation_intents i
      LEFT JOIN account_mutation_bindings b ON b.owner_ref = i.owner_ref
      WHERE i.state = 'outcome-unknown' AND i.operation = ?
      ORDER BY i.id`).all(identity.operation) as IntentRow[];

    return rows.filter((row) => {
      const accountId = row.account_id ?? row.binding_account_id ?? null;
      const mailboxRef = row.binding_mailbox_ref ?? null;
      const sameOwner = row.owner_ref === identity.ownerRef;
      const sameAccount = identity.accountId !== undefined && accountId === identity.accountId;
      const sameMailbox = identity.mailboxRef !== undefined && mailboxRef === identity.mailboxRef;
      if (sameOwner || sameAccount || sameMailbox) return true;
      return row.operation === 'purchase' &&
        row.budget_owner_ref === identity.budgetOwnerRef &&
        accountId === null && mailboxRef === null;
    }).map(toIntent);
  }

  assertNoUnknown(identity: MutationIdentity): void {
    const blocking = this.listBlocking(identity);
    if (blocking.length > 0) throw new UnknownMutationError(blocking);
  }

  bindMailbox(ownerRef: string, mailboxRef: string): void {
    this.bindIdentity(ownerRef, 'mailbox_ref', mailboxRef);
  }

  bindAccount(ownerRef: string, accountId: string): void {
    this.bindIdentity(ownerRef, 'account_id', accountId);
  }

  private bindIdentity(ownerRef: string, column: 'mailbox_ref' | 'account_id', value: string): void {
    requireRef(ownerRef, 'ownerRef');
    requireRef(value, column === 'mailbox_ref' ? 'mailboxRef' : 'accountId');
    this.db.transaction(() => {
      const existing = this.readBinding(ownerRef);
      const current = existing?.[column === 'mailbox_ref' ? 'mailboxRef' : 'accountId'] ?? null;
      if (current !== null && current !== value) {
        throw new IdentityBindingConflictError(`Owner already has a different ${column}.`);
      }
      const other = this.db.prepare(`SELECT owner_ref FROM account_mutation_bindings
        WHERE ${column} = ? AND owner_ref <> ?`).get(value, ownerRef) as { owner_ref: string } | undefined;
      if (other) throw new IdentityBindingConflictError(`${column} is already bound to another owner.`);

      if (column === 'account_id') {
        const conflictingIntent = this.db.prepare(`SELECT owner_ref FROM account_mutation_intents
          WHERE account_id = ? AND owner_ref IS NOT NULL AND owner_ref <> ? LIMIT 1`
        ).get(value, ownerRef) as { owner_ref: string } | undefined;
        const ownersOtherAccount = this.db.prepare(`SELECT account_id FROM account_mutation_intents
          WHERE owner_ref = ? AND account_id IS NOT NULL AND account_id <> ? LIMIT 1`
        ).get(ownerRef, value) as { account_id: string } | undefined;
        if (conflictingIntent || ownersOtherAccount) {
          throw new IdentityBindingConflictError('Account identity conflicts with a persisted intent.');
        }
      }

      if (!existing) {
        this.db.prepare(`INSERT INTO account_mutation_bindings (owner_ref,${column}) VALUES (?,?)`)
          .run(ownerRef, value);
      } else if (current === null) {
        this.db.prepare(`UPDATE account_mutation_bindings
          SET ${column} = ?, updated_at = datetime('now') WHERE owner_ref = ?`).run(value, ownerRef);
      }
      if (column === 'account_id') {
        this.db.prepare(`UPDATE account_mutation_intents SET account_id = ?
          WHERE owner_ref = ? AND account_id IS NULL`).run(value, ownerRef);
      }
    })();
  }

  getBinding(ownerRef: string): { ownerRef: string; mailboxRef: string | null; accountId: string | null } | null {
    requireRef(ownerRef, 'ownerRef');
    return this.readBinding(ownerRef);
  }

  getOwnerByMailbox(mailboxRef: string): string | null {
    requireRef(mailboxRef, 'mailboxRef');
    const row = this.db.prepare(
      'SELECT owner_ref FROM account_mutation_bindings WHERE mailbox_ref = ?'
    ).get(mailboxRef) as { owner_ref: string } | undefined;
    return row ? row.owner_ref : null;
  }


  private readBinding(ownerRef: string): { ownerRef: string; mailboxRef: string | null; accountId: string | null } | null {
    const row = this.db.prepare(`SELECT owner_ref,mailbox_ref,account_id
      FROM account_mutation_bindings WHERE owner_ref = ?`).get(ownerRef) as BindingRow | undefined;
    return row ? { ownerRef: row.owner_ref, mailboxRef: row.mailbox_ref, accountId: row.account_id } : null;
  }

  settleIntent(
    ownerRef: string,
    stepAttemptId: string,
    state: Exclude<IntentState, 'outcome-unknown'>,
    evidenceRef: string
  ): void {
    requireRef(ownerRef, 'ownerRef');
    requireRef(stepAttemptId, 'stepAttemptId');
    requireRef(evidenceRef, 'evidenceRef');
    if (state !== 'effect-confirmed' && state !== 'no-effect-confirmed') {
      throw new Error('Settlement state must confirm effect or no effect.');
    }

    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM account_mutation_intents
        WHERE owner_ref IS ? AND step_attempt_id = ?`).get(ownerRef, stepAttemptId) as IntentRow | undefined;
      if (!row) throw new Error('Settlement requires the exact UNKNOWN intent owner and attempt.');
      if (row.state !== 'outcome-unknown') {
        if (row.state === state && row.evidence_ref === evidenceRef) return;
        throw new Error('Conflicting terminal settlement is not allowed.');
      }
      const changed = this.db.prepare(`UPDATE account_mutation_intents
        SET state = ?, evidence_ref = ?, settled_at = datetime('now')
        WHERE authority_ref = ? AND operation_key = ? AND state = 'outcome-unknown'`
      ).run(state, evidenceRef, row.authority_ref, row.operation_key);
      if (changed.changes !== 1) throw new Error('Settlement lost the exact UNKNOWN intent.');
    })();
  }
}
