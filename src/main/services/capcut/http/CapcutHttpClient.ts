import type { APIRequestContext, Page } from 'playwright-core';
import { assertAccountHttpSessionUsable, type AccountHttpSession } from './accountSession';
import { createHttpOnlyTransport, type HttpOnlyTransport } from './httpOnlyTransport';
import type { CapcutHttpFormRequest, CapcutHttpRequest, CapcutHttpResponse, CapcutHttpTextResponse } from './httpTypes';
export type { CapcutHttpFormRequest, CapcutHttpRequest, CapcutHttpResponse, CapcutHttpTextResponse } from './httpTypes';

export interface CapcutHttpTransport {
  requestJson<T>(request: CapcutHttpRequest): Promise<CapcutHttpResponse<T>>;
}

export interface SignedHttpRequest {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: string;
  headers: Record<string, string>;
  effect: 'read' | 'mutation';
}

const ALLOWED_ORIGINS = new Set([
  'https://www.capcut.com',
  'https://edit-api-sg.capcut.com',
  'https://commerce-api-sg.capcut.com',
  'https://login-row.www.capcut.com',
  'https://login.us.capcut.com',
]);

export class CapcutHttpClient implements CapcutHttpTransport {
  private readonly requestContext?: APIRequestContext;
  private readonly sessionHeaders: Readonly<Record<string, string>>;

  constructor(
    private readonly page: Page | null,
    private readonly origin = 'https://edit-api-sg.capcut.com',
    requestContext?: APIRequestContext,
    sessionHeaders: Readonly<Record<string, string>> = {}
  ) {
    if (!ALLOWED_ORIGINS.has(origin)) throw new Error('CAPCUT_HTTP_ORIGIN_NOT_ALLOWED');
    this.requestContext = requestContext;
    this.sessionHeaders = sessionHeaders;
  }

  /** The caller owns this account's independently configured proxy/cookie jar. */
  static fromRequestContext(context: APIRequestContext, origin = 'https://edit-api-sg.capcut.com'): CapcutHttpClient {
    return new CapcutHttpClient(null, origin, context);
  }

  static fromAccountSession(session: AccountHttpSession, origin = 'https://edit-api-sg.capcut.com'): HttpOnlyTransport {
    assertAccountHttpSessionUsable(session);
    if (origin !== session.origin) throw new Error('CAPCUT_HTTP_SESSION_ORIGIN_MISMATCH');
    return createHttpOnlyTransport(session);
  }

  async requestJson<T>(request: CapcutHttpRequest): Promise<CapcutHttpResponse<T>> {
    request.signal?.throwIfAborted();
    if (!request.path.startsWith('/') || request.path.includes('://')) {
      throw new Error('CAPCUT_HTTP_PATH_INVALID');
    }
    if (new URL(this.origin + request.path).origin !== this.origin || /[\\#\r\n]/.test(request.path)) {
      throw new Error('CAPCUT_HTTP_PATH_INVALID');
    }
    if (this.requestContext) {
      const mutation = request.effect === 'mutation' || (request.effect !== 'read' && request.method === 'POST');
      try {
        const response = await this.requestContext.fetch(this.origin + request.path, {
          method: request.method ?? 'GET',
          params: request.query,
          headers: { ...this.sessionHeaders, ...(request.headers ?? {}) },
          data: request.body,
          timeout: 30_000,
          signal: request.signal,
          maxRedirects: 0,
          maxRetries: 0,
        });
        try {
          if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
          const body = await response.body();
          if (body.length > 2 * 1024 * 1024) throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
          let data: unknown;
          try { data = JSON.parse(body.toString('utf8')); } catch { throw new Error('CAPCUT_HTTP_INVALID_JSON'); }
          request.signal?.throwIfAborted();
          return { status: response.status(), ok: response.ok(), data } as CapcutHttpResponse<T>;
        } finally { await response.dispose(); }
      } catch (error) {
        // A transport failure after dispatch cannot establish that a mutation had no effect.
        if (mutation) throw new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN');
        if (error instanceof Error && /^CAPCUT_HTTP_(REDIRECT_BLOCKED|BODY_TOO_LARGE|INVALID_JSON)$/.test(error.message)) throw error;
        throw new Error(request.signal?.aborted ? 'CAPCUT_HTTP_ABORTED' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
      }
    }
    if (!this.page) throw new Error('CAPCUT_HTTP_SESSION_UNAVAILABLE');
    const result = await this.page.evaluate(async ({ origin, path, method, body, headers, query }) => {
      const target = new URL(origin + path);
      for (const [key, value] of Object.entries(query ?? {})) target.searchParams.set(key, String(value));
      const response = await fetch(target.toString(), {
        method,
        credentials: 'include',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(headers ?? {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: unknown;
      try { data = await response.json(); } catch { data = null; }
      return { status: response.status, ok: response.ok, data };
    }, { origin: this.origin, path: request.path, method: request.method ?? 'GET', body: request.body, headers: request.headers, query: request.query });
    request.signal?.throwIfAborted();
    return result as CapcutHttpResponse<T>;
  }

  /** Sends a captured form-urlencoded request without a browser runtime. */
  async requestForm<T>(request: CapcutHttpFormRequest): Promise<CapcutHttpResponse<T>> {
    request.signal?.throwIfAborted();
    if (!request.path.startsWith('/') || /[\r\n#]/.test(request.path)) throw new Error('CAPCUT_HTTP_PATH_INVALID');
    if (!this.requestContext) throw new Error('CAPCUT_HTTP_DIRECT_CONTEXT_REQUIRED');
    const body = new URLSearchParams(Object.entries(request.form).map(([key, value]) => [key, String(value)])).toString();
    const mutation = request.effect === 'mutation' || (request.effect !== 'read' && request.method === 'POST');
    try {
      const response = await this.requestContext.fetch(this.origin + request.path, {
        method: request.method ?? 'POST',
        params: request.query,
        headers: { ...this.sessionHeaders, 'content-type': 'application/x-www-form-urlencoded', ...(request.headers ?? {}) },
        data: body,
        timeout: 30_000,
        signal: request.signal,
        maxRedirects: 0,
        maxRetries: 0
      });
      try {
        if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
        const bytes = await response.body();
        if (bytes.length > 2 * 1024 * 1024) throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
        let data: unknown;
        try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('CAPCUT_HTTP_INVALID_JSON'); }
        request.signal?.throwIfAborted();
        return { status: response.status(), ok: response.ok(), data } as CapcutHttpResponse<T>;
      } finally { await response.dispose(); }
    } catch (error) {
      if (mutation) throw new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN');
      if (error instanceof Error && /^CAPCUT_HTTP_(REDIRECT_BLOCKED|BODY_TOO_LARGE|INVALID_JSON)$/.test(error.message)) throw error;
      throw new Error(request.signal?.aborted ? 'CAPCUT_HTTP_ABORTED' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
    }
  }

  async requestText(request: CapcutHttpRequest): Promise<CapcutHttpTextResponse> {
    request.signal?.throwIfAborted();
    if (!this.requestContext) throw new Error('CAPCUT_HTTP_DIRECT_CONTEXT_REQUIRED');
    try {
      const response = await this.requestContext.fetch(this.origin + request.path, {
        method: request.method ?? 'GET', params: request.query, headers: { ...this.sessionHeaders, ...(request.headers ?? {}) },
        data: request.body, timeout: 30_000, signal: request.signal, maxRedirects: 0, maxRetries: 0,
      });
      if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
      const body = await response.body();
      if (body.length > 16 * 1024 * 1024) throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
      return { status: response.status(), ok: response.ok(), headers: response.headers(), body: body.toString('utf8') };
    } catch (error) {
      if (error instanceof Error && /^CAPCUT_HTTP_/.test(error.message)) throw error;
      throw new Error(request.effect === 'mutation' ? 'CAPCUT_HTTP_OUTCOME_UNKNOWN' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
    }
  }

  /** Dispatches an immutable browser-signed wire request without DOM actions. */
  async dispatchSigned<T>(request: SignedHttpRequest, signal?: AbortSignal): Promise<CapcutHttpResponse<T>> {
    signal?.throwIfAborted();
    if (!request.path.startsWith('/') || /[\r\n]/.test(request.path) || !request.headers['content-type']) throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
    if (!this.requestContext) throw new Error('CAPCUT_HTTP_DIRECT_CONTEXT_REQUIRED');
    try {
      const response = await this.requestContext.fetch(this.origin + request.path, {
        method: request.method,
        headers: { ...this.sessionHeaders, ...request.headers },
        data: request.body,
        timeout: 30_000,
        signal,
        maxRedirects: 0,
        maxRetries: 0,
      });
      if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
      const bytes = await response.body();
      let data: unknown;
      try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('CAPCUT_HTTP_INVALID_JSON'); }
      return { status: response.status(), ok: response.ok(), data } as CapcutHttpResponse<T>;
    } catch (error) {
      if (error instanceof Error && /^CAPCUT_HTTP_/.test(error.message)) throw error;
      throw new Error(request.effect === 'mutation' ? 'CAPCUT_HTTP_OUTCOME_UNKNOWN' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
    }
  }
}
