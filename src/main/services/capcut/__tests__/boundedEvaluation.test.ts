import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { waitCanvasReady } from '../missions/designStudio';
import { assertHittable, assertNotInert, waitNotInert } from '../diag';
import { withinDeadline } from '../cancellation';

afterEach(() => vi.useRealTimers());

describe('bounded browser evaluation', () => {
  it('rejects a hung DOM evaluation within its local deadline', async () => {
    vi.useFakeTimers();
    const pending = new Promise<boolean>(() => {});
    const result = withinDeadline(pending, 1000);
    const assertion = expect(result).rejects.toThrow('Operation deadline exceeded');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it('fails a stuck canvas read without queueing another evaluation or dump', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn(() => new Promise(() => {}));
    const screenshot = vi.fn(() => new Promise(() => {}));
    const page = { evaluate, screenshot } as unknown as Page;
    const result = waitCanvasReady(page).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await Promise.race([result, Promise.resolve('still pending')])).toContain('DOM_READ_TIMEOUT');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('propagates Stop during an outstanding canvas evaluation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const evaluate = vi.fn(() => new Promise(() => {}));
    const result = waitCanvasReady({ evaluate } as unknown as Page, 40000, controller.signal).catch(e => e);
    const reason = new Error('User stop');
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([result, Promise.resolve('still pending')])).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch a canvas read after Stop', async () => {
    const controller = new AbortController();
    controller.abort(new Error('User stop'));
    const evaluate = vi.fn(async () => true);
    await expect(waitCanvasReady({ evaluate } as unknown as Page, 40000, controller.signal)).rejects.toThrow('User stop');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('retries responsive not-ready canvas without leaking abort listeners', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const evaluate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = waitCanvasReady({ evaluate } as unknown as Page, 40000, controller.signal);
    await vi.runAllTimersAsync();
    await result;
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an inert probe when the renderer never responds', async () => {
    vi.useFakeTimers();
    const page = { evaluate: () => new Promise(() => {}) } as unknown as Page;
    const result = waitNotInert(page, '#panel', 15000).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await Promise.race([result, Promise.resolve('still pending')])).toContain('DOM_READ_TIMEOUT');
  });

  it('bounds the hit-test instead of hanging before a click', async () => {
    vi.useFakeTimers();
    const locator = { first: () => locator, evaluate: () => new Promise(() => {}) } as unknown as Locator;
    const result = assertHittable({} as Page, locator, 'canvas send').catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await Promise.race([result, Promise.resolve('still pending')])).toContain('DOM_READ_TIMEOUT');
  });

  it('bounds the inert guard before typing into an editor', async () => {
    vi.useFakeTimers();
    const locator = { first: () => locator, evaluate: () => new Promise(() => {}) } as unknown as Locator;
    const result = assertNotInert(locator, 'canvas editor').catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await Promise.race([result, Promise.resolve('still pending')])).toContain('DOM_READ_TIMEOUT');
  });
});
