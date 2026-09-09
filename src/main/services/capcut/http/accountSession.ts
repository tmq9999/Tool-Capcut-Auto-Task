import type { NativeHttpContext } from './nativeHttpContext';

export interface HttpProxyRoute {
  server: string;
  username?: string;
  password?: string;
}

export interface AccountHttpSession {
  readonly accountId: string;
  readonly proxy: HttpProxyRoute;
  readonly context: NativeHttpContext;
  readonly headers: Readonly<Record<string, string>>;
  readonly origin: string;
  readonly expiresAt?: number;
}

export interface AccountHttpSessionInput {
  accountId: string;
  proxy: HttpProxyRoute;
  context: NativeHttpContext;
  headers?: Record<string, string>;
  origin?: string;
  expiresAt?: number;
}

export function assertAccountHttpSessionInput(
  input: Pick<AccountHttpSessionInput, 'accountId' | 'proxy' | 'origin' | 'expiresAt'>,
  now = Date.now()
): void {
  if (!input.accountId.trim()) throw new Error('HTTP_SESSION_ACCOUNT_ID_REQUIRED');
  let proxy: URL;
  try { proxy = new URL(input.proxy.server); } catch { throw new Error('HTTP_SESSION_PROXY_INVALID'); }
  if (!['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password) {
    throw new Error('HTTP_SESSION_PROXY_INVALID');
  }
  if ([input.proxy.username, input.proxy.password].some(value => value !== undefined && /[\r\n\0]/.test(value))) {
    throw new Error('HTTP_SESSION_PROXY_INVALID');
  }
  const origin = input.origin ?? 'https://edit-api-sg.capcut.com';
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { throw new Error('HTTP_SESSION_ORIGIN_INVALID'); }
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password) {
    throw new Error('HTTP_SESSION_ORIGIN_INVALID');
  }
  assertAccountHttpSessionUsable(input, now);
}

/** Creates an immutable account boundary around one native HTTP context. */
export function createAccountHttpSession(input: AccountHttpSessionInput): AccountHttpSession {
  assertAccountHttpSessionInput(input);
  if (input.context?.transport !== 'cycletls') throw new Error('HTTP_SESSION_NATIVE_CONTEXT_REQUIRED');
  const origin = input.origin ?? 'https://edit-api-sg.capcut.com';
  return Object.freeze({
    accountId: input.accountId,
    proxy: Object.freeze({ ...input.proxy }),
    context: input.context,
    origin,
    headers: Object.freeze({ ...(input.headers ?? {}) }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
  });
}

export function assertAccountHttpSessionUsable(session: Pick<AccountHttpSession, 'expiresAt'>, now = Date.now()): void {
  if (session.expiresAt !== undefined && !Number.isFinite(session.expiresAt)) throw new Error('HTTP_SESSION_EXPIRY_INVALID');
  if (session.expiresAt !== undefined && session.expiresAt <= now) throw new Error('HTTP_SESSION_EXPIRED');
}
