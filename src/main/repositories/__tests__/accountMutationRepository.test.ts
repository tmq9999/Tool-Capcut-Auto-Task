import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import {
  AccountMutationRepository,
  ApprovalConflictError,
  ApprovalExhaustedError,
  IntentAlreadyRecordedError,
  IdentityBindingConflictError,
  UnknownMutationError
} from '../AccountMutationRepository';

let tempDir: string;
let databasePath: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-mutation-registry-'));
  databasePath = path.join(tempDir, 'registry.db');
  db = createDatabaseConnection(databasePath);
  runMigrations(db);
});

afterEach(() => {
  if (db?.open) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function purchaseIntent(overrides: Partial<Parameters<AccountMutationRepository['recordIntent']>[0]> = {}) {
  return {
    authorityRef: 'authority-1',
    budgetOwnerRef: 'budget-1',
    ownerRef: 'acquisition-1',
    accountId: null,
    runId: 'run-1',
    sessionAlias: null,
    stepAttemptId: 'attempt-1',
    stepId: 'purchase-mailbox',
    taskKey: null,
    operation: 'purchase' as const,
    operationKey: 'purchase:acquisition-1:1',
    intentAt: '2026-09-09T00:00:00.000Z',
    state: 'outcome-unknown' as const,
    evidenceRef: null,
    ...overrides
  };
}

function register(repo: AccountMutationRepository, overrides: Partial<Parameters<AccountMutationRepository['registerApproval']>[0]> = {}) {
  repo.registerApproval({
    authorityRef: 'authority-1',
    budgetOwnerRef: 'budget-1',
    provider: 'gmail94',
    approvedUnits: 2,
    ...overrides
  });
}

describe('AccountMutationRepository durable approval and intent registry', () => {
  it('persists UNKNOWN before dispatch and preserves consumed units after a real reopen', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    repo.recordIntent(purchaseIntent(), 1);

    expect(repo.getApproval('authority-1')).toMatchObject({ approvedUnits: 2, consumedUnits: 1 });
    expect(repo.listBlocking({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'acquisition-1', operation: 'purchase'
    })).toMatchObject([{ state: 'outcome-unknown', operation: 'purchase', billableUnits: 1 }]);

    db.close();
    db = createDatabaseConnection(databasePath);
    runMigrations(db);
    const reopened = new AccountMutationRepository(db);
    expect(reopened.getApproval('authority-1')).toMatchObject({ approvedUnits: 2, consumedUnits: 1 });
    expect(() => reopened.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'acquisition-1', operation: 'purchase'
    })).toThrow(UnknownMutationError);
  });

  it('keeps approval authority immutable and cannot reset its cap or consumed units', () => {
    const repo = new AccountMutationRepository(db);
    register(repo, { approvedUnits: 1 });
    repo.recordIntent(purchaseIntent(), 1);

    register(repo, { approvedUnits: 1 });
    expect(() => register(repo, { approvedUnits: 2 })).toThrow(ApprovalConflictError);
    expect(() => repo.recordIntent(purchaseIntent({
      runId: 'run-2', stepAttemptId: 'attempt-2', operationKey: 'purchase:acquisition-1:2'
    }), 1)).toThrow(UnknownMutationError);
    expect(repo.getApproval('authority-1')).toMatchObject({ approvedUnits: 1, consumedUnits: 1 });
  });

  it('rejects a second provider claiming an existing stable budget owner', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);

    expect(() => register(repo, {
      authorityRef: 'authority-2', provider: 'dongvanfb'
    })).toThrow(ApprovalConflictError);
    expect(repo.getApproval('authority-2')).toBeNull();
  });

  it('spends one stable authority cap across separate owners and runs', () => {
    const repo = new AccountMutationRepository(db);
    register(repo, { approvedUnits: 3 });
    for (let index = 1; index <= 3; index += 1) {
      const ownerRef = `acquisition-${index}`;
      const stepAttemptId = `attempt-${index}`;
      repo.recordIntent(purchaseIntent({
        ownerRef,
        runId: `run-${index}`,
        stepAttemptId,
        operationKey: `purchase:${ownerRef}:1`
      }), 1);
      repo.settleIntent(ownerRef, stepAttemptId, 'effect-confirmed', `purchase-receipt:opaque-${index}`);
    }

    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(3);
    expect(() => repo.recordIntent(purchaseIntent({
      ownerRef: 'acquisition-4', runId: 'run-4', stepAttemptId: 'attempt-4',
      operationKey: 'purchase:acquisition-4:1'
    }), 1)).toThrow(ApprovalExhaustedError);
  });

  it('throws on an identical recorded attempt so a caller cannot dispatch a second side effect', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    const intent = purchaseIntent();
    let dispatchCount = 0;
    const dispatch = () => {
      repo.recordIntent(intent, 1);
      dispatchCount += 1;
    };
    dispatch();
    repo.settleIntent('acquisition-1', 'attempt-1', 'effect-confirmed', 'purchase-receipt:opaque-1');

    expect(dispatch).toThrow(IntentAlreadyRecordedError);
    expect(dispatchCount).toBe(1);
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(1);
    expect(repo.getIntent('authority-1', 'purchase:acquisition-1:1')).toMatchObject({
      state: 'effect-confirmed', evidenceRef: 'purchase-receipt:opaque-1'
    });
    expect(() => repo.recordIntent({ ...intent, runId: 'different-run' }, 1)).toThrow(/conflicting intent/i);
  });

  it('rolls back unit consumption when UNKNOWN insertion fails transactionally', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    db.exec(`CREATE TRIGGER reject_mutation_intent BEFORE INSERT ON account_mutation_intents
      BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END;`);

    expect(() => repo.recordIntent(purchaseIntent(), 1)).toThrow(/forced insert failure/);
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(0);
    expect(repo.getIntent('authority-1', 'purchase:acquisition-1:1')).toBeNull();
  });

  it('rejects unapproved, exhausted, or preconfirmed billable insertion before mutation', () => {
    const repo = new AccountMutationRepository(db);
    expect(() => repo.recordIntent(purchaseIntent(), 1)).toThrow(/approval/i);
    register(repo, { approvedUnits: 0 });
    expect(() => repo.recordIntent(purchaseIntent(), 1)).toThrow(ApprovalExhaustedError);
    expect(() => repo.recordIntent(purchaseIntent({
      state: 'effect-confirmed', evidenceRef: 'fake-proof'
    }), 1)).toThrow(/new UNKNOWN/i);
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(0);
  });

  it('rejects a zero-unit purchase so approval caps cannot be bypassed', () => {
    const repo = new AccountMutationRepository(db);
    register(repo, { approvedUnits: 0 });

    expect(() => repo.recordIntent(purchaseIntent(), 0)).toThrow(/purchase.*one approval unit/i);
    expect(repo.getIntent('authority-1', 'purchase:acquisition-1:1')).toBeNull();
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(0);
  });

  it('rejects an accountless non-purchase UNKNOWN intent', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);

    expect(() => repo.recordIntent(purchaseIntent({
      accountId: null,
      operation: 'upload',
      operationKey: 'upload:assetless',
      stepId: 'upload',
      taskKey: 'daily-upload'
    }), 0)).toThrow(/accountId.*required|non-purchase.*account/i);
    expect(repo.getIntent('authority-1', 'upload:assetless')).toBeNull();
  });

  it('blocks a new authority on the same budget owner while a purchase has unresolved identity', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    repo.recordIntent(purchaseIntent({ ownerRef: 'acquisition-unresolved' }), 1);
    register(repo, { authorityRef: 'authority-2' });

    expect(() => repo.recordIntent(purchaseIntent({
      authorityRef: 'authority-2', ownerRef: 'acquisition-2', runId: 'run-2',
      stepAttemptId: 'attempt-2', operationKey: 'purchase:acquisition-2:1'
    }), 1)).toThrow(UnknownMutationError);
    expect(repo.getApproval('authority-2')?.consumedUnits).toBe(0);
  });

  it('binds mailbox and account durably and rejects identity crosswiring', () => {
    const repo = new AccountMutationRepository(db);
    repo.bindMailbox('acquisition-1', 'purchased-email:opaque-1');
    repo.bindAccount('acquisition-1', 'account-1');
    repo.bindMailbox('acquisition-1', 'purchased-email:opaque-1');
    repo.bindAccount('acquisition-1', 'account-1');

    expect(() => repo.bindMailbox('acquisition-1', 'purchased-email:opaque-2')).toThrow(IdentityBindingConflictError);
    expect(() => repo.bindAccount('acquisition-1', 'account-2')).toThrow(IdentityBindingConflictError);
    expect(() => repo.bindMailbox('acquisition-2', 'purchased-email:opaque-1')).toThrow(IdentityBindingConflictError);
    expect(() => repo.bindAccount('acquisition-2', 'account-1')).toThrow(IdentityBindingConflictError);

    db.close();
    db = createDatabaseConnection(databasePath);
    runMigrations(db);
    expect(new AccountMutationRepository(db).getBinding('acquisition-1')).toEqual({
      ownerRef: 'acquisition-1', mailboxRef: 'purchased-email:opaque-1', accountId: 'account-1'
    });
  });

  it('rejects an intent account that contradicts a durable owner binding', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    repo.bindAccount('acquisition-1', 'account-1');

    expect(() => repo.recordIntent(purchaseIntent({ accountId: 'account-2' }), 1))
      .toThrow(IdentityBindingConflictError);
    expect(repo.getIntent('authority-1', 'purchase:acquisition-1:1')).toBeNull();
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(0);
  });

  it('resolves a purchase UNKNOWN through its durable mailbox binding across aliases', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    repo.recordIntent(purchaseIntent(), 1);
    repo.bindMailbox('acquisition-1', 'purchased-email:opaque-1');

    expect(() => repo.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'later-run-alias',
      mailboxRef: 'purchased-email:opaque-1', operation: 'purchase'
    })).toThrow(UnknownMutationError);
    expect(() => repo.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'different-acquisition',
      mailboxRef: 'purchased-email:opaque-2', operation: 'purchase'
    })).not.toThrow();
  });

  it('finds an account-bound UNKNOWN across run and session aliases without blocking another UI account', () => {
    const repo = new AccountMutationRepository(db);
    register(repo);
    repo.bindAccount('acquisition-1', 'account-1');
    repo.recordIntent(purchaseIntent({
      accountId: 'account-1', operation: 'upload', operationKey: 'upload:asset-1',
      stepId: 'upload', taskKey: 'daily-upload', sessionAlias: 'run-1-session-1'
    }), 0);

    expect(() => repo.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'different-alias',
      accountId: 'account-1', operation: 'upload'
    })).toThrow(UnknownMutationError);
    expect(() => repo.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'acquisition-2',
      accountId: 'account-2', operation: 'upload'
    })).not.toThrow();
    expect(() => repo.assertNoUnknown({
      authorityRef: 'authority-1', budgetOwnerRef: 'budget-1', ownerRef: 'different-alias',
      accountId: 'account-1', operation: 'export'
    })).not.toThrow();
  });

  it('settles only the exact owner and attempt with safe evidence and never refunds units', () => {
    const repo = new AccountMutationRepository(db);
    register(repo, { approvedUnits: 1 });
    repo.recordIntent(purchaseIntent(), 1);

    expect(() => repo.settleIntent('wrong-owner', 'attempt-1', 'no-effect-confirmed', 'provider:no-order')).toThrow(/exact UNKNOWN intent/i);
    expect(() => repo.settleIntent('acquisition-1', 'attempt-1', 'no-effect-confirmed', 'secret token=raw')).toThrow(/evidence/i);
    repo.settleIntent('acquisition-1', 'attempt-1', 'no-effect-confirmed', 'provider:no-order');

    expect(repo.getIntent('authority-1', 'purchase:acquisition-1:1')).toMatchObject({
      state: 'no-effect-confirmed', evidenceRef: 'provider:no-order'
    });
    expect(repo.getApproval('authority-1')?.consumedUnits).toBe(1);
    expect(() => repo.settleIntent(
      'acquisition-1', 'attempt-1', 'effect-confirmed', 'provider:order-appeared'
    )).toThrow(/conflicting terminal/i);
  });
});
