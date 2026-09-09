import type { AccountHttpSession } from './accountSession';
import { assertAccountHttpSessionUsable } from './accountSession';
import type { CapcutHttpRequest, CapcutHttpResponse, CapcutHttpTextResponse, HttpStreamResponse } from './httpTypes';
import type { NativeHttpRequestBody } from './nativeHttpContext';

export interface HttpOnlyTransport {
  readonly session: AccountHttpSession;
  requestJson<T>(request: HttpOnlyRequest): Promise<CapcutHttpResponse<T> & { headers?: Record<string, string> }>;
  requestText(request: HttpOnlyRequest): Promise<CapcutHttpTextResponse>;
  requestForm<T>(request: Omit<HttpOnlyRequest, 'body'> & { form: Record<string, string | number | boolean> }): Promise<CapcutHttpResponse<T>>;
  requestStream(request: HttpOnlyRequest & { deadlineMs?: number; maxBytes?: number }): Promise<HttpStreamResponse>;
}

export interface HttpOnlyRequest extends CapcutHttpRequest { origin?: string; }

function validateHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
      throw new Error('CAPCUT_HTTP_HEADER_INVALID');
    }
  }
  const normalized = new Set(Object.keys(headers).map(name => name.toLowerCase()));
  if (normalized.has('host') || normalized.has('proxy-authorization') || normalized.has('cookie')) {
    throw new Error('CAPCUT_HTTP_HEADER_INVALID');
  }
}

/** Direct-only transport contract. It exposes no Page, browser, or interception API. */
export function createHttpOnlyTransport(session: AccountHttpSession): HttpOnlyTransport {
  assertAccountHttpSessionUsable(session);
  const origins = new Set(['https://www.capcut.com', 'https://edit-api-sg.capcut.com', 'https://commerce-api-sg.capcut.com', 'https://login-row.www.capcut.com', 'https://login.us.capcut.com']);
  if (!origins.has(session.origin)) throw new Error('CAPCUT_HTTP_ORIGIN_NOT_ALLOWED');

  const execute = async <T>(input: HttpOnlyRequest, body: NativeHttpRequestBody | undefined, method: 'GET' | 'POST', mime: string, text: boolean): Promise<T> => {
    assertAccountHttpSessionUsable(session);
    input.signal?.throwIfAborted();
    if (!session.context) throw new Error('HTTP_SESSION_CONTEXT_MISSING');
    if (!input.path.startsWith('/') || input.path.startsWith('//') || /[\\#\s]/.test(input.path) || input.path.includes('://')) throw new Error('CAPCUT_HTTP_PATH_INVALID');
    const origin = input.origin ?? session.origin;
    if (!origins.has(origin)) throw new Error('CAPCUT_HTTP_ORIGIN_NOT_ALLOWED');
    const url = new URL(input.path, origin);
    if (url.origin !== origin) throw new Error('CAPCUT_HTTP_PATH_INVALID');
    const headers: Record<string, string> = {};
    for (const source of [origin === session.origin ? session.headers : {}, input.headers ?? {}]) {
      for (const [key, value] of Object.entries(source)) headers[key.toLowerCase()] = value;
    }
    validateHeaders(headers);
    if (body !== undefined) {
      if (headers['content-type'] && headers['content-type'].split(';')[0].trim() !== mime) throw new Error('CAPCUT_HTTP_ENCODING_MISMATCH');
      headers['content-type'] = mime;
    }
    const mutation = input.effect === 'mutation' || (input.effect !== 'read' && method === 'POST');
    try {
      const response = await session.context.fetch(url.toString(), {
        method, params: input.query, headers, data: body, signal: input.signal,
        timeout: 30_000, maxBytes: (text ? 16 : 2) * 1024 * 1024, maxRedirects: 0, maxRetries: 0
      });
      try {
        if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
        const bytes = await response.body();
        if (bytes.length > (text ? 16 : 2) * 1024 * 1024) throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
        input.signal?.throwIfAborted();
        if (text) return { status: response.status(), ok: response.ok(), headers: response.headers(), body: bytes.toString('utf8') } as T;
        let data: unknown;
        try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('CAPCUT_HTTP_INVALID_JSON'); }
        return { status: response.status(), ok: response.ok(), headers: response.headers(), data } as T;
      } finally { await response.dispose(); }
    } catch (error) {
      // No automatic retry: transport/parse failure cannot undo a dispatched write.
      if (mutation) throw new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN');
      if (error instanceof Error && error.message === 'NATIVE_HTTP_RESPONSE_TOO_LARGE') throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
      if (error instanceof Error && /^CAPCUT_HTTP_(REDIRECT_BLOCKED|BODY_TOO_LARGE|INVALID_JSON)$/.test(error.message)) throw error;
      throw new Error(input.signal?.aborted ? 'CAPCUT_HTTP_ABORTED' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
    }
  };
  const requestStream = async (input: HttpOnlyRequest & { deadlineMs?: number; maxBytes?: number }): Promise<HttpStreamResponse> => {
    assertAccountHttpSessionUsable(session);
    input.signal?.throwIfAborted();
    if (!session.context) throw new Error('HTTP_SESSION_CONTEXT_MISSING');
    if (!input.path.startsWith('/') || input.path.startsWith('//') || /[\\#\s]/.test(input.path) || input.path.includes('://')) throw new Error('CAPCUT_HTTP_PATH_INVALID');
    if (input.deadlineMs !== undefined && (!Number.isFinite(input.deadlineMs) || input.deadlineMs <= 0)) throw new Error('CAPCUT_HTTP_DEADLINE_INVALID');
    if (input.maxBytes !== undefined && (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0)) throw new Error('CAPCUT_HTTP_STREAM_LIMIT_INVALID');
    const origin = input.origin ?? session.origin;
    if (!origins.has(origin)) throw new Error('CAPCUT_HTTP_ORIGIN_NOT_ALLOWED');
    const url = new URL(input.path, origin);
    if (url.origin !== origin) throw new Error('CAPCUT_HTTP_PATH_INVALID');
    const headers: Record<string, string> = {};
    for (const source of [origin === session.origin ? session.headers : {}, input.headers ?? {}]) for (const [key, value] of Object.entries(source)) headers[key.toLowerCase()] = value;
    validateHeaders(headers);
    const body = input.body === undefined ? undefined : (typeof input.body === 'string' ? input.body : JSON.stringify(input.body));
    if (body !== undefined) headers['content-type'] ??= 'application/json';
    const mutation = input.effect === 'mutation' || (input.effect !== 'read' && (input.method ?? 'GET') === 'POST');
    const deadlineMs = input.deadlineMs ?? 240_000;
    const maxBytes = input.maxBytes ?? 8 * 1024 * 1024;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('CAPCUT_HTTP_DEADLINE')), deadlineMs);
    const abort = () => deadline.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    let response: Awaited<ReturnType<AccountHttpSession['context']['stream']>> | undefined;
    try {
      response = await session.context.stream(url.toString(), {
        method: input.method ?? 'GET',
        params: input.query,
        headers,
        data: body,
        signal: deadline.signal,
        timeout: deadlineMs,
        maxBytes,
        maxRedirects: 0,
        maxRetries: 0
      });
      if (response.status() >= 300 && response.status() < 400) throw new Error('CAPCUT_HTTP_REDIRECT_BLOCKED');
      const stream = response.body;
      const source = response;
      let disposed = false;
      const cleanup = async () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
        await source.dispose();
      };
      const bounded: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          let bytes = 0;
          try {
            if (disposed) throw new Error('CAPCUT_HTTP_STREAM_CLOSED');
            deadline.signal.throwIfAborted();
            for await (const chunk of stream) {
              deadline.signal.throwIfAborted();
              const value = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
              bytes += value.byteLength;
              if (bytes > maxBytes) throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
              yield value;
            }
          } catch (error) {
            if (mutation) throw new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN');
            if (error instanceof Error && error.message === 'NATIVE_HTTP_RESPONSE_TOO_LARGE') throw new Error('CAPCUT_HTTP_BODY_TOO_LARGE');
            if (error instanceof Error && /^CAPCUT_HTTP_(BODY_TOO_LARGE|STREAM_MISSING|STREAM_CLOSED)$/.test(error.message)) throw error;
            throw new Error(deadline.signal.aborted ? 'CAPCUT_HTTP_ABORTED' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
          } finally { await cleanup(); }
        }
      };
      return { status: source.status(), ok: source.ok(), headers: source.headers(), body: bounded, dispose: cleanup };
    } catch (error) {
      if (response) await response.dispose().catch(() => {});
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      if (mutation) throw new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN');
      if (error instanceof Error && /^CAPCUT_HTTP_/.test(error.message)) throw error;
      throw new Error(deadline.signal.aborted ? 'CAPCUT_HTTP_ABORTED' : 'CAPCUT_HTTP_TRANSPORT_FAILED');
    }
  };
  return {
    session,
    requestJson: input => execute(input, input.body === undefined || typeof input.body === 'string' ? input.body : JSON.stringify(input.body), input.method ?? 'GET', 'application/json', false),
    requestForm: input => execute(input, new URLSearchParams(Object.entries(input.form).map(([key, value]) => [key, String(value)])), input.method ?? 'POST', 'application/x-www-form-urlencoded', false),
    requestText: input => execute(input, input.body === undefined || typeof input.body === 'string' ? input.body : JSON.stringify(input.body), input.method ?? 'GET', 'application/json', true),
    requestStream
  };
}
