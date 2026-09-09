import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { openCanvasPrompt } from '../missions/designStudio';
import { DomReadTimeoutError } from '../cancellation';
import { createDirectUiInteraction, RunUiInteractionScheduler } from '../uiInteractionScheduler';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function setup() {
  const signal = new AbortController().signal;
  const page = { bringToFront: vi.fn(async () => {}), mouse: { move: vi.fn(), down: vi.fn(), up: vi.fn() } } as unknown as Page;
  const opener = { focus: vi.fn(async () => {}), press: vi.fn(async () => {}), click: vi.fn() } as unknown as Locator;
  return { page, opener, signal, ui: createDirectUiInteraction(signal) };
}

describe('CapCut canvas prompt keyboard activation', () => {
  it('uses the verified Tab shortcut under one focused lease without a mouse trajectory', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const h = setup(); const events: string[] = [];
    vi.mocked(h.page.bringToFront).mockImplementation(async () => { events.push('front'); });
    vi.mocked(h.opener.focus).mockImplementation(async () => { events.push('focus'); });
    vi.mocked(h.opener.press).mockImplementation(async () => { events.push('Tab'); });
    const run = openCanvasPrompt(h.page, h.opener, { signal: h.signal, ui: h.ui, log: () => {} });
    await vi.runAllTimersAsync(); await run;
    expect(events).toEqual(['front', 'focus', 'Tab']);
    expect(h.opener.press).toHaveBeenCalledExactlyOnceWith('Tab', { delay: 70, timeout: 6000, signal: h.signal });
    expect(h.opener.click).not.toHaveBeenCalled();
    expect(h.page.mouse.move).not.toHaveBeenCalled();
  });

  it('quarantines a native key timeout with no pointer fallback or retry', async () => {
    vi.useFakeTimers(); const h = setup();
    vi.mocked(h.opener.press).mockRejectedValue(Object.assign(new Error('native key timeout'), { name: 'TimeoutError' }));
    const scheduler = new RunUiInteractionScheduler();
    const ui = scheduler.forSession({ sessionAlias: 'worker-1-session-1', signal: h.signal });
    const run = openCanvasPrompt(h.page, h.opener, { signal: h.signal, ui, log: () => {} }).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await run).toBeInstanceOf(DomReadTimeoutError);
    expect(scheduler.snapshot().quarantinedSessionAliases).toEqual(['worker-1-session-1']);
    expect(h.opener.press).toHaveBeenCalledOnce();
    expect(h.opener.click).not.toHaveBeenCalled();
  });

  it('does not press Tab if focusing the opener hangs', async () => {
    vi.useFakeTimers(); const h = setup();
    vi.mocked(h.opener.focus).mockImplementation(() => new Promise(() => {}));
    const run = openCanvasPrompt(h.page, h.opener, { signal: h.signal, ui: h.ui, log: () => {} }).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await run).toBeInstanceOf(DomReadTimeoutError);
    expect(h.opener.press).not.toHaveBeenCalled();
  });

  it('does not dispatch a key when stopped during the pause', async () => {
    vi.useFakeTimers(); const h = setup(); const controller = new AbortController();
    const run = openCanvasPrompt(h.page, h.opener, { signal: controller.signal,
      ui: createDirectUiInteraction(controller.signal), log: () => {} }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); controller.abort(new Error('Stop'));
    await vi.runAllTimersAsync();
    expect((await run).message).toBe('Stop');
    expect(h.opener.press).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not press Tab when stopped immediately after focus completes', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    const stop = new Error('Stop after focus');
    const page = { bringToFront: vi.fn(async () => {}) } as unknown as Page;
    const opener = {
      focus: vi.fn(async () => { controller.abort(stop); }),
      press: vi.fn(async () => {})
    } as unknown as Locator;

    const run = openCanvasPrompt(page, opener, {
      signal: controller.signal,
      ui: createDirectUiInteraction(controller.signal),
      log: () => {}
    }).catch(error => error);
    await vi.runAllTimersAsync();

    expect(await run).toBe(stop);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(opener.press).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps other sessions blocked when stopped with Tab pending until the profile is confirmed stopped', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const scheduler = new RunUiInteractionScheduler();
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const stop = new Error('Stop with key pending');
    const pageA = { bringToFront: vi.fn(async () => {}) } as unknown as Page;
    const pageB = { bringToFront: vi.fn(async () => {}) } as unknown as Page;
    const openerA = {
      focus: vi.fn(async () => {}),
      press: vi.fn(() => new Promise<void>(() => {}))
    } as unknown as Locator;
    const openerB = {
      focus: vi.fn(async () => {}),
      press: vi.fn(async () => {})
    } as unknown as Locator;
    const uiA = scheduler.forSession({ sessionAlias: 'worker-a-session-1', signal: controllerA.signal });
    const uiB = scheduler.forSession({ sessionAlias: 'worker-b-session-1', signal: controllerB.signal });

    const runA = openCanvasPrompt(pageA, openerA, {
      signal: controllerA.signal, ui: uiA, log: () => {}
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(180);
    expect(openerA.press).toHaveBeenCalledOnce();

    const runB = openCanvasPrompt(pageB, openerB, {
      signal: controllerB.signal, ui: uiB, log: () => {}
    });
    controllerA.abort(stop);
    await vi.advanceTimersByTimeAsync(0);

    expect(await runA).toBe(stop);
    expect(scheduler.snapshot().quarantinedSessionAliases).toEqual(['worker-a-session-1']);
    expect(pageB.bringToFront).not.toHaveBeenCalled();
    expect(openerB.focus).not.toHaveBeenCalled();
    expect(openerB.press).not.toHaveBeenCalled();

    scheduler.confirmProfileStopped('worker-a-session-1');
    await vi.runAllTimersAsync();
    await runB;

    expect(pageB.bringToFront).toHaveBeenCalledOnce();
    expect(openerB.focus).toHaveBeenCalledOnce();
    expect(openerB.press).toHaveBeenCalledExactlyOnceWith('Tab', {
      delay: 70, timeout: 6000, signal: controllerB.signal
    });
    expect(scheduler.snapshot().quarantinedSessionAliases).toEqual([]);
  });

  it('maps a native focus timeout to quarantine without dispatching Tab', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    const scheduler = new RunUiInteractionScheduler();
    const page = { bringToFront: vi.fn(async () => {}) } as unknown as Page;
    const nativeTimeout = Object.assign(new Error('native focus timeout'), { name: 'TimeoutError' });
    const opener = {
      focus: vi.fn(async () => { throw nativeTimeout; }),
      press: vi.fn(async () => {})
    } as unknown as Locator;
    const ui = scheduler.forSession({ sessionAlias: 'worker-focus-session-1', signal: controller.signal });

    const run = openCanvasPrompt(page, opener, {
      signal: controller.signal, ui, log: () => {}
    }).catch(error => error);
    await vi.runAllTimersAsync();
    const error = await run;

    expect(error).toBeInstanceOf(DomReadTimeoutError);
    expect(error).toMatchObject({
      code: 'DOM_READ_TIMEOUT',
      message: 'DOM_READ_TIMEOUT: canvas-opener:focus-control'
    });
    expect(scheduler.snapshot().quarantinedSessionAliases).toEqual(['worker-focus-session-1']);
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ timeout: 4000, signal: controller.signal });
    expect(opener.press).not.toHaveBeenCalled();
  });
});
