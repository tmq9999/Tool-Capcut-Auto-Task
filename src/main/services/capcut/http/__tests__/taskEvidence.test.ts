import { describe, expect, it } from 'vitest';
import { HttpTaskEvidenceReducer, taskIsVerified } from '../taskEvidence';
import type { TaskSnapshot } from '../../taskApi';

const snapshot = (at: number, status: number): TaskSnapshot => ({
  at,
  byKey: new Map([['k', { taskKey: 'k', taskId: 1, title: 'K', reward: 10, status, buttonText: '', childIds: [] }]]),
  totalReward: 10,
  earnedReward: status === 4 ? 10 : 0,
  doneKeys: status === 4 ? ['k'] : []
});

describe('HTTP task evidence reducer', () => {
  it('requires proof and status 4 before verified', () => {
    const reducer = new HttpTaskEvidenceReducer();
    reducer.applySnapshot(snapshot(1, 4));
    expect(reducer.get('k')?.state).toBe('pending');
    reducer.applyProof({ actionKey: 'k', opId: 'op', errNo: 0, errTips: '', at: 2 });
    expect(reducer.get('k')?.state).toBe('pending');
    reducer.applySnapshot(snapshot(3, 4));
    expect(reducer.get('k')?.state).toBe('verified');
    expect(taskIsVerified(snapshot(3, 4).byKey.get('k')!, reducer.get('k'))).toBe(true);
  });

  it('never verifies a snapshot fetched before or at the proof timestamp', () => {
    const reducer = new HttpTaskEvidenceReducer();
    reducer.applyProof({ actionKey: 'k', opId: 'op', errNo: 0, errTips: '', at: 5 });
    reducer.applySnapshot(snapshot(4, 4));
    expect(reducer.get('k')?.state).toBe('pending');
    reducer.applySnapshot(snapshot(5, 4));
    expect(reducer.get('k')?.state).toBe('pending');
  });

  it('revokes verification when the newer server snapshot is not done', () => {
    const reducer = new HttpTaskEvidenceReducer();
    reducer.applyProof({ actionKey: 'k', opId: 'op', errNo: 0, errTips: '', at: 2 });
    reducer.applySnapshot(snapshot(3, 4));
    reducer.applySnapshot(snapshot(4, 2));
    expect(reducer.get('k')).toMatchObject({ state: 'pending', status: 2 });
  });

  it('ignores an older proof arriving after a newer rejection', () => {
    const reducer = new HttpTaskEvidenceReducer();
    reducer.applyProof({ actionKey: 'k', opId: 'new', errNo: 1, errTips: '', at: 5 });
    reducer.applyProof({ actionKey: 'k', opId: 'old', errNo: 0, errTips: '', at: 4 });
    reducer.applySnapshot(snapshot(6, 4));
    expect(reducer.get('k')).toMatchObject({ state: 'failed', proof: { opId: 'new' } });
  });

  it('ignores stale snapshots and preserves failed/unknown evidence', () => {
    const reducer = new HttpTaskEvidenceReducer();
    reducer.applyProof({ actionKey: 'k', opId: 'op', errNo: 1, errTips: 'rejected', at: 5 });
    reducer.applySnapshot(snapshot(4, 4));
    expect(reducer.get('k')?.state).toBe('failed');
    reducer.markUnknown('k', 6);
    expect(reducer.get('k')?.state).toBe('unknown');
    reducer.applySnapshot(snapshot(3, 1));
    expect(reducer.get('k')?.status).toBe(4);
  });
});
