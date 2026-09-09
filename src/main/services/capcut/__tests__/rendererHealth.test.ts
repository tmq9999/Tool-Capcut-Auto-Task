import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRendererHealth } from '../rendererHealth';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

const makePage = (mouse: () => Promise<void>, evaluate: () => Promise<unknown>) => ({
  goto: async () => null, mouse: { move: mouse }, evaluate, bringToFront: async () => {}
}) as never;

afterEach(() => vi.useRealTimers());

function options(extra: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const signal = extra.signal ?? new AbortController().signal;
  return { ...extra, signal, ui: createDirectUiInteraction(signal) };
}

describe('renderer health probe', () => {
  it('accepts responsive CDP renderer', async () => {
    const result = await checkRendererHealth(makePage(async () => {}, async () => ({ width: 1280, height: 720, devicePixelRatio: 1 })), options());
    expect(result.viewport.width).toBe(1280);
  });
  it('fails a hung mouse probe within timeout', async () => {
    vi.useFakeTimers();
    const result = checkRendererHealth(makePage(() => new Promise(() => {}), async () => ({ width: 1280, height: 720, devicePixelRatio: 1 })), options({ timeoutMs: 1000 })).catch(e => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'DOM_READ_TIMEOUT' });
    vi.useRealTimers();
  });
  it('aborts immediately', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Stop'));
    await expect(checkRendererHealth(makePage(async () => {}, async () => ({ width: 1280, height: 720, devicePixelRatio: 1 })), options({ signal: controller.signal }))).rejects.toThrow('Stop');
  });
  it.each([NaN, Infinity, 0, -1])('rejects invalid viewport width %s', async width => {
    await expect(checkRendererHealth(makePage(async () => {}, async () => ({ width, height: 720, devicePixelRatio: 1 })), options())).rejects.toThrow();
  });
  it('does not allow a late health promise to mutate ownership or telemetry', async () => {
    vi.useFakeTimers();
    let resolveMouse: () => void = () => {};
    const mousePromise = new Promise<void>((resolve) => { resolveMouse = resolve; });
    const probe = checkRendererHealth(
      makePage(() => mousePromise, async () => ({ width: 1280, height: 720, devicePixelRatio: 1 })),
      options({ timeoutMs: 1000 })
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1000);
    const err = await probe;
    expect(err).toMatchObject({ code: 'DOM_READ_TIMEOUT' });

    // Late resolution after settled timeout
    resolveMouse();
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
  });
});
