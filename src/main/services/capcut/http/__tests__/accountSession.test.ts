import { describe, expect, it } from 'vitest';
import { assertAccountHttpSessionUsable, createAccountHttpSession } from '../accountSession';
import type { NativeHttpContext } from '../nativeHttpContext';

const context = {
  transport: 'cycletls',
  fetch: async () => { throw new Error('unused'); },
  get: async () => { throw new Error('unused'); },
  stream: async () => { throw new Error('unused'); },
  dispose: async () => undefined
} satisfies NativeHttpContext;

describe('account HTTP session', () => {
  it('rejects a Playwright-shaped context at the native account boundary', () => {
    const playwrightContext = { fetch: async () => undefined, storageState: async () => ({ cookies: [] }) };
    expect(() => createAccountHttpSession({
      accountId: 'a1',
      proxy: { server: 'http://127.0.0.1:1' },
      context: playwrightContext as never
    })).toThrow('HTTP_SESSION_NATIVE_CONTEXT_REQUIRED');
  });

  it('freezes account proxy and session headers', () => {
    const session = createAccountHttpSession({ accountId: 'a1', proxy: { server: 'http://127.0.0.1:1' }, context, headers: { cookie: 'sid=1' } });
    expect(session.accountId).toBe('a1');
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.proxy)).toBe(true);
    expect(Object.isFrozen(session.headers)).toBe(true);
  });

  it('rejects expired sessions before dispatch', () => {
    const session = createAccountHttpSession({ accountId: 'a1', proxy: { server: 'http://127.0.0.1:1' }, context, expiresAt: Date.now() + 10_000 });
    expect(() => assertAccountHttpSessionUsable(session, session.expiresAt! + 1)).toThrow('HTTP_SESSION_EXPIRED');
  });

  it('rejects invalid account or proxy boundaries', () => {
    expect(() => createAccountHttpSession({ accountId: '', proxy: { server: 'http://x' }, context })).toThrow('HTTP_SESSION_ACCOUNT_ID_REQUIRED');
    expect(() => createAccountHttpSession({ accountId: 'a1', proxy: { server: 'x' }, context })).toThrow('HTTP_SESSION_PROXY_INVALID');
  });

  it('binds credentials to one API origin', () => {
    const session = createAccountHttpSession({ accountId: 'a1', proxy: { server: 'http://127.0.0.1:1' }, context, origin: 'https://edit-api-sg.capcut.com' });
    expect(session.origin).toBe('https://edit-api-sg.capcut.com');
  });
});
