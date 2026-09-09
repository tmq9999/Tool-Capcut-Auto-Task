import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import fs from 'node:fs';
import { claimIfPending, runGroup } from '../missionRunner';
import { DomReadTimeoutError } from '../cancellation';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

import type { CapcutMissionEnv, MissionGroup, TaskCheckpoint } from '../types';
import type { RunTasksInput } from '../runTasks';

vi.mock('../diag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diag')>();
  return { ...actual, attachNetDiag: vi.fn() };
});

import type { TaskStore } from '../taskApi';

let latestTaskStore: TaskStore | null = null;
const taskMonitorDispose = vi.fn();

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
      return taskMonitorDispose;
    }
  };
});

vi.mock('../missionRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../missionRunner')>();
  return {
    ...actual,
    claimIfPending: vi.fn(async () => ({ claimed: false, actionSettledAt: null })),
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

const { runAllTasks: runAllTasksProduction } = await import('../runTasks');
const {
  FINAL_SNAPSHOT_WAIT_MS,
  INTER_ROUND_WAIT_MS,
  needsFinalSnapshotRefresh
} = await import('../runTasks');

type TestRunTasksInput = Omit<RunTasksInput, 'ui'> & Partial<Pick<RunTasksInput, 'ui'>>;

function runAllTasks(input: TestRunTasksInput) {
  return runAllTasksProduction({
    ...input,
    ui: input.ui ?? createDirectUiInteraction(input.signal)
  });
}

afterEach(() => {
  vi.useRealTimers();
  taskMonitorDispose.mockClear();
});

describe('runTasks orchestration with proof memory', () => {
  it('does not dispatch Claim or certify a status-2 task under strict verification', async () => {
    vi.useFakeTimers();
    vi.mocked(claimIfPending).mockClear();
    const act = vi.fn(async () => {});
    const run = runAllTasks({
      page: { goto: async () => null, isClosed: () => false } as unknown as Page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      rewardVerification: {
        runId: 'run-strict-status2',
        sessionAlias: 'worker-1-session-1'
      },
      groups: [{
        id: 'pwa-install', workspace: 'none', name: 'PWA',
        keys: ['capcut_web_pwa_install'], proofTimeoutMs: 12_000, act
      }]
    });
    const statusTwo = JSON.parse(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'));
    const pending = statusTwo.data.task_list.find(
      (item: { task_key: string }) => item.task_key === 'capcut_web_pwa_install'
    );
    pending.task_status = 2;
    pending.task_view.button_text = 'Claim';
    latestTaskStore!.pushTaskList(JSON.stringify(statusTwo), 101);

    await vi.runAllTimersAsync();
    const result = await run;

    expect(claimIfPending).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    expect(result.snapshot?.final).toBe(false);
    expect(result.outcomes.find((item) => item.key === 'capcut_web_pwa_install')?.done).toBe(false);
  });

  it('disposes the task monitor when a task run completes', async () => {
    vi.useFakeTimers();
    const run = runAllTasks({
      page: { goto: async () => null, isClosed: () => false } as unknown as Page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png', log: () => {},
      signal: new AbortController().signal,
      groups: [], maxRounds: 0
    });

    await vi.runAllTimersAsync();
    await run;

    expect(taskMonitorDispose).toHaveBeenCalledOnce();
  });

  it('disposes the task monitor when mission execution rejects', async () => {
    vi.useFakeTimers();
    const failure = new Error('mission failed');
    const run = runAllTasks({
      page: { goto: async () => null, isClosed: () => false } as unknown as Page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png', log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      groups: [{
        id: 'pwa-install', workspace: 'none', name: 'PWA',
        keys: ['capcut_web_pwa_install'], proofTimeoutMs: 1000,
        act: async () => { throw failure; }
      }]
    });

    await expect(run).rejects.toBe(failure);

    expect(taskMonitorDispose).toHaveBeenCalledOnce();
  });

  it('retains incoming omitted-key proof independently in checkpoint and result', async () => {
    vi.useFakeTimers();
    const key = 'omitted-server-key';
    const proof = { actionKey: key, opId: 'same-run-proof', errNo: 0 as const, errTips: '', at: 90 };
    const checkpoints: TaskCheckpoint[] = [];
    const run = runAllTasks({
      page: { goto: async () => null, isClosed: () => false } as unknown as Page,
      context: {} as BrowserContext, sampleImage: 'sample.png', log: () => {},
      signal: new AbortController().signal, groups: [], unsettledProofs: [{ key, proof }],
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); }
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.unsettledProofs).toEqual([{ key, proof }]);
    expect(checkpoints.at(-1)).toMatchObject({ unsettledProofs: [{ key, proof }] });
    expect(result.snapshot?.tasks.some((row) => row.key === key)).toBe(false);
    expect(result.outcomes.some((row) => row.key === key)).toBe(false);
  });

  it('carries omitted proof through another session until its key reappears as status 4', async () => {
    vi.useFakeTimers();
    const key = 'omitted-server-key';
    const proof = { actionKey: key, opId: 'same-run-proof', errNo: 0 as const, errTips: '', at: 90 };
    const act = vi.fn(async () => {});
    const input: TestRunTasksInput = {
      page: { goto: async () => null, isClosed: () => false } as unknown as Page,
      context: {} as BrowserContext, sampleImage: 'sample.png', log: () => {},
      signal: new AbortController().signal,
      groups: [{ id: 'pwa-install', workspace: 'none', name: 'PWA', keys: [key], proofTimeoutMs: 1000, act }],
      unsettledProofs: [{ key, proof }]
    };
    const firstRun = runAllTasks(input);
    await vi.runAllTimersAsync();
    const first = await firstRun;
    const secondRun = runAllTasks({ ...input, unsettledProofs: first.unsettledProofs });
    await vi.advanceTimersByTimeAsync(1);
    const reappeared = JSON.parse(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'));
    reappeared.data.task_list.push({ task_key: key, task_id: 99, task_status: 1,
      task_view: { title: 'Carried task', button_text: 'Go' }, task_reward_view: { reward_amount: 10 } });
    latestTaskStore!.pushTaskList(JSON.stringify(reappeared), 200);
    await vi.advanceTimersByTimeAsync(1);
    expect(act).not.toHaveBeenCalled();
    reappeared.data.task_list.at(-1).task_status = 4;
    latestTaskStore!.pushTaskList(JSON.stringify(reappeared), 300);
    await vi.runAllTimersAsync();
    const second = await secondRun;
    expect(second.unsettledProofs).toEqual([]);
    expect(second.snapshot).toMatchObject({ final: true, total: 13, done: 13 });
    expect(act).not.toHaveBeenCalled();
  });

  it('returns the fatal Claim timeout checkpoint without selecting another mission', async () => {
    vi.useFakeTimers();
    const failure = new DomReadTimeoutError('popover:claim');
    vi.mocked(claimIfPending).mockImplementationOnce(async (_page, _task, _store, _log, _signal, _ui, onSettled) => {
      onSettled?.(200);
      throw failure;
    });
    const next = vi.fn(async () => {});
    const checkpoints: TaskCheckpoint[] = [];
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const signal = new AbortController().signal;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      signal,
      ui: createDirectUiInteraction(signal),
      log: () => {},
      maxRounds: 1,
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
      groups: [{
        id: 'pwa-install',
        workspace: 'none',
        name: 'PWA',
        keys: ['capcut_web_pwa_install'],
        proofTimeoutMs: 12_000,
        act: next
      }]
    });
    const statusTwo = JSON.parse(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'));
    const pending = statusTwo.data.task_list.find((item: { task_key: string }) => item.task_key === 'capcut_web_pwa_install');
    pending.task_status = 2;
    pending.task_view.button_text = 'Claim';
    latestTaskStore!.pushTaskList(JSON.stringify(statusTwo), 101);

    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.fatalError).toBe(failure);
    expect(result.snapshot?.final).toBe(false);
    expect(checkpoints.at(-1)?.snapshot.final).toBe(false);
    expect(checkpoints.at(-1)?.snapshot.requiredAfter).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

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

  it('raises the receipt watermark to the time a Claim mutation settles', async () => {
    vi.useFakeTimers();
    vi.mocked(claimIfPending).mockImplementationOnce(async (_page, _task, store) => {
      store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), 199);
      setTimeout(() => {
        store.pushTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'), 201);
      }, 10);
      return { claimed: true, actionSettledAt: 200 };
    });
    const page = { goto: async () => null, isClosed: () => false } as unknown as Page;
    const run = runAllTasks({
      page,
      context: {} as BrowserContext,
      sampleImage: 'sample.png',
      log: () => {},
      signal: new AbortController().signal,
      maxRounds: 1,
      groups: []
    });
    const statusTwo = JSON.parse(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'));
    const pending = statusTwo.data.task_list.find((item: { task_key: string }) => item.task_key === 'capcut_web_pwa_install');
    pending.task_status = 2;
    pending.task_view.button_text = 'Claim';
    latestTaskStore!.pushTaskList(JSON.stringify(statusTwo), 101);

    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.snapshot).toMatchObject({
      observedAt: 201,
      requiredAfter: 200,
      fresh: true,
      final: true
    });
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
