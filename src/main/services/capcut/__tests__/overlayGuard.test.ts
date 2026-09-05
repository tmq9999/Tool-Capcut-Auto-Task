import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { ensurePageUsable } from '../overlays';

vi.mock('../diag', async (original) => ({ ...await original<typeof import('../diag')>(), dump: async () => 'blocked-modal-capture' }));
it('throws at the guard when an unknown modal remains instead of allowing the next UI step', async () => {
  const node = (selector: string) => ({
    count: async () => selector.includes('lv-modal-mask') ? 1 : 0,
    isVisible: async () => false,
    innerText: async () => 'Unknown blocking modal',
    first() { return this; }, filter() { return this; }
  });
  const page = { locator: node } as unknown as Page;
  const action = vi.fn();
  const operation = ensurePageUsable(page, () => {}).then(action);
  await expect(operation).rejects.toMatchObject({ name: 'StepError', dumpName: 'blocked-modal-capture' });
  expect(action).not.toHaveBeenCalled();
});
