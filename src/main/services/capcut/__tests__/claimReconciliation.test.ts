import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { claimIfPending } from '../missionRunner';
import { TaskStore, type CapcutTask } from '../taskApi';

vi.mock('../human', async (original) => ({
  ...await original<typeof import('../human')>(),
  humanClick: async (_page: unknown, button: { click(): Promise<void> }) => button.click()
}));
afterEach(() => vi.useRealTimers());
const task: CapcutTask = { taskKey: 'pwa', taskId: 1, title: 'Install CapCut Web Desktop', status: 2, reward: 70, buttonText: 'Claim', childIds: [] };
const snapshot = (status: number) => JSON.stringify({ data: { task_list: [{ task_key: 'pwa', task_id: 1, task_status: status, task_view: { title: task.title, button_text: status === 4 ? 'Done' : 'Claim' }, task_reward_view: { reward_amount: 70 } }] } });
function fixture(onClick: () => void) {
  const button = { click: async () => { onClick(); }, innerText: async () => 'Claim', first() { return this; } };
  const row = { filter() { return this; }, first() { return this; }, count: async () => 1, locator: () => button };
  return { evaluate: async () => 1, isClosed: () => false, keyboard: { press: async () => {} }, waitForTimeout: async () => {}, locator: () => row } as unknown as Page;
}

it('waits past intermediate status 2 until the claim is confirmed as 4', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const page = fixture(() => {
    setTimeout(() => store.pushTaskList(snapshot(2)), 100);
    setTimeout(() => store.pushTaskList(snapshot(4)), 1500);
  });
  const result = claimIfPending(page, task, store, () => {}, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect(await result).toBe(true);
});

it('does not accept a grant for another task without status 4 for this task', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const page = fixture(() => {
    store.pushGrant({ at: Date.now(), errNo: 0, errTips: '' });
    setTimeout(() => store.pushTaskList(snapshot(2)), 1);
  });
  const result = claimIfPending(page, task, store, () => {}, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect(await result).toBe(false);
});
