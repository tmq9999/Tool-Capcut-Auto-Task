import { describe, expect, it, vi } from 'vitest';
import { HttpOnlyRunner } from '../httpOnlyRunner';
import { createAccountHttpSession } from '../accountSession';
import type { TaskSnapshot } from '../../taskApi';
import type { NativeHttpContext } from '../nativeHttpContext';

const snap = (status: number): TaskSnapshot => ({ at: Date.now(), byKey: new Map([['k', { taskKey: 'k', taskId: 1, title: 'K', reward: 10, status, buttonText: '', childIds: [] }]]), totalReward: 10, earnedReward: status === 4 ? 10 : 0, doneKeys: status === 4 ? ['k'] : [] });
const session = createAccountHttpSession({ accountId: 'a', proxy: { server: 'http://127.0.0.1:1' }, context: {
  transport: 'cycletls', fetch: async () => { throw new Error('unused'); }, get: async () => { throw new Error('unused'); }, stream: async () => { throw new Error('unused'); }, dispose: async () => undefined
} satisfies NativeHttpContext });
const contract = { operation: 'test', revision: 'r1', origin: 'https://edit-api-sg.capcut.com', method: 'POST' as const, path: '/test', fields: [], state: 'fixture-verified' as const };

describe('HTTP-only runner', () => {
  it('allows a server-managed parent only through covered child tasks', async () => {
    const initial = snap(1);
    initial.byKey.set('parent', { ...initial.byKey.get('k')!, taskKey: 'parent', taskId: 2, childIds: [1] });
    const run = vi.fn().mockResolvedValue({ operationId: 'op-1', taskKeys: ['k'], proofs: [{ actionKey: 'k', errNo: 0, opId: 'k_1' }] });
    const runner = new HttpOnlyRunner({ getTaskList: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, at: initial.at + 1, byKey: new Map([...initial.byKey].map(([key, task]) => [key, { ...task, status: 4 }])), doneKeys: ['k'], earnedReward: 10 }) }, [{ name: 'op', taskKeys: ['k'], contract, run }]);
    const result = await runner.run(session, new AbortController().signal);
    expect(result.operations).toEqual(['op']);
    expect(result.evidence.get('parent')?.state).not.toBe('verified');
  });

  it('rejects a parent cycle instead of treating it as HTTP coverage', async () => {
    const initial = snap(1);
    initial.byKey.get('k')!.childIds = [2];
    initial.byKey.set('parent', { ...initial.byKey.get('k')!, taskKey: 'parent', taskId: 2, childIds: [1] });
    const runner = new HttpOnlyRunner({ getTaskList: async () => initial }, []);
    await expect(runner.run(session, new AbortController().signal)).rejects.toThrow('HTTP_OPERATION_UNAVAILABLE');
  });
  it('rejects uncovered tasks before dispatching any operation', async () => {
    const initial = snap(1);
    initial.byKey.set('missing', { ...initial.byKey.get('k')!, taskKey: 'missing', taskId: 2 });
    const run = vi.fn();
    const runner = new HttpOnlyRunner({ getTaskList: async () => initial }, [{ name: 'op', taskKeys: ['k'], contract, run }]);
    await expect(runner.run(session, new AbortController().signal)).rejects.toThrow('HTTP_OPERATION_UNAVAILABLE');
    expect(run).not.toHaveBeenCalled();
  });

  it('does not skip available regional tasks when another group key is absent', async () => {
    const run = vi.fn().mockResolvedValue({ operationId: 'op-1', taskKeys: ['k'], proofs: [{ actionKey: 'k', errNo: 0, opId: 'k_1' }] });
    const runner = new HttpOnlyRunner({ getTaskList: vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(4)) }, [{ name: 'op', taskKeys: ['k', 'absent-in-region'], contract, run }]);
    await runner.run(session, new AbortController().signal);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][2]).toEqual(new Set(['k']));
  });

  it('rejects duplicate task writers before any mutation', async () => {
    const run = vi.fn();
    const runner = new HttpOnlyRunner({ getTaskList: async () => snap(1) }, [
      { name: 'first', taskKeys: ['k'], contract, run }, { name: 'second', taskKeys: ['k'], contract, run }
    ]);
    await expect(runner.run(session, new AbortController().signal)).rejects.toThrow('HTTP_OPERATION_DUPLICATE');
    expect(run).not.toHaveBeenCalled();
  });
  it('executes only registered HTTP operations and refreshes snapshot', async () => {
    const getTaskList = vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(4));
    const run = vi.fn().mockResolvedValue({ operationId: 'op-1', taskKeys: ['k'], proofs: [{ actionKey: 'k', errNo: 0, opId: 'k_1' }] });
    const runner = new HttpOnlyRunner({ getTaskList }, [{ name: 'op', taskKeys: ['k'], contract, run }]);
    const result = await runner.run(session, new AbortController().signal);
    expect(result.snapshot.doneKeys).toEqual(['k']);
    expect(run).toHaveBeenCalledWith(session, expect.any(AbortSignal), new Set(['k']));
    expect(result.operations).toEqual(['op']);
  });

  it('does not run an operation for completed tasks', async () => {
    const run = vi.fn();
    const runner = new HttpOnlyRunner({ getTaskList: vi.fn().mockResolvedValue(snap(4)) }, [{ name: 'op', taskKeys: ['k'], contract, run }]);
    await runner.run(session, new AbortController().signal);
    expect(run).not.toHaveBeenCalled();
  });
});
