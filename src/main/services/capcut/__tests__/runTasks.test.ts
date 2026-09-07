import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import fs from 'node:fs';
import { runGroup } from '../missionRunner';
import { DomReadTimeoutError } from '../cancellation';

import type { CapcutMissionEnv, MissionGroup, TaskCheckpoint } from '../types';

vi.mock('../diag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diag')>();
  return { ...actual, attachNetDiag: vi.fn() };
});

import type { TaskStore } from '../taskApi';

let latestTaskStore: TaskStore | null = null;

vi.mock('../taskApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../taskApi')>();
  const fs = await import('node:fs');
  const initialJson = fs.readFileSync(
    'tools/fixtures/task-list-initial.json',
    'utf8'
  );
  return {
    ...actual,
    attachTaskMonitor: (
      _context: BrowserContext,
      store: InstanceType<typeof actual.TaskStore>
    ) => {
      latestTaskStore = store;
      store.pushTaskList(initialJson, 100);
    }
  };
});

vi.mock('../missionRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../missionRunner')>();
  return {
    ...actual,
    claimIfPending: vi.fn(async () => false),
    closeTaskPopover: vi.fn(async () => true),
    findTaskEntry: vi.fn(async () => null),
    withTaskPopover: vi.fn(async (_page: Page, fn: () => Promise<unknown>) => fn()),
    runGroup: vi.fn(async (
      group: MissionGroup,
      env: CapcutMissionEnv,
      _store: unknown,
      need: Set<string>
    ) => {
      await group.act(env, need);
      return {
        evidence: new Map([...need].map((key) => [
          key,
          {
            key,
            state: 'proved-awaiting-snapshot' as const,
            proof: {
              actionKey: key,
              opId: key + '_op',
              errNo: 0,
              errTips: '',
              at: 101
            }
          }
        ])),
        snapshot: null,
        actionSettledAt: 101
      };
    })
  };
});

const { runAllTasks } = await import('../runTasks');
const {
  FINAL_SNAPSHOT_WAIT_MS,
  INTER_ROUND_WAIT_MS,
  needsFinalSnapshotRefresh
} = await import('../runTasks');

afterEach(() => {
  vi.useRealTimers();
});

describe('runTasks orchestration with proof memory', () => {
  it('returns partial snapshot and fatal error without attempting the next group', async () => {
    vi.useFakeTimers();
    const failure = new DomReadTimeoutError('canvas-area:mouse-move');
    vi.mocked(runGroup).mockImplementationOnce(async (_group, _env, store) => ({
      evidence: new Map(), snapshot: store.snapshot(), actionSettledAt: Date.now(), fatalError: failure
    }));
    const next = vi.fn(async () => {});
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({ page, context: {} as BrowserContext, sampleImage: 'sample.png',
      signal: new AbortController().signal, log: () => {}, maxRounds: 2, groups: [
        { id: 'design-studio', workspace: 'editor', name: 'Design', keys: ['capcut_web_design_studio_ai_chat'], proofTimeoutMs: 90000, act: async () => {} },
        { id: 'video-studio', workspace: 'editor', name: 'Video', keys: ['capcut_web_video_studio_send_msg'], proofTimeoutMs: 240000, act: next }
      ] });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.fatalError).toBe(failure);
    expect(result.snapshot?.done).toBe(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('preserves proof emitted before a fatal group timeout', async () => {
    vi.useFakeTimers();
    const key = 'capcut_web_design_studio_ai_chat';
    const failure = new DomReadTimeoutError('canvas-area:mouse-move');
    vi.mocked(runGroup).mockImplementationOnce(async (_group, _env, store) => {
      const evidence = new Map([
        [
          key,
          {
            key,
            state: 'proved-awaiting-snapshot' as const,
            proof: {
              actionKey: key,
              opId: 'proof-before-timeout',
              errNo: 0,
              errTips: '',
              at: 101
            }
          }
        ]
      ]);
      return {
        evidence,
        snapshot: store.snapshot(),
        actionSettledAt: 101,
        fatalError: failure
      };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      signal: new AbortController().signal,
      log: () => {},
      maxRounds: 2,
      groups: [
        {
          id: 'design-studio',
          workspace: 'editor',
          name: 'Design',
          keys: [key],
          proofTimeoutMs: 90000,
          act: async () => {}
        }
      ]
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.fatalError).toBeInstanceOf(DomReadTimeoutError);
    expect(result.outcomes.find((item) => item.key === key)?.proof).toMatchObject({
      actionKey: key,
      errNo: 0,
      opId: 'proof-before-timeout'
    });
    expect(result.outcomes.find((item) => item.key === key)?.done).toBe(false);
  });

  it('finishes immediately with a complete reconciled snapshot instead of marking it stale', async () => {
    vi.useFakeTimers();
    vi.mocked(runGroup).mockImplementationOnce(async (group, env, store, need) => {
      await group.act(env, need);
      store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), Date.now());
      return { evidence: new Map(), snapshot: store.snapshot(), actionSettledAt: Date.now() - 1 };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const start = Date.now();
    const run = runAllTasks({
      page, context: {} as BrowserContext, sampleImage: 'sample.png',
      log: () => {}, signal: new AbortController().signal, maxRounds: 1,
      groups: [{ id: 'pwa-install', workspace: 'none', name: 'PWA', keys: ['capcut_web_pwa_install'], proofTimeoutMs: 12_000, act: async () => {} }]
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.snapshot).toMatchObject({ total: 12, done: 12, missing: [], stale: false });
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('keeps the approved inter-round and final snapshot caps', () => {
    expect(INTER_ROUND_WAIT_MS).toBe(8_000);
    expect(FINAL_SNAPSHOT_WAIT_MS).toBe(10_000);
  });

  it('skips the final refresh when the latest task snapshot is already complete', () => {
    expect(needsFinalSnapshotRefresh({ total: 12, done: 12, credits: 670, creditsTotal: 670, missing: [] })).toBe(false);
    expect(needsFinalSnapshotRefresh({ total: 12, done: 11, credits: 630, creditsTotal: 670, missing: ['x'] })).toBe(true);
  });

  it('runs a proof-backed PWA action once even when later snapshots stay stale', async () => {
    vi.useFakeTimers();
    const pwaAct = vi.fn(async (_env: CapcutMissionEnv, _need: Set<string>) => {});
    const group: MissionGroup = {
      id: 'pwa-install',
      workspace: 'none',
      name: 'PWA',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: pwaAct
    };
    const page = {
      goto: vi.fn(async () => null),
      reload: vi.fn(async () => null),
      waitForTimeout: vi.fn(async () => {}),
      isClosed: vi.fn(() => false)
    } as unknown as Page;
    const context = {} as BrowserContext;

    const run = runAllTasks({
      page,
      context,
      sampleImage: 'C:/tmp/sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 2,
      groups: [group]
    });
    await vi.runAllTimersAsync();
    const result = await run;

    expect(pwaAct).toHaveBeenCalledTimes(1);
    expect(result.outcomes.find(
      (row) => row.key === 'capcut_web_pwa_install'
    )?.proof?.errNo).toBe(0);
  });

  it('recovers at the next mission boundary without replaying a proven PWA action', async () => {
    vi.useFakeTimers();
    let firstClosed = false;
    const firstPage = {
      goto: vi.fn(async () => null),
      reload: vi.fn(async () => null),
      waitForTimeout: vi.fn(async () => {}),
      isClosed: vi.fn(() => firstClosed)
    } as unknown as Page;
    const replacementPage = {
      goto: vi.fn(async () => null),
      reload: vi.fn(async () => null),
      waitForTimeout: vi.fn(async () => {}),
      isClosed: vi.fn(() => false)
    } as unknown as Page;
    const pwaAct = vi.fn(async () => { firstClosed = true; });
    const designAct = vi.fn(async () => {});
    const resolvePage = vi.fn(async (stage: string) =>
      stage === 'mission:Design Studio' ? replacementPage : firstPage
    );
    const groups: MissionGroup[] = [
      {
        id: 'pwa-install',
        workspace: 'none',
        name: 'PWA',
        keys: ['capcut_web_pwa_install'],
        proofTimeoutMs: 12_000,
        act: pwaAct
      },
      {
        id: 'design-studio',
        workspace: 'editor',
        name: 'Design Studio',
        keys: ['capcut_web_design_studio_ai_chat'],
        proofTimeoutMs: 90_000,
        act: designAct
      }
    ];

    const run = runAllTasks({
      page: firstPage,
      context: {} as BrowserContext,
      sampleImage: 'C:/tmp/sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 2,
      groups,
      resolvePage
    });
    await vi.runAllTimersAsync();
    await run;

    expect(resolvePage).toHaveBeenCalledWith('bootstrap');
    expect(resolvePage).toHaveBeenCalledWith('mission:PWA');
    expect(resolvePage).toHaveBeenCalledWith('mission:Design Studio');
    expect(pwaAct).toHaveBeenCalledTimes(1);
    expect(designAct).toHaveBeenCalledTimes(1);
  });

  it('requires a task-list receipt observed after the latest action settles', async () => {
    vi.useFakeTimers();
    const actionSettledAt = 200;
    vi.mocked(runGroup).mockImplementationOnce(async (group, env, store, need) => {
      await group.act(env, need);
      store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'), 199);
      setTimeout(() => {
        store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), 201);
      }, 50);
      return { evidence: new Map(), snapshot: store.snapshot(), actionSettledAt };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      groups: [{ id: 'pwa-install', workspace: 'none', name: 'PWA', keys: ['capcut_web_pwa_install'], proofTimeoutMs: 12_000, act: async () => {} }]
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.snapshot?.observedAt).toBe(201);
    expect(result.snapshot?.requiredAfter).toBe(200);
    expect(result.snapshot?.fresh).toBe(true);
    expect(result.snapshot?.final).toBe(true);
    expect(result.snapshot?.done).toBe(12);
  });

  it('emits a non-final checkpoint before returning a fatal result', async () => {
    vi.useFakeTimers();
    const key = 'capcut_web_design_studio_ai_chat';
    const failure = new DomReadTimeoutError('canvas-area:mouse-move');
    const checkpointCalls: TaskCheckpoint[] = [];
    vi.mocked(runGroup).mockImplementationOnce(async (_group, _env, store) => {
      const evidence = new Map([
        [
          key,
          {
            key,
            state: 'proved-awaiting-snapshot' as const,
            proof: {
              actionKey: key,
              opId: 'proof-before-timeout',
              errNo: 0,
              errTips: '',
              at: 101
            }
          }
        ]
      ]);
      return {
        evidence,
        snapshot: store.snapshot(),
        actionSettledAt: 101,
        fatalError: failure
      };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      signal: new AbortController().signal,
      log: () => {},
      maxRounds: 2,
      onCheckpoint: async (checkpoint) => {
        checkpointCalls.push(checkpoint);
      },
      groups: [
        {
          id: 'design-studio',
          workspace: 'editor',
          name: 'Design',
          keys: [key],
          proofTimeoutMs: 90000,
          act: async () => {}
        }
      ]
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.fatalError).toBe(failure);
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);
    const lastCheckpoint = checkpointCalls[checkpointCalls.length - 1];
    expect(lastCheckpoint.snapshot.final).toBe(false);
    expect(lastCheckpoint.outcomes.find((item) => item.key === key)?.proof).toMatchObject({
      actionKey: key,
      errNo: 0,
      opId: 'proof-before-timeout'
    });
  });

  it('emits a fresh final checkpoint only after the qualifying receipt', async () => {
    vi.useFakeTimers();
    const checkpointCalls: TaskCheckpoint[] = [];
    vi.mocked(runGroup).mockImplementationOnce(async (group, env, store, need) => {
      await group.act(env, need);
      setTimeout(() => {
        store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), 250);
      }, 100);
      return { evidence: new Map(), snapshot: store.snapshot(), actionSettledAt: 200 };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      onCheckpoint: async (checkpoint) => {
        checkpointCalls.push(checkpoint);
      },
      groups: [{ id: 'pwa-install', workspace: 'none', name: 'PWA', keys: ['capcut_web_pwa_install'], proofTimeoutMs: 12_000, act: async () => {} }]
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(checkpointCalls.some((c) => c.snapshot.final)).toBe(false);

    await vi.runAllTimersAsync();
    const result = await run;
    const finalCalls = checkpointCalls.filter((c) => c.snapshot.final);
    expect(finalCalls.length).toBe(1);
    expect(finalCalls[0].snapshot.fresh).toBe(true);
    expect(finalCalls[0].snapshot.observedAt).toBe(250);
    expect(result.snapshot?.final).toBe(true);
  });

  it('passively settles a same-run proof without replaying its mutation', async () => {
    vi.useFakeTimers();
    const key = 'capcut_web_video_studio_export';
    const act = vi.fn(async () => {});
    const groups: MissionGroup[] = [
      { id: 'video-studio', workspace: 'editor', name: 'Video', keys: [key], proofTimeoutMs: 120_000, act }
    ];

    const unsettledProofs = [
      {
        key,
        proof: { actionKey: key, opId: 'proof_1', errNo: 0 as const, errTips: '', at: 100 }
      }
    ];

    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      unsettledProofs,
      groups
    });

    await vi.advanceTimersByTimeAsync(50);
    latestTaskStore!.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), 200);

    await vi.runAllTimersAsync();
    const result = await run;

    expect(act).not.toHaveBeenCalled();
    expect(result.snapshot?.final).toBe(true);
    expect(result.snapshot?.done).toBe(12);
  });

  it('fails partial when a same-run proof remains non-4', async () => {
    vi.useFakeTimers();
    const key = 'capcut_web_video_studio_export';
    const act = vi.fn(async () => {});
    const groups: MissionGroup[] = [
      { id: 'video-studio', workspace: 'editor', name: 'Video', keys: [key], proofTimeoutMs: 120_000, act }
    ];

    const unsettledProofs = [
      {
        key,
        proof: { actionKey: key, opId: 'proof_1', errNo: 0 as const, errTips: '', at: 100 }
      }
    ];

    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      unsettledProofs,
      groups
    });

    await vi.runAllTimersAsync();
    const result = await run;

    expect(act).not.toHaveBeenCalled();
    expect(result.snapshot?.final).toBe(false);
    expect(result.unsettledProofs.some((u) => u.key === key)).toBe(true);
  });

  it('does not suppress an action from historical proof alone', async () => {
    vi.useFakeTimers();
    const key = 'capcut_web_pwa_install';
    const act = vi.fn(async () => {});
    const groups: MissionGroup[] = [
      { id: 'pwa-install', workspace: 'none', name: 'PWA', keys: [key], proofTimeoutMs: 12_000, act }
    ];

    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      unsettledProofs: [],
      groups
    });

    await vi.runAllTimersAsync();
    await run;

    expect(act).toHaveBeenCalledTimes(1);
  });
});

