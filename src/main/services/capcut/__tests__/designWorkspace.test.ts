import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { designStudioGroup } from '../missions/designStudio';
import type { CapcutMissionEnv } from '../types';

import { createDirectUiInteraction } from '../uiInteractionScheduler';

vi.mock('../overlays', () => ({ ensurePageUsable: async () => true }));
vi.mock('../diag', async (original) => ({
  ...await original<typeof import('../diag')>(),
  mustSee: async (_page: unknown, locator: unknown) => locator
}));
vi.mock('../human', () => ({
  humanClick: async () => {},
  rand: () => 0,
  foregroundPage: async (_page: unknown, _opts: unknown, op: () => Promise<unknown>) => op()
}));
vi.mock('../steps', () => ({
  stepChatWithAgent: async (_page: Page, env: CapcutMissionEnv) => env.log('chat-accepted'),
  stepInspirationTemplate: async () => null
}));

it.each([true, false])('opens one design workspace for upload (chat=%s)', async (chat) => {
  const events: string[] = [];
  const page = {
    bringToFront: async () => {},
    goto: async (url: string) => { events.push(url); },
    waitForTimeout: async () => {}, locator: () => ({}),
    waitForEvent: async () => ({ setFiles: async () => { events.push('upload'); } })
  } as unknown as Page;
  const signal = new AbortController().signal;
  const env = { page, context: {}, sampleImage: 'sample.png', signal,
    ui: createDirectUiInteraction(signal),
    log: (m: string) => { if (m === 'chat-accepted') events.push(m); }
  } as CapcutMissionEnv;
  const need = new Set(['capcut_web_design_studio_upload_img']);
  if (chat) need.add('capcut_web_design_studio_ai_chat');
  await designStudioGroup.act(env, need);
  expect(events).toEqual(chat
    ? ['https://www.capcut.com/ai-design', 'chat-accepted', 'upload']
    : ['https://www.capcut.com/ai-design', 'upload']);
});
