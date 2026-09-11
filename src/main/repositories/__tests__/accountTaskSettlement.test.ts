import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrator';
import { AccountTaskRepository } from '../AccountTaskRepository';

describe('AccountTaskRepository Settlement & Timestamps (V07)', () => {
  let db: Database.Database;
  let repo: AccountTaskRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new AccountTaskRepository(db);
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  it('does not delete a proof newer than an offset timestamp', () => {
    // 04:00:00 UTC is NEWER than 10:00:00+07:00 (which is 03:00:00 UTC).
    // Lexical check '2026-09-11T04:00:00.000Z' < '2026-09-11T10:00:00+07:00' would falsely delete it.
    const proofAt = Date.parse('2026-09-11T04:00:00.000Z');
    repo.recordUnsettledProofs('a', 'r', [{
      key: 'task-a', proof: { actionKey: 'task-a', opId: 'demo-op', errNo: 0, at: proofAt }
    }]);

    repo.recordCheckpoint('a', {
      rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
      receipt: {
        runId: 'r',
        sessionAlias: 's',
        observedAt: '2026-09-11T10:00:00+07:00',
        requiredAfter: '2026-09-11T02:00:00.000Z',
        serverTotal: 1,
        serverDone: 1,
        isFresh: true,
        isFinal: true
      },
      unsettledProofs: []
    });

    const proofs = repo.listUnsettledProofs('a', 'r');
    expect(proofs).toHaveLength(1);
    expect(proofs[0].key).toBe('task-a');
  });

  it('deletes an unsettled proof older than the canonical observedAt timestamp', () => {
    // 02:30:00 UTC is OLDER than 10:00:00+07:00 (which is 03:00:00 UTC).
    const proofAt = Date.parse('2026-09-11T02:30:00.000Z');
    repo.recordUnsettledProofs('a', 'r', [{
      key: 'task-a', proof: { actionKey: 'task-a', opId: 'demo-op-old', errNo: 0, at: proofAt }
    }]);

    repo.recordCheckpoint('a', {
      rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
      receipt: {
        runId: 'r',
        sessionAlias: 's',
        observedAt: '2026-09-11T10:00:00+07:00',
        requiredAfter: '2026-09-11T02:00:00.000Z',
        serverTotal: 1,
        serverDone: 1,
        isFresh: true,
        isFinal: true
      },
      unsettledProofs: []
    });

    expect(repo.listUnsettledProofs('a', 'r')).toHaveLength(0);
  });

  it('rejects invalid observedAt timestamp without mutating database', () => {
    const proofAt = Date.parse('2026-09-11T02:30:00.000Z');
    repo.recordUnsettledProofs('a', 'r', [{
      key: 'task-a', proof: { actionKey: 'task-a', opId: 'demo-op-preserve', errNo: 0, at: proofAt }
    }]);

    expect(() => {
      repo.recordCheckpoint('a', {
        rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
        receipt: {
          runId: 'r',
          sessionAlias: 's',
          observedAt: 'invalid-date',
          requiredAfter: '2026-09-11T02:00:00.000Z',
          serverTotal: 1,
          serverDone: 1,
          isFresh: true,
          isFinal: true
        },
        unsettledProofs: []
      });
    }).toThrow('INVALID_CHECKPOINT_TIMESTAMP');

    // Proof should still be there (no partial mutation)
    expect(repo.listUnsettledProofs('a', 'r')).toHaveLength(1);
  });

  it('rejects invalid requiredAfter timestamp without mutating database', () => {
    expect(() => {
      repo.recordCheckpoint('a', {
        rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
        receipt: {
          runId: 'r',
          sessionAlias: 's',
          observedAt: '2026-09-11T10:00:00+07:00',
          requiredAfter: 'invalid-date',
          serverTotal: 1,
          serverDone: 1,
          isFresh: true,
          isFinal: true
        },
        unsettledProofs: []
      });
    }).toThrow('INVALID_CHECKPOINT_TIMESTAMP');
  });

  it('canonicalizes receipt observedAt and requiredAfter to UTC ISO strings', () => {
    repo.recordCheckpoint('a', {
      rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
      receipt: {
        runId: 'r',
        sessionAlias: 's',
        observedAt: '2026-09-11T10:00:00+07:00',
        requiredAfter: '2026-09-11T09:00:00+07:00',
        serverTotal: 1,
        serverDone: 1,
        isFresh: true,
        isFinal: true
      },
      unsettledProofs: []
    });

    const latest = repo.getLatestReceipt('a');
    expect(latest?.receipt.observedAt).toBe('2026-09-11T03:00:00.000Z');
    expect(latest?.receipt.requiredAfter).toBe('2026-09-11T02:00:00.000Z');
  });

  it('preserves proofs for other tasks and other runs', () => {
    const proofAt = Date.parse('2026-09-11T02:00:00.000Z');
    repo.recordUnsettledProofs('a', 'r1', [{
      key: 'task-a', proof: { actionKey: 'task-a', opId: 'op-a', errNo: 0, at: proofAt }
    }]);
    repo.recordUnsettledProofs('a', 'r1', [{
      key: 'task-b', proof: { actionKey: 'task-b', opId: 'op-b', errNo: 0, at: proofAt }
    }]);
    repo.recordUnsettledProofs('a', 'r2', [{
      key: 'task-a', proof: { actionKey: 'task-a', opId: 'op-a-r2', errNo: 0, at: proofAt }
    }]);

    repo.recordCheckpoint('a', {
      rows: [
        { key: 'task-a', title: 'A', reward: 10, status: 4 },
        { key: 'task-b', title: 'B', reward: 10, status: 1 }
      ],
      receipt: {
        runId: 'r1',
        sessionAlias: 's',
        observedAt: '2026-09-11T03:00:00.000Z',
        requiredAfter: '2026-09-11T01:00:00.000Z',
        serverTotal: 2,
        serverDone: 1,
        isFresh: true,
        isFinal: true
      },
      unsettledProofs: []
    });

    // task-a on r1 settled
    const r1Proofs = repo.listUnsettledProofs('a', 'r1');
    expect(r1Proofs).toHaveLength(1);
    expect(r1Proofs[0].key).toBe('task-b');

    // task-a on r2 still untouched
    const r2Proofs = repo.listUnsettledProofs('a', 'r2');
    expect(r2Proofs).toHaveLength(1);
    expect(r2Proofs[0].key).toBe('task-a');
  });
});
