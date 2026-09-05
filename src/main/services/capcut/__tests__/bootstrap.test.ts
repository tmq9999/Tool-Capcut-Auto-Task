import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import type { TaskStore } from '../taskApi';
import { runAllTasks } from '../runTasks';
import { withTaskPopover } from '../missionRunner';

const observation = vi.hoisted(() => ({ store: null as TaskStore | null }));
vi.mock('../diag', async (original) => ({
  ...await original<typeof import('../diag')>(), attachNetDiag: () => {}, dump: async () => 'bootstrap-evidence'
}));
vi.mock('../taskApi', async (original) => ({
  ...await original<typeof import('../taskApi')>(),
  attachTaskMonitor: (_context: unknown, store: TaskStore) => { observation.store = store; }
}));
vi.mock('../missionRunner', async (original) => ({
  ...await original<typeof import('../missionRunner')>(),
  withTaskPopover: vi.fn()
}));
afterEach(() => vi.useRealTimers());
const done = fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8');
const env = (page: Page) => ({
  page, context: {} as never, sampleImage: 'sample.png', signal: new AbortController().signal,
  log: () => {}, groups: [], maxRounds: 1
});

it('actively opens tasks before the bootstrap budget expires when navigation emitted no task_list', async () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  const activationAt: number[] = [];
  const page = { goto: vi.fn(async () => {}), reload: vi.fn(async () => {}) } as unknown as Page;
  vi.mocked(withTaskPopover).mockImplementation(async (_page, fn, _log, options) => {
    activationAt.push(Date.now() - startedAt);
    if (Date.now() >= options!.deadlineAt!) throw new Error('deadline expired before activation');
    observation.store!.pushTaskList(done);
    return fn();
  });
  const result = runAllTasks(env(page)).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ snapshot: { done: 12, total: 12 } });
  expect(activationAt[0]).toBeLessThan(5000);
  expect(page.goto).toHaveBeenCalledTimes(1);
  expect(page.reload).not.toHaveBeenCalled();
});

it('does not issue navigation or reload after the shared bootstrap deadline expires', async () => {
  vi.useFakeTimers();
  const page = {
    goto: vi.fn(async () => {}), reload: vi.fn(async () => {})
  } as unknown as Page;
  vi.mocked(withTaskPopover).mockImplementation(async (_page, _fn, _log, options) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, options!.deadlineAt! - Date.now())));
    throw new Error('popover deadline');
  });
  const start = Date.now();
  const result = runAllTasks(env(page)).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await result).toBeInstanceOf(Error);
  expect(Date.now() - start).toBeLessThanOrEqual(30_000);
  expect(page.goto).toHaveBeenCalledTimes(1);
  expect(page.reload).not.toHaveBeenCalled();
});
