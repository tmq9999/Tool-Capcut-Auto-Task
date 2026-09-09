import { afterEach, expect, it, vi } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import {
  foregroundPage,
  humanClick,
  humanType,
  isDisabled,
  waitEnabled,
  type HumanInteractionOptions
} from '../human';
import { mustSee } from '../diag';
import { DomReadTimeoutError } from '../cancellation';
import { createDirectUiInteraction, RunUiInteractionScheduler } from '../uiInteractionScheduler';
import { skipOnboardingSurvey } from '../overlays';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function options(stage: string, signal = new AbortController().signal) {
  return { signal, stage, ui: createDirectUiInteraction(signal) };
}

function harness(stuck = '', fail = '') {
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const operation = async (name: string) => {
    calls.push(name);
    if (name === fail) {
      throw Object.assign(new Error('foreign realm timeout'), { code: 'DOM_READ_TIMEOUT' });
    }
    if (name === stuck) await pending;
  };
  const locator = {
    first: () => locator,
    waitFor: () => operation('visible'),
    scrollIntoViewIfNeeded: () => operation('scroll'),
    boundingBox: async () => { await operation('box'); return { x: 10, y: 10, width: 50, height: 50 }; },
    click: vi.fn(() => operation('locator-click')),
    evaluate: async () => { await operation('enabled'); return false; }
  } as unknown as Locator;
  const page = {
    bringToFront: async () => {},
    mouse: {
      move: () => operation('move'), down: () => operation('down'), up: () => operation('up')
    },
    keyboard: { type: () => operation('type') }
  } as unknown as Page;
  return { page, locator, calls, release };
}

it('rejects an omitted facade before any focus or input', async () => {
  const signal = new AbortController().signal;
  const focus = vi.fn(async () => {});
  const input = vi.fn(async () => {});
  const page = { bringToFront: focus } as unknown as Page;
  await expect(Promise.resolve().then(() => foregroundPage(
    page,
    { signal, stage: 'audit:missing-ui' } as HumanInteractionOptions,
    input
  ))).rejects.toThrow('UI_INTERACTION_REQUIRED');
  expect(focus).not.toHaveBeenCalled();
  expect(input).not.toHaveBeenCalled();
});

it('serializes focus and input across explicit session facades', async () => {
  const scheduler = new RunUiInteractionScheduler();
  const signalA = new AbortController().signal;
  const signalB = new AbortController().signal;
  const uiA = scheduler.forSession({ sessionAlias: 'session-a', signal: signalA });
  const uiB = scheduler.forSession({ sessionAlias: 'session-b', signal: signalB });
  let releaseA!: () => void;
  const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
  const focusA = vi.fn(async () => {});
  const inputA = vi.fn(async () => { await holdA; });
  const focusB = vi.fn(async () => {});
  const inputB = vi.fn(async () => {});

  const runA = foregroundPage(
    { bringToFront: focusA } as unknown as Page,
    { signal: signalA, stage: 'session-a:foreground', ui: uiA },
    inputA
  );
  const runB = foregroundPage(
    { bringToFront: focusB } as unknown as Page,
    { signal: signalB, stage: 'session-b:foreground', ui: uiB },
    inputB
  );

  await vi.waitFor(() => expect(inputA).toHaveBeenCalledOnce());
  expect(focusB).not.toHaveBeenCalled();
  expect(inputB).not.toHaveBeenCalled();

  releaseA();
  await Promise.all([runA, runB]);
  expect(focusA).toHaveBeenCalledOnce();
  expect(inputA).toHaveBeenCalledOnce();
  expect(focusB).toHaveBeenCalledOnce();
  expect(inputB).toHaveBeenCalledOnce();
});

it('runs target-mode foreground operations without activating the native window', async () => {
  const signal = new AbortController().signal;
  const ui = createDirectUiInteraction(signal, 'target');
  const focus = vi.fn(async () => { throw new Error('native activation forbidden'); });
  const operation = vi.fn(async () => 'typed-on-target');

  await expect(foregroundPage(
    { bringToFront: focus } as unknown as Page,
    { signal, stage: 'target:foreground', ui },
    operation
  )).resolves.toBe('typed-on-target');

  expect(focus).not.toHaveBeenCalled();
  expect(operation).toHaveBeenCalledOnce();
});

it('uses one bounded locator click with the stop signal and no mouse trajectory', async () => {
  vi.useFakeTimers();
  const signal = new AbortController().signal;
  const forbidden = vi.fn(async () => { throw new Error('CUSTOM_POINTER_USED'); });
  const click = vi.fn(async (_options?: { timeout?: number; delay?: number; signal?: AbortSignal }) => {});
  const locator = { click, boundingBox: forbidden, scrollIntoViewIfNeeded: forbidden } as unknown as Locator;
  const page = {
    bringToFront: vi.fn(async () => {}),
    mouse: { move: forbidden, down: forbidden, up: forbidden }
  } as unknown as Page;

  const run = humanClick(page, locator, options('native-click', signal));
  await vi.runAllTimersAsync();
  await run;

  expect(click).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledWith(expect.objectContaining({ timeout: 8000, signal }));
  expect(click.mock.calls[0][0]?.delay).toBeGreaterThanOrEqual(70);
  expect(click.mock.calls[0][0]?.delay).toBeLessThanOrEqual(150);
  expect(forbidden).not.toHaveBeenCalled();
});

it('keeps concurrent target-mode input on each owning page', async () => {
  const valuesA: string[] = [];
  const valuesB: string[] = [];
  const signal = new AbortController().signal;
  const pageA = {
    bringToFront: vi.fn(async () => { throw new Error('native activation forbidden'); }),
    keyboard: { type: vi.fn(async (value: string) => { valuesA.push(value); }) }
  } as unknown as Page;
  const pageB = {
    bringToFront: vi.fn(async () => { throw new Error('native activation forbidden'); }),
    keyboard: { type: vi.fn(async (value: string) => { valuesB.push(value); }) }
  } as unknown as Page;
  const uiA = new RunUiInteractionScheduler().forSession({ sessionAlias: 'session-a', signal, focusMode: 'target' });
  const uiB = new RunUiInteractionScheduler().forSession({ sessionAlias: 'session-b', signal, focusMode: 'target' });

  await Promise.all([
    foregroundPage(pageA, { signal, stage: 'target-a', ui: uiA }, () => pageA.keyboard.type('literal-a')),
    foregroundPage(pageB, { signal, stage: 'target-b', ui: uiB }, () => pageB.keyboard.type('literal-b'))
  ]);

  expect(valuesA).toEqual(['literal-a']);
  expect(valuesB).toEqual(['literal-b']);
  expect(pageA.bringToFront).not.toHaveBeenCalled();
  expect(pageB.bringToFront).not.toHaveBeenCalled();
});

it('times out focus at 5000 ms, suppresses input, and holds quarantine until profile stop', async () => {
  vi.useFakeTimers();
  const scheduler = new RunUiInteractionScheduler();
  const signalA = new AbortController().signal;
  const signalB = new AbortController().signal;
  const uiA = scheduler.forSession({ sessionAlias: 'session-a', signal: signalA });
  const uiB = scheduler.forSession({ sessionAlias: 'session-b', signal: signalB });
  const focusA = vi.fn(() => new Promise<void>(() => {}));
  const inputA = vi.fn(async () => {});
  const focusB = vi.fn(async () => {});
  const inputB = vi.fn(async () => {});

  const runA = foregroundPage(
    { bringToFront: focusA } as unknown as Page,
    { signal: signalA, stage: 'session-a:focus', ui: uiA },
    inputA
  ).catch((error) => error);
  await vi.advanceTimersByTimeAsync(5_001);

  expect(await Promise.race([runA, Promise.resolve('still pending')])).toBeInstanceOf(DomReadTimeoutError);
  expect(inputA).not.toHaveBeenCalled();
  expect(scheduler.snapshot().quarantinedSessionAliases).toEqual(['session-a']);

  const runB = foregroundPage(
    { bringToFront: focusB } as unknown as Page,
    { signal: signalB, stage: 'session-b:focus', ui: uiB },
    inputB
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(focusB).not.toHaveBeenCalled();
  expect(inputB).not.toHaveBeenCalled();

  scheduler.confirmProfileStopped('session-a');
  await vi.advanceTimersByTimeAsync(0);
  await runB;
  expect(focusB).toHaveBeenCalledOnce();
  expect(inputB).toHaveBeenCalledOnce();
});

it('rejects an overlay helper without an abort signal instead of creating an uncancellable fallback', async () => {
  const locator = vi.fn();
  const page = { locator } as unknown as Page;
  const ui = createDirectUiInteraction(new AbortController().signal);

  await expect(skipOnboardingSurvey(
    page,
    () => {},
    ui,
    undefined as unknown as AbortSignal
  )).rejects.toThrow('ABORT_SIGNAL_REQUIRED');
  expect(locator).not.toHaveBeenCalled();
});

it('stops a hung locator click without continuing after a late response', async () => {
  vi.useFakeTimers();
  const h = harness('locator-click');
  const run = humanClick(h.page, h.locator, options('canvas-select')).catch(e => e);
  await vi.advanceTimersByTimeAsync(20000);
  const error = await Promise.race([run, Promise.resolve('still pending')]);
  expect(error).toBeInstanceOf(DomReadTimeoutError);
  expect(error.message).toContain('canvas-select');
  const atTimeout = [...h.calls];
  h.release();
  await vi.runAllTimersAsync();
  expect(h.calls).toEqual(atTimeout);
});

it('does not issue fallback input or mask a timed-out canvas-area locator click', async () => {
  vi.useFakeTimers();
  const h = harness('locator-click');
  const run = humanClick(h.page, h.locator, options('canvas-area')).catch(error => error);

  await vi.advanceTimersByTimeAsync(9_421);
  const error = await run;

  expect(h.calls).toEqual(['locator-click']);
  expect(error).toBeInstanceOf(DomReadTimeoutError);
  expect(error).toMatchObject({
    code: 'DOM_READ_TIMEOUT',
    message: 'DOM_READ_TIMEOUT: canvas-area:locator-click'
  });

  const callsAtFailure = [...h.calls];
  h.release();
  await vi.runAllTimersAsync();
  expect(h.calls).toEqual(callsAtFailure);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not continue after a code-shaped locator click timeout', async () => {
  vi.useFakeTimers();
  const h = harness('', 'locator-click');
  const run = humanClick(h.page, h.locator, options('canvas-area')).catch(reason => reason);
  await vi.runAllTimersAsync();
  const error = await run;

  expect(error).toMatchObject({ code: 'DOM_READ_TIMEOUT' });
  expect(h.calls).toEqual(['locator-click']);
});

it('does not convert a code-shaped disabled read timeout into enabled state', async () => {
  const timeout = Object.assign(new Error('foreign realm timeout'), { code: 'DOM_READ_TIMEOUT' });
  const locator = { evaluate: vi.fn(async () => { throw timeout; }) } as unknown as Locator;

  await expect(isDisabled(locator, new AbortController().signal)).rejects.toBe(timeout);
});

it('dispatches only one locator click when commands respond', async () => {
  vi.useFakeTimers();
  const h = harness();
  const run = humanClick(h.page, h.locator, options('canvas-select'));
  await vi.runAllTimersAsync(); await run;
  expect(h.calls).toEqual(['locator-click']);
});

it('does not dispatch a click if Stop arrives during the pre-click pause', async () => {
  vi.useFakeTimers();
  const h = harness();
  const controller = new AbortController();
  const run = humanClick(h.page, h.locator, options('canvas-select', controller.signal)).catch(error => error);
  await vi.advanceTimersByTimeAsync(100);
  const reason = new Error('Stop');
  controller.abort(reason);
  await vi.runAllTimersAsync();
  expect(await run).toBe(reason);
  expect(h.calls).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['TimeoutError', 'Error'])('preserves fatal native timeout or ordinary %s without another click', async (name) => {
  vi.useFakeTimers();
  const h = harness();
  const failure = Object.assign(new Error('strict locator or native timeout'), { name });
  vi.mocked(h.locator.click).mockRejectedValue(failure);
  const run = humanClick(h.page, h.locator, options('canvas-send')).catch(error => error);
  await vi.runAllTimersAsync();
  const error = await run;
  if (name === 'TimeoutError') {
    expect(error).toBeInstanceOf(DomReadTimeoutError);
    expect(error.message).toContain('canvas-send:locator-click');
  } else expect(error).toBe(failure);
  expect(h.locator.click).toHaveBeenCalledOnce();
  expect(h.calls).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not send more input when Stop arrives during a locator click', async () => {
  vi.useFakeTimers();
  const h = harness('locator-click');
  const controller = new AbortController();
  const run = humanClick(h.page, h.locator, options('canvas-select', controller.signal)).catch(e => e);
  await vi.advanceTimersByTimeAsync(421);
  expect(h.locator.click).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  const reason = new Error('Stop'); controller.abort(reason);
  await vi.advanceTimersByTimeAsync(0);
  expect(await Promise.race([run, Promise.resolve('still pending')])).toBe(reason);
  h.release(); await vi.runAllTimersAsync();
  expect(h.calls).toEqual(['locator-click']);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not type later characters when a keyboard command times out', async () => {
  vi.useFakeTimers();
  const h = harness('type');
  const run = humanType(h.page, h.locator, 'hello', undefined, options('canvas-type')).catch(e => e);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await Promise.race([run, Promise.resolve('still pending')])).toBeInstanceOf(DomReadTimeoutError);
  h.release(); await vi.runAllTimersAsync();
  expect(h.calls.filter(c => c === 'type')).toHaveLength(1);
});

it('preserves verified editor focus instead of sending another mouse trajectory', async () => {
  vi.useFakeTimers();
  const h = harness('move');
  const typed: string[] = [];
  const editor = {
    isContentEditable: true,
    closest: () => null,
    contains: (node: unknown): boolean => node === editor,
    ownerDocument: {
      activeElement: null as unknown,
      getSelection: (): unknown => ({ rangeCount: 1, isCollapsed: true, anchorNode: editor, focusNode: editor })
    }
  };
  editor.ownerDocument.activeElement = editor;
  Object.assign(h.locator, {
    evaluate: async (read: (element: unknown) => boolean) => read(editor)
  });
  vi.spyOn(h.page.keyboard, 'type').mockImplementation(async (character, input) => {
    expect(editor.ownerDocument.activeElement).toBe(editor);
    expect(input?.delay).toBeGreaterThanOrEqual(45);
    typed.push(character);
  });
  const run = humanType(h.page, h.locator, 'hello', undefined, {
    ...options('canvas-prompt'), preserveFocus: true
  }).catch(error => error);

  await vi.runAllTimersAsync();

  expect(await run).toBeUndefined();
  expect(typed.join('')).toBe('hello');
  expect(h.calls).toEqual([]);
});

it('does not send input or release another worker after a focus read times out', async () => {
  vi.useFakeTimers();
  const h = harness();
  const scheduler = new RunUiInteractionScheduler();
  const signal = new AbortController().signal;
  Object.assign(h.locator, { evaluate: () => new Promise(() => {}) });
  const run = humanType(h.page, h.locator, 'hello', undefined, {
    signal, stage: 'canvas-prompt', preserveFocus: true,
    ui: scheduler.forSession({ sessionAlias: 'session-a', signal })
  }).catch(error => error);
  const nextInput = vi.fn(async () => {});
  const next = scheduler.forSession({ sessionAlias: 'session-b', signal })
    .foreground('next-input', nextInput);

  await vi.advanceTimersByTimeAsync(1100);
  const result = await Promise.race([run, Promise.resolve('still pending')]);
  expect(result).toMatchObject({ code: 'DOM_READ_TIMEOUT' });
  expect(h.calls).toEqual([]);
  expect(nextInput).not.toHaveBeenCalled();

  scheduler.confirmProfileStopped('session-a');
  await vi.runAllTimersAsync();
  await next;
  expect(nextInput).toHaveBeenCalledOnce();
});

it.each(['unfocused', 'inert', 'not-editable', 'no-caret', 'outside-caret', 'selected-content', 'default'])(
  'keeps the original click path for an %s editor', async (state) => {
    vi.useFakeTimers();
    const h = harness();
    const editor = {
      isContentEditable: state !== 'not-editable',
      closest: () => state === 'inert' ? {} : null,
      contains: (node: unknown): boolean => node === editor,
      ownerDocument: {
        activeElement: null as unknown,
        getSelection: (): unknown => ({ rangeCount: state === 'no-caret' ? 0 : 1,
          isCollapsed: state !== 'selected-content',
          anchorNode: editor, focusNode: state === 'outside-caret' ? {} : editor })
      }
    };
    editor.ownerDocument.activeElement = state === 'unfocused' ? {} : editor;
    Object.assign(h.locator, {
      evaluate: async (read: (element: unknown) => boolean) => read(editor)
    });
    const run = humanType(h.page, h.locator, 'hi', undefined, {
      ...options('canvas-prompt'), preserveFocus: state !== 'default'
    });
    await vi.runAllTimersAsync();
    await run;
    expect(h.calls).toEqual(['locator-click', 'type', 'type']);
  }
);

it('keeps focus verification and all characters inside the same foreground lease', async () => {
  vi.useFakeTimers();
  const h = harness();
  const events: string[] = [];
  let releaseTyping!: () => void;
  const pending = new Promise<void>(resolve => { releaseTyping = resolve; });
  Object.assign(h.locator, { evaluate: async () => { events.push('focus-check'); return true; } });
  vi.spyOn(h.page.keyboard, 'type').mockImplementation(async (character) => {
    events.push(character);
    if (character === 'a') await pending;
  });
  const scheduler = new RunUiInteractionScheduler();
  const signal = new AbortController().signal;
  const run = humanType(h.page, h.locator, 'ab', undefined, {
    signal, stage: 'canvas-prompt', preserveFocus: true,
    ui: scheduler.forSession({ sessionAlias: 'session-a', signal })
  });
  const next = scheduler.forSession({ sessionAlias: 'session-b', signal })
    .foreground('next-input', async () => { events.push('next'); });
  await vi.advanceTimersByTimeAsync(500);
  expect(events).toEqual(['focus-check', 'a']);
  releaseTyping();
  await vi.runAllTimersAsync();
  await Promise.all([run, next]);
  expect(events).toEqual(['focus-check', 'a', 'b', 'next']);
});

it('propagates an outer visibility timeout as fatal instead of retrying a hung page', async () => {
  vi.useFakeTimers();
  const h = harness('visible');
  const run = mustSee(h.page, h.locator, 'canvas-area', 500, new AbortController().signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(501);
  expect(await run).toBeInstanceOf(DomReadTimeoutError);
});

it('does not issue a visibility request after Stop', async () => {
  const h = harness(); const controller = new AbortController(); controller.abort(new Error('Stop'));
  await expect(mustSee(h.page, h.locator, 'canvas-area', 500, controller.signal)).rejects.toThrow('Stop');
  expect(h.calls).toEqual([]);
});

it('bounds the enabled read even when the renderer stops responding', async () => {
  vi.useFakeTimers(); const h = harness('enabled');
  const run = waitEnabled(h.locator, 10000, new AbortController().signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await Promise.race([run, Promise.resolve('still pending')])).toBeInstanceOf(DomReadTimeoutError);
  expect(h.calls).toEqual(['enabled']);
});
