import { afterEach, expect, it, vi } from 'vitest';
import type { Locator, Page, BrowserContext } from 'playwright-core';
import { designStudioGroup } from '../missions/designStudio';
import { DomReadTimeoutError } from '../cancellation';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

// Overlay and geometry guards have their own tests. Keep the interaction chain real.
vi.mock('../overlays', () => ({ ensurePageUsable: async () => true, closeBlockingPricingModal: async () => false }));
vi.mock('../diag', async original => ({
  ...await original<typeof import('../diag')>(),
  assertHittable: async () => {}, assertNotInert: async () => {}, waitNotInert: async () => {}
}));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('opens an already attached canvas prompt without reselecting the editor area', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const areaBox = vi.fn(() => new Promise<never>(() => {}));
  const promptBox = vi.fn(async () => ({ x: 1, y: 1, width: 50, height: 50 }));
  const logs: string[] = [];
  const locatorFor = (selector: string): Locator => {
    const locator = {
      first: () => locator,
      isVisible: async () => false,
      waitFor: async () => {},
      click: async () => {},
      focus: async () => {},
      press: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: selector === '#graphic-editor-render' ? areaBox
        : /Describe your design ideas|\.tiptap\.ProseMirror/.test(selector) ? promptBox
        : async () => ({ x: 1, y: 1, width: 50, height: 50 }),
      innerText: async () => 'change background color to soft blue',
      evaluate: async () => /Describe your design ideas|\.tiptap\.ProseMirror/.test(selector)
    } as unknown as Locator;
    return locator;
  };
  const page = {
    goto: async () => null, bringToFront: async () => {}, waitForTimeout: async () => {},
    evaluate: async () => true, locator: locatorFor,
    waitForEvent: async () => ({ setFiles: async () => {} }),
    mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    keyboard: { type: async () => {} }
  } as unknown as Page;
  const signal = new AbortController().signal;
  const run = designStudioGroup.act({
    page, context: {} as BrowserContext, sampleImage: 'sample.png', signal,
    log: message => logs.push(message), ui: createDirectUiInteraction(signal)
  }, new Set(['capcut_web_design_studio_canvas_edit']));
  const outcome = run.then(() => 'complete', error => error);
  await vi.runAllTimersAsync();
  expect(await outcome).toBe('complete');
  expect(areaBox).not.toHaveBeenCalled();
  expect(promptBox).not.toHaveBeenCalled();
  expect(logs.some(message => message.includes('Canvas đã nhận prompt'))).toBe(true);
});

it.each([
  ['area', 'canvas-area:locator-click'],
  ['opener', 'canvas-opener:tab'],
  ['readback', 'canvas-prompt-readback'],
  ['send', 'canvas-send:locator-click'],
  ['ack', 'canvas-send-ack']
])('stops the actual design flow when %s stops responding', async (phase, expectedStage) => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  const logs: string[] = [];
  const pending = () => new Promise<never>(() => {});
  const locatorFor = (selector: string): Locator => {
    const isArea = selector === '#graphic-editor-render';
    const isOpener = selector.includes('Open canvas prompt');
    const isSend = selector.includes('Send message');
    const isAck = selector.includes('Stop generating');
    const locator = {
      first: () => locator, isVisible: async () => false,
      waitFor: () => phase === 'ack' && isAck ? pending() : Promise.resolve(),
      focus: async () => {},
      press: async () => {
        if (phase === 'opener' && isOpener) throw Object.assign(new Error('key timeout'), { name: 'TimeoutError' });
      },
      scrollIntoViewIfNeeded: async () => {},
      click: () => (phase === 'area' && isArea) || (phase === 'send' && isSend)
        ? pending() : Promise.resolve(),
      boundingBox: async () => ({ x: 1, y: 1, width: 50, height: 50 }),
      innerText: () => phase === 'readback' ? pending() : Promise.resolve('change background color to soft blue'),
      evaluate: async () => false
    } as unknown as Locator;
    return locator;
  };
  const page = {
    goto: async () => null, bringToFront: async () => {}, waitForTimeout: async () => {},
    evaluate: async (_fn: unknown, selector?: string) => selector === '[aria-label="Canvas prompt panel"]' ? false : true, locator: locatorFor,
    waitForEvent: async () => ({ setFiles: async () => {} }),
    mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    keyboard: { type: async () => {} }
  } as unknown as Page;
  const signal = new AbortController().signal;
  const run = designStudioGroup.act({
    page, context: {} as BrowserContext, sampleImage: 'sample.png',
    signal, log: m => logs.push(m),
    ui: createDirectUiInteraction(signal)
  }, new Set(['capcut_web_design_studio_canvas_edit'])).catch(e => e);
  await vi.runAllTimersAsync();
  expect(await run).toBeInstanceOf(DomReadTimeoutError);
  expect((await run).message).toContain(expectedStage);
  expect(logs.some(m => m.includes('Canvas đã nhận prompt'))).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
