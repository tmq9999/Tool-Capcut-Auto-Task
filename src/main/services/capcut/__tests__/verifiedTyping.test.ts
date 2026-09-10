import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Locator, Page } from 'playwright-core';

import { loginCapcut } from '../login';
import { signupCapcut } from '../signup';
import { DomReadTimeoutError } from '../cancellation';
import type { AccountUiInteraction } from '../types';

type AuthKind = 'login' | 'signup';

function fixture(kind: AuthKind, clearError?: unknown) {
  const events: string[] = [];
  const afterTyping = new Error('AFTER_TYPING');
  const input = {
    waitFor: vi.fn(async () => {}),
    isVisible: vi.fn(async () => true),
    clear: vi.fn(async () => {
      events.push('clear');
      if (clearError) throw clearError;
    }),
    pressSequentially: vi.fn(async () => { events.push('type'); }),
    inputValue: vi.fn(async () => { events.push('validate'); return 'mail@example.com'; })
  } as unknown as Locator;
  const trigger = {
    waitFor: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    page: () => page
  } as unknown as Locator;
  const marker = {
    first() { return this; },
    isVisible: vi.fn(async () => false)
  } as unknown as Locator;
  const stopButton = {
    first() { return this; },
    waitFor: vi.fn(async () => { throw afterTyping; })
  } as unknown as Locator;
  const page = {
    url: () => `https://www.capcut.com/${kind}`,
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => { events.push('focus'); }),
    getByText: vi.fn(() => trigger),
    getByRole: vi.fn(() => stopButton),
    locator: vi.fn((selector: string) => selector === 'input[type="email"]' ? input : marker)
  } as unknown as Page;
  Object.assign(input, { page: () => page });

  const foreground = vi.fn(async (label: string, operation: () => Promise<unknown>) => {
    events.push(`lease:${label}:start`);
    try {
      return await operation();
    } finally {
      events.push(`lease:${label}:end`);
    }
  });
  const ui: AccountUiInteraction = {
    foreground: foreground as unknown as AccountUiInteraction['foreground'],
    editor: vi.fn(async (_label: string, operation: () => Promise<unknown>) => operation()) as unknown as AccountUiInteraction['editor']
  };
  const signal = new AbortController().signal;

  return { afterTyping, events, foreground, input, page, signal, ui };
}

async function run(kind: AuthKind, f: ReturnType<typeof fixture>): Promise<unknown> {
  const context = {} as BrowserContext;
  const creds = { email: 'mail@example.com', password: 'Password1!' };
  vi.useFakeTimers();
  try {
    const running = kind === 'login'
      ? loginCapcut(f.page, context, creds, vi.fn(), { ui: f.ui, signal: f.signal })
      : signupCapcut(f.page, context, creds, { log: vi.fn(), ui: f.ui, signal: f.signal });
    const promise = running.then(
      val => ({ ok: true as const, val }),
      err => ({ ok: false as const, err })
    );
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    if (!result.ok) throw result.err;
    return result.val;
  } finally {
    vi.useRealTimers();
  }
}

describe.each(['login', 'signup'] as const)('%s verified typing', (kind) => {
  it('keeps focus, clear, typing, and validation in one supplied foreground lease', async () => {
    const f = fixture(kind);

    await expect(run(kind, f)).rejects.toBe(f.afterTyping);

    const stage = `${kind}:fill-email:attempt-1`;
    const start = f.events.indexOf(`lease:${stage}:start`);
    const end = f.events.indexOf(`lease:${stage}:end`);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(f.events.slice(start, end + 1)).toEqual([
      `lease:${stage}:start`,
      'focus',
      'clear',
      'type',
      'validate',
      `lease:${stage}:end`
    ]);
    expect(f.foreground).toHaveBeenCalledWith(stage, expect.any(Function));
  });

  it('treats a typed or code-shaped clear timeout as fatal without typing or retrying', async () => {
    const timeout = kind === 'login'
      ? new DomReadTimeoutError('login:fill-email:clear')
      : Object.assign(new Error('foreign realm timeout'), { code: 'DOM_READ_TIMEOUT' });
    const f = fixture(kind, timeout);

    await expect(run(kind, f)).rejects.toBe(timeout);

    expect(f.input.clear).toHaveBeenCalledOnce();
    expect(f.input.pressSequentially).not.toHaveBeenCalled();
    expect(f.input.inputValue).not.toHaveBeenCalled();
  });
});
