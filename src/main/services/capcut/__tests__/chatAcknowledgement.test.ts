import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { stepChatWithAgent } from '../steps';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import type { CapcutMissionEnv } from '../types';

// Isolate browser I/O and pacing, but execute the mission's acknowledgement predicate.
vi.mock('../human', () => ({
  humanClick: async () => {}, humanType: async () => {},
  dismissOverlays: async () => {}, clickIfVisible: async () => false,
  pick: (values: string[]) => values[0], rand: () => 0,
  waitEnabled: async () => true,
  foregroundPage: async (_page: unknown, _options: unknown, op: () => Promise<unknown>) => op()
}));
vi.mock('../diag', async (original) => ({
  ...await original<typeof import('../diag')>(),
  mustSee: async (_page: unknown, locator: unknown) => locator,
  dump: async () => null
}));

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['missing panel', false, null, false, false],
  ['unmounted editor', true, null, false, false],
  ['unsent text', true, 'hello', false, false],
  ['cleared editor', true, '', false, true],
  ['generation accepted', true, 'hello', true, true]
] as const)('chat acknowledgement: %s', async (_label, hasPanel, value, busy, expected) => {
  class ElementStub { constructor(public textContent: string) {} }
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('document', {
    querySelector: () => hasPanel ? {
      querySelector: (selector: string) => selector.includes('Stop generating')
        ? (busy ? {} : null)
        : (value === null ? null : new ElementStub(value))
    } : null
  });
  const locator = {
    first: () => locator, last: () => locator, locator: () => locator,
    isVisible: async () => true, scrollIntoViewIfNeeded: async () => {}
  };
  const page = {
    bringToFront: async () => {}, locator: () => locator, waitForTimeout: async () => {},
    waitForFunction: async (predicate: (s: string) => boolean, selector: string) => {
      if (!predicate(selector)) throw new Error('Timeout');
    }
  } as unknown as Page;
  const messages: string[] = [];
  const controller = new AbortController();
  const env = { page, context: {}, sampleImage: 'sample.png',
    signal: controller.signal, log: (m: string) => { messages.push(m); },
    ui: createDirectUiInteraction(controller.signal)
  } as unknown as CapcutMissionEnv;
  const run = stepChatWithAgent(page, env);
  if (expected) await expect(run).resolves.toBeUndefined();
  else {
    await expect(run).rejects.toThrow('6s');
    expect(messages.some((m) => m.startsWith('Đã gửi chat'))).toBe(false);
  }
});
