import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { claimIfPending } from '../missionRunner';
import { TaskStore, type CapcutTask } from '../taskApi';
import { DomReadTimeoutError } from '../cancellation';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import type { AccountUiInteraction } from '../types';

vi.mock('../human', async (original) => ({
  ...await original<typeof import('../human')>(),
  humanClick: async (_page: unknown, button: { click(): Promise<void> }) => button.click()
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const task: CapcutTask = { taskKey: 'pwa', taskId: 1, title: 'Install CapCut Web Desktop', status: 2, reward: 70, buttonText: 'Claim', childIds: [] };
const snapshot = (status: number) => JSON.stringify({ data: { task_list: [{ task_key: 'pwa', task_id: 1, task_status: status, task_view: { title: task.title, button_text: status === 4 ? 'Done' : 'Claim' }, task_reward_view: { reward_amount: 70 } }] } });
function claimFixture(onClick: () => void) {
  const click = vi.fn(async () => { onClick(); });
  const press = vi.fn(async () => {});
  const button = { click, innerText: async () => 'Claim', first() { return this; } };
  const row = { filter() { return this; }, first() { return this; }, count: async () => 1, locator: () => button };
  const page = { evaluate: async () => 1, isClosed: () => false, keyboard: { press }, waitForTimeout: async () => {}, locator: () => row, bringToFront: async () => {} } as unknown as Page;
  return { page, click, press };
}

function fixture(onClick: () => void): Page {
  return claimFixture(onClick).page;
}

it('waits past intermediate status 2 until the claim is confirmed as 4', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const page = fixture(() => {
    setTimeout(() => store.pushTaskList(snapshot(2)), 100);
    setTimeout(() => store.pushTaskList(snapshot(4)), 1500);
  });
  const signal = new AbortController().signal;
  const result = claimIfPending(page, task, store, () => {}, signal, createDirectUiInteraction(signal));
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ claimed: true });
});

it('does not accept a grant for another task without status 4 for this task', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const page = fixture(() => {
    store.pushGrant({ at: Date.now(), errNo: 0, errTips: '' });
    setTimeout(() => store.pushTaskList(snapshot(2)), 1);
  });
  const signal = new AbortController().signal;
  const result = claimIfPending(page, task, store, () => {}, signal, createDirectUiInteraction(signal));
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ claimed: false });
});

it('records the Claim settlement watermark and rejects an otherwise complete older receipt', async () => {
  let now = 100;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const store = new TaskStore();
  let releaseClick!: () => void;
  const clicked = new Promise<void>((resolve) => { releaseClick = resolve; });
  const page = fixture(() => {
    store.pushTaskList(snapshot(4), 199);
    releaseClick();
  });
  const signal = new AbortController().signal;
  const ui: AccountUiInteraction = {
    foreground: vi.fn(async (label, operation) => {
      if (label === 'popover:claim') now = 200;
      return operation();
    }),
    editor: vi.fn(async (_label, operation) => operation())
  };

  const result = claimIfPending(page, task, store, () => {}, signal, ui);
  await clicked;
  const beforeFreshReceipt = vi.fn();
  void result.then(beforeFreshReceipt);
  await Promise.resolve();
  expect(beforeFreshReceipt).not.toHaveBeenCalled();

  store.pushTaskList(snapshot(4), 201);
  expect(await result).toEqual({ claimed: true, actionSettledAt: 200 });
});

it('reports no settlement watermark when Claim performs no mutation', async () => {
  const store = new TaskStore();
  const signal = new AbortController().signal;

  await expect(claimIfPending(
    fixture(() => {}),
    { ...task, status: 1 },
    store,
    () => {},
    signal,
    createDirectUiInteraction(signal)
  )).resolves.toEqual({ claimed: false, actionSettledAt: null });
});

it('retains Claim settlement when popover cleanup times out', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(200);
  const settled: number[] = [];
  const failure = new DomReadTimeoutError('popover:escape');
  const ui: AccountUiInteraction = {
    foreground: async (label, operation) => {
      if (label === 'popover:escape') throw failure;
      return operation();
    },
    editor: async (_label, operation) => operation()
  };
  const h = claimFixture(() => {});
  await expect(claimIfPending(h.page, task, new TaskStore(), () => {},
    new AbortController().signal, ui, (at: number) => settled.push(at))).rejects.toBe(failure);
  expect(h.click).toHaveBeenCalledOnce();
  expect(settled).toEqual([200]);
});

it('reports no settlement watermark when the Claim click is rejected', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const signal = new AbortController().signal;
  const ui: AccountUiInteraction = {
    foreground: vi.fn(async (label, operation) => {
      if (label === 'popover:claim') throw new Error('click rejected');
      return operation();
    }),
    editor: vi.fn(async (_label, operation) => operation())
  };

  const result = claimIfPending(fixture(() => {}), task, store, () => {}, signal, ui);
  await vi.runAllTimersAsync();

  expect(await result).toEqual({ claimed: false, actionSettledAt: null });
});

it('uses the exact supplied facade for the Claim input', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const h = claimFixture(() => {
    setTimeout(() => store.pushTaskList(snapshot(4)), 1);
  });
  const labels: string[] = [];
  const ui: AccountUiInteraction = {
    foreground: vi.fn(async (label, operation) => {
      labels.push(label);
      return operation();
    }),
    editor: vi.fn(async (_label, operation) => operation())
  };
  const signal = new AbortController().signal;

  const result = claimIfPending(h.page, task, store, () => {}, signal, ui);
  await vi.runAllTimersAsync();

  expect(await result).toMatchObject({ claimed: true });
  expect(labels).toContain('popover:claim');
  expect(ui.foreground).toHaveBeenCalled();
  expect(h.click).toHaveBeenCalledOnce();
});

it('propagates a timed-out Claim and never issues popover cleanup input', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const h = claimFixture(() => {});
  const failure = new DomReadTimeoutError('popover:claim');
  const ui: AccountUiInteraction = {
    foreground: vi.fn(async (label, operation) => {
      if (label === 'popover:claim') throw failure;
      return operation();
    }),
    editor: vi.fn(async (_label, operation) => operation())
  };
  const signal = new AbortController().signal;

  const result = claimIfPending(h.page, task, store, () => {}, signal, ui).catch((error) => error);
  await vi.runAllTimersAsync();

  expect(await result).toBe(failure);
  expect(h.click).not.toHaveBeenCalled();
  expect(h.press).not.toHaveBeenCalled();
});
