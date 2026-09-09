import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  HttpResponseHeadersMetadata
} from './HttpClient';

export interface ObservationIdentity {
  runId?: string | null;
  workerAlias?: string | null;
  acquisitionAlias?: string | null;
  accountAlias?: string | null;
  sessionAlias?: string | null;
  provider?: string | null;
  operation?: string | null;
  authorityRef?: string | null;
}

export type ResolvedObservationIdentity =
  | Readonly<{ scope: 'unscoped' }>
  | Readonly<{ scope: 'scoped' } & ObservationIdentity>;

interface ObservationBaseEvent {
  requestId: string;
  at: string;
  identity: ResolvedObservationIdentity;
  routeTemplate: string;
  businessCategory: ObservationBusinessCategory;
}

export type HttpObservationEvent =
  | Readonly<ObservationBaseEvent & {
      phase: 'request';
      method: HttpRequest['method'];
    }>
  | Readonly<ObservationBaseEvent & {
      phase: 'response-headers';
      status: number;
      ok: boolean;
      headersSource: 'early';
    }>
  | Readonly<ObservationBaseEvent & {
      phase: 'response';
      status: number;
      ok: boolean;
      headersSource: 'early' | 'final-response';
      bodyType: 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined';
      durationMs: number;
    }>
  | Readonly<ObservationBaseEvent & {
      phase: 'error';
      errorName: string;
      errorCode?: string;
      headersSource: 'early' | 'unavailable';
      status?: number;
      durationMs: number;
    }>;

export type HttpObservationSink = (event: HttpObservationEvent) => void | Promise<void>;

export interface ObservationScope {
  withObservationScope<T>(
    identity: Readonly<ObservationIdentity>,
    operation: () => Promise<T>
  ): Promise<T>;
}

interface ObservationStore {
  identity: Readonly<ObservationIdentity>;
  requestId?: string;
  routeTemplate?: string;
  businessCategory?: ObservationBusinessCategory;
}

interface EarlyHeaders {
  status: number;
  ok: boolean;
}

const UNSCOPED_IDENTITY = Object.freeze({ scope: 'unscoped' as const });

const PROVIDERS = new Set([
  'gmail94', 'dongvanfb', 'customdomain', 'kiotproxy', 'multilogin'
]);
const OPERATIONS = new Set([
  'preflight', 'profile', 'service-list', 'balance', 'mailbox-purchase',
  'purchase-mailbox', 'oauth-exchange', 'read-otp', 'proxy-list',
  'proxy-current', 'proxy-acquire', 'proxy-release', 'sign-in', 'token-refresh',
  'profile-launch', 'profile-stop', 'profile-status', 'version', 'workspace-list'
]);
const KNOWN_ROUTES = new Set([
  '/profile', '/otp/create', '/otp/read', '/services',
  '/user/balance', '/user/account_type', '/user/buy', '/api/getOauth2',
  '/api/graph_code', '/api/get_code_oauth2', '/user/create_mail_server',
  '/user/get_code_mail_server', '/api/public/keys', '/api/public/proxies/get-new',
  '/api/public/proxies/get-current', '/api/public/proxies/out',
  '/api/public/get-user-info', '/user/signin', '/user/refresh_token',
  '/api/v3/profile/quick', '/api/v1/profile/quick/statuses', '/api/v1/version',
  '/workspace/folders'
]);
const ERROR_CODES = new Set([
  'ERR_HTTP_TRANSPORT', 'AUTH_ERROR', 'CONFIG_ERROR', 'NETWORK_ERROR',
  'RATE_LIMITED', 'INSUFFICIENT_FUNDS', 'PROVIDER_NOT_IMPLEMENTED'
]);

export type ObservationBusinessCategory =
  | 'mailbox-purchase'
  | 'otp-read'
  | 'proxy'
  | 'authentication'
  | 'account-read'
  | 'other';

function sanitizeAlias(value: string): string {
  return /^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value) ? value : 'redacted';
}

function sanitizeIdentity(identity: Readonly<ObservationIdentity>): Readonly<ObservationIdentity> {
  const result: ObservationIdentity = {};
  for (const field of [
    'runId', 'workerAlias', 'acquisitionAlias', 'accountAlias', 'sessionAlias', 'authorityRef'
  ] as const) {
    const value = identity[field];
    if (typeof value === 'string') result[field] = sanitizeAlias(value);
  }
  if (typeof identity.provider === 'string') {
    result.provider = PROVIDERS.has(identity.provider) ? identity.provider : 'unknown';
  }
  if (typeof identity.operation === 'string') {
    result.operation = OPERATIONS.has(identity.operation) ? identity.operation : 'unknown';
  }
  return Object.freeze(result);
}

function mergeIdentity(
  parent: Readonly<ObservationIdentity>,
  next: Readonly<ObservationIdentity>
): Readonly<ObservationIdentity> {
  const merged: ObservationIdentity = { ...parent };
  for (const [key, value] of Object.entries(next) as Array<[
    keyof ObservationIdentity,
    string | null | undefined
  ]>) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return sanitizeIdentity(merged);
}

function freezeIdentity(identity: Readonly<ObservationIdentity>): ResolvedObservationIdentity {
  if (Object.keys(identity).length === 0) return UNSCOPED_IDENTITY;
  return Object.freeze({ scope: 'scoped' as const, ...identity });
}

function routeTemplate(rawUrl: string): string {
  try {
    const path = new URL(rawUrl).pathname;
    if (/^\/api\/emails\/[^/]+$/.test(path)) return '/api/emails/:address';
    if (/^\/api\/v1\/profile\/stop\/p\/[^/]+$/.test(path)) {
      return '/api/v1/profile/stop/p/:profileId';
    }
    const known = Array.from(KNOWN_ROUTES)
      .sort((left, right) => right.length - left.length)
      .find((candidate) => path === candidate || path.endsWith(candidate));
    return known ?? '/unknown';
  } catch {
    return '/unknown';
  }
}

function businessCategory(identity: Readonly<ObservationIdentity>): ObservationBusinessCategory {
  switch (identity.operation) {
    case 'mailbox-purchase':
    case 'purchase-mailbox': return 'mailbox-purchase';
    case 'read-otp': return 'otp-read';
    case 'proxy-list':
    case 'proxy-current':
    case 'proxy-acquire':
    case 'proxy-release': return 'proxy';
    case 'sign-in':
    case 'token-refresh': return 'authentication';
    case 'profile':
    case 'balance':
    case 'service-list': return 'account-read';
    default: return 'other';
  }
}

function bodyType(body: unknown): 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined' {
  if (body === null) return 'null';
  if (Array.isArray(body)) return 'array';
  return typeof body as 'object' | 'string' | 'number' | 'boolean' | 'undefined';
}

function safeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODES.has(code) ? code : undefined;
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return new Set(['Error', 'AbortError', 'HttpTransportError', 'ProviderError']).has(error.name)
    ? error.name
    : 'Error';
}

export class ObservedHttpClient implements HttpClient, ObservationScope {
  private readonly storage = new AsyncLocalStorage<ObservationStore>();
  private readonly earlyHeaders = new Map<string, EarlyHeaders>();
  private requestSequence = 0;

  constructor(
    private readonly transport: HttpClient,
    private readonly observer: HttpObservationSink
  ) {}

  withObservationScope<T>(
    identity: Readonly<ObservationIdentity>,
    operation: () => Promise<T>
  ): Promise<T> {
    const parent = this.storage.getStore()?.identity ?? {};
    const merged = mergeIdentity(parent, identity);
    return this.storage.run({ identity: merged }, operation);
  }

  captureResponseHeaders(metadata: HttpResponseHeadersMetadata): void {
    const store = this.storage.getStore();
    if (!store?.requestId || this.earlyHeaders.has(store.requestId)) return;
    const early = Object.freeze({ status: metadata.status, ok: metadata.ok });
    this.earlyHeaders.set(store.requestId, early);
    this.emit(Object.freeze({
      phase: 'response-headers' as const,
      requestId: store.requestId,
      at: new Date().toISOString(),
      identity: freezeIdentity(store.identity),
      routeTemplate: store.routeTemplate ?? '/unknown',
      businessCategory: store.businessCategory ?? businessCategory(store.identity),
      status: early.status,
      ok: early.ok,
      headersSource: 'early' as const
    }));
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    const parent = this.storage.getStore();
    const identity = parent?.identity ?? Object.freeze({});
    const requestId = 'provider-http-' + ++this.requestSequence;
    const resolvedIdentity = freezeIdentity(identity);
    const safeRoute = routeTemplate(request.url);
    const category = businessCategory(identity);
    const startedAt = Date.now();
    this.emit(Object.freeze({
      phase: 'request' as const,
      requestId,
      at: new Date().toISOString(),
      identity: resolvedIdentity,
      routeTemplate: safeRoute,
      businessCategory: category,
      method: request.method
    }));

    try {
      const response = await this.storage.run(
        { identity, requestId, routeTemplate: safeRoute, businessCategory: category },
        () => this.transport.send(request)
      );
      const early = this.earlyHeaders.get(requestId);
      this.emit(Object.freeze({
        phase: 'response' as const,
        requestId,
        at: new Date().toISOString(),
        identity: resolvedIdentity,
        routeTemplate: safeRoute,
        businessCategory: category,
        status: response.status,
        ok: response.ok,
        headersSource: early ? 'early' as const : 'final-response' as const,
        bodyType: bodyType(response.body),
        durationMs: Math.max(0, Date.now() - startedAt)
      }));
      return response;
    } catch (error: unknown) {
      const early = this.earlyHeaders.get(requestId);
      const errorCode = safeErrorCode(error);
      this.emit(Object.freeze({
        phase: 'error' as const,
        requestId,
        at: new Date().toISOString(),
        identity: resolvedIdentity,
        routeTemplate: safeRoute,
        businessCategory: category,
        errorName: safeErrorName(error),
        ...(errorCode ? { errorCode } : {}),
        headersSource: early ? 'early' as const : 'unavailable' as const,
        ...(early ? { status: early.status } : {}),
        durationMs: Math.max(0, Date.now() - startedAt)
      }));
      throw error;
    } finally {
      this.earlyHeaders.delete(requestId);
    }
  }

  private emit(event: HttpObservationEvent): void {
    try {
      const pending = this.observer(event);
      if (pending && typeof pending.then === 'function') {
        void pending.catch(() => undefined);
      }
    } catch {
      // Observation is fail-open by contract.
    }
  }
}
