import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

import type { CapcutMissionEnv, MissionGroup } from '../types';

vi.mock('../diag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diag')>();
  return { ...actual, attachNetDiag: vi.fn() };
});

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
  INTER_ROUND_WAIT_MS
} = await import('../runTasks');

afterEach(() => {
  vi.useRealTimers();
});

describe('runTasks orchestration with proof memory', () => {
  it('keeps the approved inter-round and final snapshot caps', () => {
    expect(INTER_ROUND_WAIT_MS).toBe(8_000);
    expect(FINAL_SNAPSHOT_WAIT_MS).toBe(10_000);
  });

  it('runs a proof-backed PWA action once even when later snapshots stay stale', async () => {
    vi.useFakeTimers();
    const pwaAct = vi.fn(async (_env: CapcutMissionEnv, _need: Set<string>) => {});
    const group: MissionGroup = {
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
        name: 'PWA',
        keys: ['capcut_web_pwa_install'],
        proofTimeoutMs: 12_000,
        act: pwaAct
      },
      {
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
});
