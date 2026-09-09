import { describe, expect, it } from 'vitest';
import { AutomationEvidenceEventSchema } from '../automation-evidence.schema';

const base = { schemaVersion: 1, runId: 'run-boundary', at: '2026-09-08T00:00:00.000Z' };
const identity = { workerAlias: 'worker-1', accountAlias: 'account-1', sessionAlias: 'worker-1-session-1' };

describe('rollout evidence identity and redaction boundary', () => {
  it('accepts optional session-target policy and UI completion outcome while preserving legacy events', () => {
    const runStart = { ...base, type: 'run-start', mode: 'new', headed: true, stage: 3,
      workerTarget: 3, maxBillablePurchases: 3 };
    const finished = { ...base, workerAlias: identity.workerAlias, sessionAlias: identity.sessionAlias,
      type: 'ui-finished', lane: 'editor', label: 'design-studio', holdMs: 25 };
    expect(AutomationEvidenceEventSchema.safeParse(runStart).success).toBe(true);
    expect(AutomationEvidenceEventSchema.safeParse({ ...runStart, uiScope: 'session-target' }).success).toBe(true);
    expect(AutomationEvidenceEventSchema.safeParse({ ...runStart, uiScope: 'global-target' }).success).toBe(false);
    expect(AutomationEvidenceEventSchema.safeParse(finished).success).toBe(true);
    expect(AutomationEvidenceEventSchema.safeParse({ ...finished, outcome: 'rejected' }).success).toBe(true);
    expect(AutomationEvidenceEventSchema.safeParse({ ...finished, outcome: 'timed-out' }).success).toBe(false);
  });

  it('accepts anonymous profile and account lifecycle events', () => {
    for (const fields of [
      { type: 'profile-start' },
      { type: 'profile-stop', outcome: 'confirmed' },
      { type: 'account-terminal', outcome: 'completed' },
      { type: 'mailbox-acquired' }
    ]) {
      expect(AutomationEvidenceEventSchema.safeParse({ ...base, ...identity, ...fields }).success).toBe(true);
    }
  });

  it('rejects missing ownership aliases on profile and checkpoint evidence', () => {
    expect(AutomationEvidenceEventSchema.safeParse({ ...base, type: 'profile-stop', outcome: 'confirmed' }).success).toBe(false);
    expect(AutomationEvidenceEventSchema.safeParse({ ...base, type: 'task-checkpoint', fresh: true, final: true,
      observedAt: base.at, requiredAfter: '2026-09-07T23:00:00.000Z', serverTotal: 1, serverDone: 1,
      tasks: [{ key: 'capcut_web_newbie_register', status: 4 }] }).success).toBe(false);
  });

  it('rejects secret-like strings in otherwise allowed label, task key and run id fields', () => {
    const uiIdentity = { workerAlias: identity.workerAlias, sessionAlias: identity.sessionAlias };
    expect(AutomationEvidenceEventSchema.safeParse({ ...base, ...uiIdentity, type: 'ui-queued', lane: 'foreground', label: 'ui-action' }).success).toBe(true);
    for (const label of ['secret@example.invalid', 'token-secret-value', 'http://127.0.0.1:1234']) {
      expect(AutomationEvidenceEventSchema.safeParse({ ...base, ...uiIdentity, type: 'ui-queued', lane: 'foreground', label }).success).toBe(false);
    }
    expect(AutomationEvidenceEventSchema.safeParse({ ...base, ...identity, type: 'ui-queued', lane: 'foreground', label: 'ui-action', runId: 'run-secret@example.invalid' }).success).toBe(false);
    expect(AutomationEvidenceEventSchema.safeParse({ ...base, ...identity, type: 'task-checkpoint', fresh: false, final: false,
      observedAt: base.at, requiredAfter: base.at, serverTotal: 1, serverDone: 0,
      tasks: [{ key: 'secret@example.invalid', status: 1 }] }).success).toBe(false);
  });

  it('retains terminal mode, stage and measured mailbox count', () => {
    const terminal = { ...base, type: 'terminal', mode: 'new', stage: 3, mailboxAcquisitions: 3,
      state: 'completed', code: 'MAIL_LIMIT_REACHED', accepted: 3, completed: 3, failed: 0, stopped: 0,
      skipped: 0, cleanupFailures: 0, purchaseAttempted: 2, purchaseConfirmed: 2, purchaseAmbiguous: 0 };
    expect(AutomationEvidenceEventSchema.safeParse(terminal).success).toBe(true);
    expect(AutomationEvidenceEventSchema.safeParse({ ...terminal, mode: undefined }).success).toBe(false);
    expect(AutomationEvidenceEventSchema.safeParse({ ...terminal, mailboxAcquisitions: undefined }).success).toBe(false);
  });
});
