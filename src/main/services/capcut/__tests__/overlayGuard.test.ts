import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { ensurePageUsable, skipOnboardingSurvey } from '../overlays';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

vi.mock('../diag', async (original) => ({ ...await original<typeof import('../diag')>(), dump: async () => 'blocked-modal-capture' }));
it('throws at the guard when an unknown modal remains instead of allowing the next UI step', async () => {
  const node = (selector: string) => ({
    count: async () => selector.includes('lv-modal-mask') ? 1 : 0,
    isVisible: async () => false,
    innerText: async () => 'Unknown blocking modal',
    first() { return this; }, filter() { return this; }
  });
  const page = { locator: node } as unknown as Page;
  const signal = new AbortController().signal;
  const action = vi.fn();
  const operation = ensurePageUsable(page, () => {}, createDirectUiInteraction(signal), signal).then(action);
  await expect(operation).rejects.toMatchObject({ name: 'StepError', dumpName: 'blocked-modal-capture' });
  expect(action).not.toHaveBeenCalled();
});

it('does not count or repeat a rejected onboarding Skip click', async () => {
  const click = vi.fn().mockRejectedValue(new Error('Element is outside of the viewport'));
  const blockingMask = {
    count: async () => 1,
    first() { return this; },
    waitFor: async () => undefined
  };
  const skip = {
    first() { return this; },
    isVisible: async () => true,
    click
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: (selector: string) => selector.includes('lv-modal-mask') ? blockingMask : skip
  } as unknown as Page;
  const messages: string[] = [];
  const signal = new AbortController().signal;

  await expect(skipOnboardingSurvey(
    page,
    (message) => messages.push(message),
    createDirectUiInteraction(signal),
    signal
  )).resolves.toBe(false);

  expect(click).toHaveBeenCalledTimes(1);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('sau 0 lần Skip');
});
