import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { canvasPromptIsReady } from '../missions/designStudio';
import { DomReadTimeoutError } from '../cancellation';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture(options: {
  panelCount?: number; openerCount?: number; expanded?: boolean; hidden?: boolean;
  offscreen?: boolean; covered?: boolean; inert?: boolean; disabled?: boolean; classDisabled?: boolean; transparentAncestor?: boolean;
} = {}) {
  const parent = { parentElement: null };
  const opener = {
    parentElement: parent,
    closest: () => options.inert ? parent : null,
    getAttribute: (name: string) => name === 'aria-disabled' && options.disabled ? 'true'
      : name === 'class' && options.classDisabled ? 'collapsedContent disabled-Hh2vSs' : null,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ x: 961, y: options.offscreen ? -1346 : 581, width: 149, height: 32 }),
    contains: (element: unknown) => element === opener
  };
  const panel = {
    getAttribute: () => options.expanded ? 'true' : 'false',
    querySelectorAll: () => Array(options.openerCount ?? 1).fill(opener)
  };
  vi.stubGlobal('document', {
    querySelectorAll: () => Array(options.panelCount ?? 1).fill(panel),
    elementFromPoint: () => options.covered ? parent : opener
  });
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('getComputedStyle', (element: unknown) => ({
    display: 'block', visibility: options.hidden ? 'hidden' : 'visible',
    opacity: options.transparentAncestor && element === parent ? '0' : '1'
  }));
  return { evaluate: async (read: (selector: string) => boolean, selector: string) => read(selector) } as unknown as Page;
}

describe('selected canvas prompt readiness', () => {
  it('recognizes the selected on-screen collapsed opener', async () => {
    expect(await canvasPromptIsReady(fixture(), new AbortController().signal)).toBe(true);
  });

  it.each([
    { panelCount: 0 }, { panelCount: 2 }, { openerCount: 0 }, { openerCount: 2 },
    { expanded: true }, { hidden: true }, { offscreen: true }, { covered: true },
    { inert: true }, { disabled: true }, { classDisabled: true }, { transparentAncestor: true }
  ])('does not skip selection for unusable prompt %j', async (options) => {
    expect(await canvasPromptIsReady(fixture(options), new AbortController().signal)).toBe(false);
  });

  it('does not turn an unresponsive readiness read into permission to send input', async () => {
    vi.useFakeTimers();
    const page = { evaluate: vi.fn(() => new Promise(() => {})) } as unknown as Page;
    const result = canvasPromptIsReady(page, new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBeInstanceOf(DomReadTimeoutError);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});
