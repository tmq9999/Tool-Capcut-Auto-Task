import fs from 'node:fs';

import type { BrowserContext, Page } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskStore } from '../taskApi';
import type { AccountUiInteraction, MissionGroup } from '../types';

let latestTaskStore: TaskStore | null = null;

vi.mock('../diag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diag')>();
  return { ...actual, attachNetDiag: vi.fn() };
});

vi.mock('../overlays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overlays')>();
  return { ...actual, ensurePageUsable: vi.fn(async () => true) };
});

vi.mock('../taskApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../taskApi')>();
  return {
    ...actual,
    attachTaskMonitor: (
      _context: BrowserContext,
      store: InstanceType<typeof actual.TaskStore>
    ) => {
      latestTaskStore = store;
      store.pushTaskList(
        fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'),
        Date.parse('2026-09-08T08:48:49.000Z')
      );
      return () => {};
    }
  };
});

const { runAllTasks } = await import('../runTasks');

const page = {
  goto: vi.fn(async () => null),
  isClosed: vi.fn(() => false)
} as unknown as Page;

const ui: AccountUiInteraction = {
  foreground: async (_label, operation) => operation(),
  editor: async (_label, operation) => operation()
};

const initialAt = Date.parse('2026-09-08T08:48:49.000Z');
const sessionStartedAt = Date.parse('2026-09-08T08:48:48.000Z');
const proofAt = Date.parse('2026-09-08T08:48:49.584Z');
const receiptAt = Date.parse('2026-09-08T08:48:50.263Z');
const cleanupFinishedAt = Date.parse('2026-09-08T08:48:54.423Z');

function group(act: MissionGroup['act'], proofTimeoutMs = 1000): MissionGroup {
  return {
    id: 'design-studio',
    name: 'Live receipt timeline',
    workspace: 'editor',
    keys: ['capcut_web_pwa_install'],
    proofTimeoutMs,
    act
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWith(groups: MissionGroup[], strict = false) {
  const run = runAllTasks({
    page,
    context: {} as BrowserContext,
    sampleImage: 'sample.png',
    log: () => {},
    signal: new AbortController().signal,
    sessionStartedAt,
    maxRounds: 1,
    groups,
    ui,
    ...(strict ? {
      rewardVerification: {
        runId: 'run-receipt-test',
        sessionAlias: 'worker-1-session-1'
      }
    } : {})
  });
  await vi.runAllTimersAsync();
  return run;
}

afterEach(() => {
  latestTaskStore = null;
  vi.useRealTimers();
});

describe('runAllTasks receipt reconciliation through the real runGroup', () => {
  it('keeps strict verification dormant rather than dispatching a coarse grouped attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialAt);
    const act = vi.fn(async () => {});

    const result = await runWith([group(act)], true);

    expect(act).not.toHaveBeenCalled();
    expect(result.snapshot?.final).toBe(false);
    expect(result.outcomes.find((item) => item.key === 'capcut_web_pwa_install')?.error)
      .toBe('REWARD_LEAF_BOUNDARY_REQUIRED');
  });

  it('keeps a post-proof 12/12 receipt valid when group cleanup finishes four seconds later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialAt);

    const result = await runWith([group(async () => {
      await delay(proofAt - initialAt);
      latestTaskStore!.pushAction({
        actionKey: 'capcut_web_pwa_install',
        opId: 'live-account-3',
        errNo: 0,
        errTips: '',
        at: Date.now()
      });
      await delay(receiptAt - proofAt);
      latestTaskStore!.pushTaskList(
        fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'),
        Date.now()
      );
      await delay(cleanupFinishedAt - receiptAt);
    })]);

    expect(result.snapshot).toMatchObject({
      observedAt: receiptAt,
      requiredAfter: proofAt,
      done: 12,
      fresh: true,
      final: true,
      stale: false
    });
  });

  it('rejects a 12/12 snapshot captured before the successful mutation proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialAt);

    const staleReceiptAt = proofAt - 1;
    const result = await runWith([group(async () => {
      await delay(staleReceiptAt - initialAt);
      latestTaskStore!.pushTaskList(
        fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'),
        Date.now()
      );
      await delay(proofAt - staleReceiptAt);
      latestTaskStore!.pushAction({
        actionKey: 'capcut_web_pwa_install',
        opId: 'proof-after-stale-receipt',
        errNo: 0,
        errTips: '',
        at: Date.now()
      });
    })]);

    expect(result.snapshot).toMatchObject({
      observedAt: initialAt,
      requiredAfter: proofAt,
      fresh: false,
      final: false,
      stale: true
    });
  });

  it('does not complete a failed mutation from a fresh 12/12 snapshot alone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialAt);

    const result = await runWith([group(async () => {
      await delay(100);
      latestTaskStore!.pushAction({
        actionKey: 'capcut_web_pwa_install',
        opId: 'failed-action',
        errNo: 1,
        errTips: 'rejected',
        at: Date.now()
      });
      await delay(1);
      latestTaskStore!.pushTaskList(
        fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'),
        Date.now()
      );
    }, 200)]);

    expect(result.snapshot?.final).toBe(false);
    expect(result.outcomes.find((item) => item.key === 'capcut_web_pwa_install')?.attempts).toBe(1);
  });

  it('does not complete an unproven timed-out mutation from a fresh 12/12 snapshot alone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialAt);

    const result = await runWith([group(async () => {
      await delay(100);
      latestTaskStore!.pushTaskList(
        fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'),
        Date.now()
      );
      await delay(1);
    }, 200)]);

    expect(result.snapshot).toMatchObject({ done: 12, fresh: true, final: false });
    expect(result.outcomes.find((item) => item.key === 'capcut_web_pwa_install')).toMatchObject({
      done: true,
      attempts: 1
    });
  });
});
