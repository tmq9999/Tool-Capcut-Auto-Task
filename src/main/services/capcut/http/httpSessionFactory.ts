import { assertAccountHttpSessionInput, createAccountHttpSession, type AccountHttpSession, type HttpProxyRoute } from './accountSession';
import { createCycleTlsContext } from './cycleTlsContext';
import type { NativeHttpContext } from './nativeHttpContext';
import type { CycleTlsFingerprintOptions } from './cycleTlsRuntime';

export interface HttpSessionMaterial {
  accountId: string;
  proxy: HttpProxyRoute;
  headers: Record<string, string>;
  origin?: string;
  expiresAt?: number;
  tls?: CycleTlsFingerprintOptions;
}

export interface LiveHttpSession {
  session: AccountHttpSession;
  dispose(): Promise<void>;
}

/** Creates one isolated HTTP jar; this never launches or attaches a browser. */
export interface HttpSessionFactoryDependencies {
  createContext?: typeof createCycleTlsContext;
}

export async function createHttpOnlySession(
  material: HttpSessionMaterial,
  dependencies: HttpSessionFactoryDependencies = {}
): Promise<LiveHttpSession> {
  assertAccountHttpSessionInput(material);
  const origin = material.origin ?? 'https://edit-api-sg.capcut.com';
  const cookieEntries = Object.entries(material.headers).filter(([name]) => name.toLowerCase() === 'cookie');
  if (cookieEntries.length > 1) throw new Error('HTTP_SESSION_COOKIE_AMBIGUOUS');
  const headers = Object.fromEntries(Object.entries(material.headers).filter(([name]) => name.toLowerCase() !== 'cookie'));
  const rawCookie = cookieEntries[0]?.[1];
  const context: NativeHttpContext = await (dependencies.createContext ?? createCycleTlsContext)({
    proxy: { ...material.proxy },
    ...(rawCookie === undefined ? {} : { initialCookie: { header: rawCookie, origin } }),
    ...(material.tls === undefined ? {} : { tls: material.tls })
  });
  try {
    return {
      session: createAccountHttpSession({ ...material, origin, headers, context }),
      dispose: () => context.dispose()
    };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}
