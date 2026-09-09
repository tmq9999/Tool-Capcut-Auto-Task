import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { hideChatPanel } from '../missions/designStudio';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import type { CapcutMissionEnv } from '../types';

function harness(open = true) {
  let expanded = open;
  const log = vi.fn();
  const click = vi.fn(async () => { expanded = false; });
  const panel = { first: () => panel, isVisible: async () => expanded,
    locator: () => ({ first: () => ({ click }) }) };
  const page = {
    locator: () => panel,
    bringToFront: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => { if (expanded) throw new Error('panel still open'); })
  } as unknown as Page;
  const signal = new AbortController().signal;
  return { page, log, click, reopen: () => { expanded = true; },
    env: { page, log, signal, ui: createDirectUiInteraction(signal) } as unknown as CapcutMissionEnv };
}

describe('canvas chat obstruction', () => {
  it('only reports hidden after observing the panel close', async () => {
    const h = harness();
    await hideChatPanel(h.page, h.env);
    expect(h.click).toHaveBeenCalledTimes(1);
    expect(h.page.waitForFunction).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('Đã ẩn'));
  });

  it('does not swallow a rejected hide click or report success', async () => {
    const h = harness();
    h.click.mockRejectedValue(new Error('click timed out'));
    await expect(hideChatPanel(h.page, h.env)).rejects.toThrow('click timed out');
    expect(h.log).not.toHaveBeenCalled();
  });

  it('closes a panel that reopens while the canvas prompt is being filled', async () => {
    const h = harness();
    await hideChatPanel(h.page, h.env);
    h.reopen();
    await hideChatPanel(h.page, h.env);
    expect(h.click).toHaveBeenCalledTimes(2);
  });

  it('does not toggle a panel that is already closed', async () => {
    const h = harness(false);
    await hideChatPanel(h.page, h.env);
    expect(h.click).not.toHaveBeenCalled();
  });
});
