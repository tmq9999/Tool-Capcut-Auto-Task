import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { closeTaskPopover, runGroup, withTaskPopover } from '../missionRunner';
import { TaskStore } from '../taskApi';
import { ensurePageUsable } from '../overlays';

vi.mock('../overlays', () => ({ ensurePageUsable: vi.fn(async () => true) }));
vi.mock('../diag', async (original) => ({
  ...await original<typeof import('../diag')>(), dump: vi.fn(async () => 'captured-test')
}));
afterEach(() => vi.useRealTimers());

function pinnedPopover() {
  return {
    evaluate: vi.fn(async () => 10),
    keyboard: { press: vi.fn(async () => {}) },
    mouse: { click: vi.fn(async () => {}) },
    waitForTimeout: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    isClosed: () => false
  };
}

it('does not reload away the PWA deferred prompt after Go', async () => {
  const page = pinnedPopover();
  const result = await withTaskPopover(page as unknown as Page, async () => 'clicked', () => {});
  expect(result).toBe('clicked');
  expect(page.reload).not.toHaveBeenCalled();
});

it('does not click background Inspiration cards when Escape leaves the popover pinned', async () => {
  const page = pinnedPopover();
  const closed = await closeTaskPopover(page as unknown as Page, false);
  expect(closed).toBe(false);
  expect(page.mouse.click).not.toHaveBeenCalled();
  expect(page.reload).not.toHaveBeenCalled();
});

it('blocks mission actions when the overlay guard reports unusable', async () => {
  vi.mocked(ensurePageUsable).mockResolvedValueOnce(false);
  const act = vi.fn(async () => {});
  const page = pinnedPopover();
  page.evaluate.mockResolvedValue(0);
  const run = runGroup({ name: 'covered', keys: ['pwa'], proofTimeoutMs: 1, act }, {
    page: page as unknown as Page, context: {} as never, signal: new AbortController().signal,
    log: () => {}, sampleImage: 'sample.png'
  }, new TaskStore(), new Set(['pwa']));
  await expect(run).rejects.toThrow(/modal|phủ|overlay/i);
  expect(act).not.toHaveBeenCalled();
});

describe('popover activation budget', () => {
  it('uses one deadline for all candidates and never executes the row action after expiry', async () => {
    vi.useFakeTimers();
    const candidate = {
      count: async () => 1,
      boundingBox: async () => ({ x: 0, y: 0, width: 40, height: 40 }),
      evaluate: async () => 'candidate', click: async () => {}, first() { return this; }
    };
    const page = {
      locator: () => candidate, evaluate: async () => 0,
      bringToFront: async () => {}, url: () => 'https://www.capcut.com/my-edit?enter_source=web_task_earn_credit',
      isClosed: () => false, waitForTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    } as unknown as Page;
    const act = vi.fn(async () => {});
    const operation = withTaskPopover(page, act, () => {}, { deadlineAt: Date.now() + 1000, signal: new AbortController().signal });
    let settled = false;
    const outcome = operation.catch((error: unknown) => error).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(1100);
    const onTime = settled;
    await vi.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(Error);
    expect(onTime).toBe(true);
    expect(act).not.toHaveBeenCalled();
  });
});
