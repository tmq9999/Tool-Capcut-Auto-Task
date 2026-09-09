import { afterEach, expect, it, vi } from 'vitest';
import { notificationsGroup, pwaInstallGroup } from '../missions/simple';
import { findTaskRow, withTaskPopover } from '../missionRunner';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import type { CapcutMissionEnv } from '../types';

vi.mock('../missionRunner', async (original) => ({
  ...await original<typeof import('../missionRunner')>(),
  findTaskRow: vi.fn(),
  withTaskPopover: vi.fn(async (_page, fn) => fn())
}));
afterEach(() => vi.useRealTimers());
function fixture() {
  const button = { innerText: async () => 'Go', click: vi.fn(async () => {}), first() { return this; } };
  vi.mocked(findTaskRow).mockResolvedValue({ locator: () => button } as never);
  const controller = new AbortController();
  const page = { evaluate: vi.fn(async () => {}), waitForTimeout: async () => {}, bringToFront: vi.fn(async () => {}) };
  return {
    button,
    page,
    controller,
    env: {
      page,
      context: {},
      sampleImage: 'sample.png',
      signal: controller.signal,
      log: vi.fn(),
      ui: createDirectUiInteraction(controller.signal)
    } as unknown as CapcutMissionEnv
  };
}
it('does not dispatch appinstalled after a failed Go click', async () => {
  const { button, page, env } = fixture();
  button.click.mockRejectedValue(new Error('Go is covered'));
  await expect(pwaInstallGroup.act(env, new Set(pwaInstallGroup.keys))).rejects.toThrow('Go is covered');
  expect(page.evaluate).not.toHaveBeenCalled();
});
it('does not act after cancellation between Go and PWA install', async () => {
  const { button, page, env, controller } = fixture();
  button.click.mockImplementation(async () => { controller.abort(new Error('stop')); });
  await expect(pwaInstallGroup.act(env, new Set(pwaInstallGroup.keys))).rejects.toThrow('stop');
  expect(page.evaluate).not.toHaveBeenCalled();
});
it('dispatches PWA install before popover cleanup can run', async () => {
  vi.useFakeTimers();
  const { page, env } = fixture();
  let evaluatedBeforeClose = false;
  vi.mocked(withTaskPopover).mockImplementationOnce(async (_page, fn) => {
    const result = await fn();
    evaluatedBeforeClose = page.evaluate.mock.calls.length > 0;
    return result;
  });
  const action = pwaInstallGroup.act(env, new Set(pwaInstallGroup.keys));
  await vi.runAllTimersAsync();
  await action;
  expect(evaluatedBeforeClose).toBe(true);
});

it('closes the notification tab without queuing focus restoration after a DOM timeout', async () => {
  const timeout = Object.assign(new Error('renderer stopped'), { code: 'DOM_READ_TIMEOUT' });
  const close = vi.fn(async () => {});
  const foreground = vi.fn(async (label: string, operation: () => Promise<unknown>) => {
    if (label === 'notifications:restore-focus') return new Promise<never>(() => {});
    return operation();
  });
  const controller = new AbortController();
  const notificationPage = {
    goto: vi.fn(async () => { throw timeout; }),
    close
  };
  const env = {
    page: { bringToFront: vi.fn(async () => {}) },
    context: {
      grantPermissions: vi.fn(async () => {}),
      newPage: vi.fn(async () => notificationPage)
    },
    sampleImage: 'sample.png',
    signal: controller.signal,
    log: vi.fn(),
    ui: { foreground, editor: vi.fn() }
  } as unknown as CapcutMissionEnv;

  const outcome = notificationsGroup
    .act(env, new Set(notificationsGroup.keys))
    .then(() => undefined, (error: unknown) => error);
  const settled = await Promise.race([
    outcome,
    new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 50))
  ]);

  expect(settled).toBe(timeout);
  expect(close).toHaveBeenCalledOnce();
  expect(foreground).not.toHaveBeenCalledWith(
    'notifications:restore-focus',
    expect.any(Function)
  );
});
