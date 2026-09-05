import { afterEach, expect, it, vi } from 'vitest';
import { pwaInstallGroup } from '../missions/simple';
import { findTaskRow, withTaskPopover } from '../missionRunner';
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
  const page = { evaluate: vi.fn(async () => {}), waitForTimeout: async () => {} };
  return { button, page, controller, env: { page, context: {}, sampleImage: 'sample.png', signal: controller.signal, log: vi.fn() } as unknown as CapcutMissionEnv };
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
