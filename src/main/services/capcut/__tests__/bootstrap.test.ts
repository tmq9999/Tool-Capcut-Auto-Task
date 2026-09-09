import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import type { TaskStore } from '../taskApi';
import { runAllTasks } from '../runTasks';
import { withTaskPopover } from '../missionRunner';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import { DomReadTimeoutError } from '../cancellation';

const observation = vi.hoisted(() => ({
  store: null as TaskStore | null,
  dispose: vi.fn()
}));
vi.mock('../diag', async (original) => ({
  ...await original<typeof import('../diag')>(), attachNetDiag: () => {}, dump: async () => 'bootstrap-evidence'
}));
vi.mock('../taskApi', async (original) => ({
  ...await original<typeof import('../taskApi')>(),
  attachTaskMonitor: (_context: unknown, store: TaskStore) => {
    observation.store = store;
    return observation.dispose;
  }
}));
vi.mock('../missionRunner', async (original) => ({
  ...await original<typeof import('../missionRunner')>(),
  withTaskPopover: vi.fn()
}));
afterEach(() => {
  vi.useRealTimers();
  observation.dispose.mockClear();
});
const done = fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8');
const env = (page: Page) => {
  const signal = new AbortController().signal;
  return {
    page, context: {} as never, sampleImage: 'sample.png', signal,
    ui: createDirectUiInteraction(signal), log: () => {}, groups: [], maxRounds: 1
  };
};

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
  expect(observation.dispose).toHaveBeenCalledOnce();
});

it('does not issue navigation or reload after the shared bootstrap deadline expires', async () => {
  vi.useFakeTimers();
  const page = {
    goto: vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 30_000)); }),
    reload: vi.fn(async () => {})
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
  expect(observation.dispose).toHaveBeenCalledOnce();
});

it('reserves time for reload when task entry clicks never open the popover', async () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  let reloadedAt = 0;
  const page = {
    goto: vi.fn(async () => {}),
    reload: vi.fn(async () => {
      reloadedAt = Date.now() - startedAt;
      observation.store!.pushTaskList(done);
    })
  } as unknown as Page;
  vi.mocked(withTaskPopover).mockImplementation(async (_page, _fn, _log, options) => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, options.deadlineAt! - Date.now())));
    throw new Error('task entries did not open');
  });

  const result = runAllTasks(env(page)).catch((error: unknown) => error);
  await vi.runAllTimersAsync();

  expect(await result).toMatchObject({ snapshot: { done: 12, total: 12 } });
  expect(page.reload).toHaveBeenCalledOnce();
  expect(reloadedAt).toBeLessThan(30_000);
  expect(Date.now() - startedAt).toBeLessThanOrEqual(30_000);
});

it('also reserves reload time when the popover opens without a task response', async () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  const page = {
    goto: vi.fn(async () => {}),
    reload: vi.fn(async () => { observation.store!.pushTaskList(done); })
  } as unknown as Page;
  vi.mocked(withTaskPopover).mockImplementation(async (_page, fn) => fn());

  const result = runAllTasks(env(page)).catch((error: unknown) => error);
  await vi.runAllTimersAsync();

  expect(await result).toMatchObject({ snapshot: { done: 12, total: 12 } });
  expect(page.reload).toHaveBeenCalledOnce();
  expect(Date.now() - startedAt).toBeLessThanOrEqual(30_000);
});

it.each([
  new DomReadTimeoutError('popover:entry-click:focus'),
  Object.assign(new Error('foreign timeout'), { code: 'DOM_READ_TIMEOUT' })
])('preserves a fatal popover timeout without reloading the session', async (timeout) => {
  vi.useFakeTimers();
  const page = {
    goto: vi.fn(async () => {}), reload: vi.fn(async () => {})
  } as unknown as Page;
  vi.mocked(withTaskPopover).mockRejectedValueOnce(timeout);

  const result = runAllTasks(env(page)).catch((error: unknown) => error);
  await vi.runAllTimersAsync();

  expect(await result).toBe(timeout);
  expect(page.goto).toHaveBeenCalledTimes(1);
  expect(page.reload).not.toHaveBeenCalled();
});
