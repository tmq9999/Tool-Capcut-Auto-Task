import { Buffer } from 'node:buffer';
import { CookieJar } from 'tough-cookie';
import type {
  NativeHttpContext,
  NativeHttpHeader,
  NativeHttpHeaders,
  NativeHttpRequestBody,
  NativeHttpRequestOptions,
  NativeHttpResponse,
  NativeHttpStreamResponse
} from './nativeHttpContext';
import {
  assertCycleTlsProxyForTarget,
  createCycleTlsDriver,
  validatedCycleTlsFingerprintOptions,
  validatedCycleTlsProxy,
  type CycleTlsDriver,
  type CycleTlsDriverOptions,
  type CycleTlsDriverRequest,
  type CycleTlsDriverResponse,
  type CycleTlsFingerprintOptions,
  type CycleTlsProxy
} from './cycleTlsRuntime';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface CycleTlsContextOptions {
  proxy?: CycleTlsProxy;
  initialCookie?: {
    header: string;
    origin: string;
  };
  /** Saved Set-Cookie response state. The caller must keep these values encrypted at rest. */
  initialResponseCookies?: readonly {
    url: string;
    setCookieHeaders: readonly string[];
    receivedAt?: number;
  }[];
  timeoutMs?: number;
  startupTimeoutMs?: number;
  maxResponseBytes?: number;
  tls?: CycleTlsFingerprintOptions;
}

export interface CycleTlsContextDependencies {
  createDriver?: (options: CycleTlsDriverOptions) => Promise<CycleTlsDriver>;
}

interface PendingRequest {
  reject(error: Error): void;
}

function positiveInteger(value: number | undefined, fallback: number, error: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(error);
  return resolved;
}

function validateUrl(value: string, cookieOrigin = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(cookieOrigin ? 'NATIVE_HTTP_COOKIE_ORIGIN_INVALID' : 'NATIVE_HTTP_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error(cookieOrigin ? 'NATIVE_HTTP_COOKIE_ORIGIN_INVALID' : 'NATIVE_HTTP_URL_INVALID');
  }
  if (url.username || url.password) throw new Error('NATIVE_HTTP_URL_CREDENTIALS_FORBIDDEN');
  return url;
}

function validateHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw new Error('NATIVE_HTTP_HEADER_INVALID');
    }
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'cookie') throw new Error('NATIVE_HTTP_COOKIE_HEADER_FORBIDDEN');
    if (normalizedName === 'host' || normalizedName === 'proxy-authorization') throw new Error('NATIVE_HTTP_HEADER_FORBIDDEN');
    result[normalizedName] = value;
  }
  return result;
}

function requestBody(data: NativeHttpRequestBody | undefined): { body?: string | Buffer } | undefined {
  if (data === undefined) return undefined;
  if (typeof data === 'string') return { body: data };
  if (data instanceof URLSearchParams) return { body: data.toString() };
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return { body: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
  }
  throw new Error('NATIVE_HTTP_BODY_UNSUPPORTED');
}

function targetUrl(rawUrl: string, params: NativeHttpRequestOptions['params']): URL {
  const url = validateUrl(rawUrl);
  if (params instanceof URLSearchParams) {
    for (const [key, value] of params) url.searchParams.append(key, value);
  } else if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.append(key, String(value));
  }
  return url;
}

function flattenedHeaders(headers: readonly NativeHttpHeader[]): NativeHttpHeaders {
  const result: Record<string, string> = {};
  for (const { name, value } of headers) {
    const key = name.toLowerCase();
    if (result[key] === undefined) result[key] = value;
    else if (key !== 'set-cookie') result[key] += `, ${value}`;
  }
  return Object.freeze(result);
}

function responseMetadata(response: CycleTlsDriverResponse): {
  status: number;
  headers: readonly NativeHttpHeader[];
  flattened: NativeHttpHeaders;
} {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new Error('NATIVE_HTTP_STATUS_INVALID');
  }
  if ([408, 502, 503].includes(response.status) && response.headers.length === 0) {
    throw new Error(`NATIVE_HTTP_TRANSPORT_FAILURE_${response.status}`);
  }
  const headers = Object.freeze(response.headers.map(header => Object.freeze({ ...header })));
  return { status: response.status, headers, flattened: flattenedHeaders(headers) };
}

function bufferedResponse(response: CycleTlsDriverResponse, maxBytes: number): NativeHttpResponse {
  if (!Buffer.isBuffer(response.body)) throw new Error('NATIVE_HTTP_BUFFER_BODY_INVALID');
  if (response.body.length > maxBytes) throw new Error('NATIVE_HTTP_RESPONSE_TOO_LARGE');
  const metadata = responseMetadata(response);
  let body = Buffer.from(response.body);
  return {
    status: () => metadata.status,
    ok: () => metadata.status >= 200 && metadata.status < 300,
    headers: () => metadata.flattened,
    headersArray: () => metadata.headers,
    body: async () => Buffer.from(body),
    text: async () => body.toString('utf8'),
    json: async () => JSON.parse(body.toString('utf8')) as unknown,
    dispose: async () => { body = Buffer.alloc(0); }
  };
}

function streamResponse(
  response: CycleTlsDriverResponse,
  maxBytes: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  quarantine: (error: Error) => void,
  register: (dispose: () => Promise<void>) => void,
  unregister: (dispose: () => Promise<void>) => void
): NativeHttpStreamResponse {
  if (Buffer.isBuffer(response.body)) throw new Error('NATIVE_HTTP_STREAM_BODY_INVALID');
  const metadata = responseMetadata(response);
  const source = response.body;
  let disposed = false;
  let terminalError: Error | undefined;
  let waitingReject: ((error: Error) => void) | undefined;
  let seen = 0;
  const contentLengthValue = metadata.flattened['content-length'];
  const contentLength = contentLengthValue === undefined ? undefined : Number(contentLengthValue);
  const verifyContentLength = metadata.flattened['content-encoding'] === undefined && contentLength !== undefined;
  if (verifyContentLength && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
    throw new Error('NATIVE_HTTP_CONTENT_LENGTH_INVALID');
  }
  const fail = (error: Error) => {
    if (terminalError || disposed) return;
    terminalError = error;
    disposed = true;
    void response.dispose?.().catch(() => undefined);
    waitingReject?.(error);
    quarantine(error);
  };
  const abort = () => fail(new Error('NATIVE_HTTP_ABORTED'));
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => fail(new Error('NATIVE_HTTP_TIMEOUT')), timeoutMs);
  const dispose = async (): Promise<void> => {
    try {
      if (!disposed) {
        disposed = true;
        const error = new Error('NATIVE_HTTP_STREAM_CLOSED');
        terminalError = error;
        waitingReject?.(error);
        await response.dispose?.();
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      unregister(dispose);
    }
  };
  register(dispose);
  return {
    status: () => metadata.status,
    ok: () => metadata.status >= 200 && metadata.status < 300,
    headers: () => metadata.flattened,
    headersArray: () => metadata.headers,
    body: {
      async *[Symbol.asyncIterator]() {
        if (terminalError) throw terminalError;
        if (disposed) throw new Error('NATIVE_HTTP_STREAM_CLOSED');
        const iterator = source[Symbol.asyncIterator]();
        try {
          while (true) {
            const cancellation = new Promise<never>((_resolve, reject) => { waitingReject = reject; });
            const next = await Promise.race([iterator.next(), cancellation]);
            waitingReject = undefined;
            if (terminalError) throw terminalError;
            if (next.done) break;
            const chunk = next.value;
            seen += chunk.length;
            if (seen > maxBytes) {
              const error = new Error('NATIVE_HTTP_RESPONSE_TOO_LARGE');
              fail(error);
              throw error;
            }
            yield Buffer.from(chunk);
          }
          if (terminalError) throw terminalError;
          if (!disposed && verifyContentLength && seen !== contentLength) {
            const error = new Error('NATIVE_HTTP_STREAM_TRUNCATED');
            fail(error);
            throw error;
          }
        } finally {
          waitingReject = undefined;
          await dispose();
        }
      }
    },
    dispose
  };
}

async function seedInitialCookies(jar: CookieJar, initialCookie: CycleTlsContextOptions['initialCookie']): Promise<void> {
  if (!initialCookie) return;
  if (/\r|\n|\0/.test(initialCookie.header)) throw new Error('NATIVE_HTTP_COOKIE_INVALID');
  const origin = validateUrl(initialCookie.origin, true);
  const path = origin.pathname === '/' ? '/' : origin.pathname.replace(/\/$/, '');
  const pairs = initialCookie.header.split(';').map(value => value.trim()).filter(Boolean);
  if (pairs.length === 0) throw new Error('NATIVE_HTTP_COOKIE_INVALID');
  for (const pair of pairs) {
    if (!/^[^=;\s]+=[^;]*$/.test(pair)) throw new Error('NATIVE_HTTP_COOKIE_INVALID');
    await jar.setCookie(`${pair}; Path=${path}`, origin.toString());
  }
}

async function seedInitialResponseCookies(
  jar: CookieJar,
  entries: CycleTlsContextOptions['initialResponseCookies']
): Promise<void> {
  if (entries === undefined) return;
  if (!Array.isArray(entries)) throw new Error('NATIVE_HTTP_COOKIE_INVALID');
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.setCookieHeaders)) {
      throw new Error('NATIVE_HTTP_COOKIE_INVALID');
    }
    const url = validateUrl(entry.url, true);
    let now: Date | undefined;
    if (entry.receivedAt !== undefined) {
      if (typeof entry.receivedAt !== 'number' || !Number.isSafeInteger(entry.receivedAt)) {
        throw new Error('NATIVE_HTTP_COOKIE_RECEIVED_AT_INVALID');
      }
      now = new Date(entry.receivedAt);
      if (Number.isNaN(now.getTime())) {
        throw new Error('NATIVE_HTTP_COOKIE_RECEIVED_AT_INVALID');
      }
    }
    for (const header of entry.setCookieHeaders) {
      if (typeof header !== 'string' || /[\r\n\0]/.test(header)) throw new Error('NATIVE_HTTP_COOKIE_INVALID');
      try {
        await jar.setCookie(header, url.toString(), { ignoreError: false, ...(now ? { now } : {}) });
      } catch {
        throw new Error('NATIVE_HTTP_COOKIE_INVALID');
      }
    }
  }
}

async function applyResponseCookies(jar: CookieJar, response: CycleTlsDriverResponse, requestUrl: string): Promise<void> {
  const cookieUrl = validateUrl(response.finalUrl || requestUrl);
  for (const header of response.headers) {
    if (header.name.toLowerCase() !== 'set-cookie') continue;
    await jar.setCookie(header.value, cookieUrl.toString(), { ignoreError: false });
  }
}

export async function createCycleTlsContext(
  options: CycleTlsContextOptions,
  dependencies: CycleTlsContextDependencies = {}
): Promise<NativeHttpContext> {
  const proxy = validatedCycleTlsProxy(options.proxy, 'NATIVE_HTTP_PROXY_INVALID');
  const tls = validatedCycleTlsFingerprintOptions(options.tls);
  if (options.initialCookie !== undefined && options.initialResponseCookies !== undefined) {
    throw new Error('NATIVE_HTTP_COOKIE_SEED_AMBIGUOUS');
  }
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'NATIVE_HTTP_TIMEOUT_INVALID');
  const startupTimeoutMs = positiveInteger(options.startupTimeoutMs, 10_000, 'NATIVE_HTTP_STARTUP_TIMEOUT_INVALID');
  const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 'NATIVE_HTTP_MAX_BYTES_INVALID');
  const jar = new CookieJar();
  await seedInitialCookies(jar, options.initialCookie);
  await seedInitialResponseCookies(jar, options.initialResponseCookies);
  const createDriver = dependencies.createDriver ?? createCycleTlsDriver;
  let driverPromise: Promise<CycleTlsDriver> | undefined;
  let closed = false;
  let closeReason: Error | undefined;
  let closePromise: Promise<void> | undefined;
  const pending = new Set<PendingRequest>();
  const activeStreams = new Set<() => Promise<void>>();
  let jarTail = Promise.resolve();

  const serializeJarOperation = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = jarTail.then(operation);
    jarTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const driver = (): Promise<CycleTlsDriver> => {
    if (closed) throw new Error('NATIVE_HTTP_CONTEXT_CLOSED');
    driverPromise ??= createDriver({
      proxy,
      startupTimeoutMs,
      requestTimeoutMs: timeoutMs,
      tls
    });
    return driverPromise;
  };

  const close = (reason = new Error('NATIVE_HTTP_CONTEXT_CLOSED')): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closeReason = reason;
    closePromise = (async () => {
      for (const operation of [...pending]) operation.reject(reason);
      pending.clear();
      let cleanupFailed = false;
      const streamResults = await Promise.allSettled([...activeStreams].map(dispose => dispose()));
      if (streamResults.some(result => result.status === 'rejected')) cleanupFailed = true;
      activeStreams.clear();
      try {
        await serializeJarOperation(() => jar.removeAllCookiesSync());
      } catch {
        cleanupFailed = true;
      }
      if (driverPromise) {
        try {
          await (await driverPromise).dispose();
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) throw new Error('NATIVE_HTTP_CLEANUP_UNCONFIRMED');
    })();
    return closePromise;
  };

  const dispatch = async (
    rawUrl: string,
    requestOptions: NativeHttpRequestOptions = {},
    stream = false
  ): Promise<{ response: CycleTlsDriverResponse; maxBytes: number; remainingTimeoutMs: number }> => {
    if (closed) throw new Error('NATIVE_HTTP_CONTEXT_CLOSED');
    const url = targetUrl(rawUrl, requestOptions.params);
    assertCycleTlsProxyForTarget(url, proxy);
    const headers = validateHeaders(requestOptions.headers);
    const body = requestBody(requestOptions.data) ?? {};
    if (requestOptions.maxRedirects !== undefined && requestOptions.maxRedirects !== 0) throw new Error('NATIVE_HTTP_REDIRECTS_UNSUPPORTED');
    if (requestOptions.maxRetries !== undefined && requestOptions.maxRetries !== 0) throw new Error('NATIVE_HTTP_RETRIES_UNSUPPORTED');
    const requestTimeout = positiveInteger(requestOptions.timeout, timeoutMs, 'NATIVE_HTTP_TIMEOUT_INVALID');
    const maxBytes = positiveInteger(requestOptions.maxBytes, maxResponseBytes, 'NATIVE_HTTP_MAX_BYTES_INVALID');
    const method = (requestOptions.method ?? 'GET').toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new Error('NATIVE_HTTP_METHOD_INVALID');
    if (requestOptions.signal?.aborted) throw new Error('NATIVE_HTTP_ABORTED');
    const cookie = await serializeJarOperation(() => jar.getCookieString(url.toString()));
    if (closed || requestOptions.signal?.aborted) {
      void close(new Error('NATIVE_HTTP_ABORTED'));
      throw new Error('NATIVE_HTTP_ABORTED');
    }
    if (cookie) headers.cookie = cookie;
    const nativeRequest: CycleTlsDriverRequest = {
      url: url.toString(),
      method,
      headers,
      ...body,
      timeoutMs: requestTimeout,
      stream,
      signal: requestOptions.signal,
      maxBytes
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let settleReject: ((error: Error) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      settleReject = reject;
      abortHandler = () => {
        const error = new Error('NATIVE_HTTP_ABORTED');
        void close(error).catch(() => undefined);
        reject(error);
      };
      requestOptions.signal?.addEventListener('abort', abortHandler, { once: true });
      timer = setTimeout(() => {
        const error = new Error('NATIVE_HTTP_TIMEOUT');
        void close(error).catch(() => undefined);
        reject(error);
      }, requestTimeout);
    });
    const operation: PendingRequest = { reject: error => settleReject?.(error) };
    pending.add(operation);
    let result: CycleTlsDriverResponse | undefined;
    try {
      const startedAt = Date.now();
      const nativeOperation = driver().then(nativeDriver => {
        if (closed || requestOptions.signal?.aborted) throw new Error('NATIVE_HTTP_ABORTED');
        return nativeDriver.request(nativeRequest);
      });
      result = await Promise.race([nativeOperation, cancellation]);
      if (closed || requestOptions.signal?.aborted) throw closeReason ?? new Error('NATIVE_HTTP_ABORTED');
      const finalUrl = validateUrl(result.finalUrl);
      if (finalUrl.toString() !== url.toString()) throw new Error('NATIVE_HTTP_UNEXPECTED_FINAL_URL');
      await serializeJarOperation(() => applyResponseCookies(jar, result!, nativeRequest.url));
      if (closed || requestOptions.signal?.aborted) throw closeReason ?? new Error('NATIVE_HTTP_ABORTED');
      return { response: result, maxBytes, remainingTimeoutMs: Math.max(1, requestTimeout - (Date.now() - startedAt)) };
    } catch (error) {
      if (result) {
        const reason = error instanceof Error ? error : new Error('NATIVE_HTTP_RESPONSE_INVALID');
        const cleanup = close(reason);
        await Promise.allSettled([result.dispose?.(), cleanup]);
      }
      if (requestOptions.signal?.aborted || (error instanceof Error && error.message === 'NATIVE_HTTP_TIMEOUT')) {
        void close(new Error(requestOptions.signal?.aborted ? 'NATIVE_HTTP_ABORTED' : 'NATIVE_HTTP_TIMEOUT')).catch(() => undefined);
      }
      throw error;
    } finally {
      pending.delete(operation);
      if (timer) clearTimeout(timer);
      if (abortHandler) requestOptions.signal?.removeEventListener('abort', abortHandler);
    }
  };

  return {
    transport: 'cycletls',
    async fetch(url, requestOptions) {
      const { response, maxBytes } = await dispatch(url, requestOptions);
      try {
        return bufferedResponse(response, maxBytes);
      } catch (error) {
        const cleanup = close(error instanceof Error ? error : new Error('NATIVE_HTTP_RESPONSE_INVALID'));
        await Promise.allSettled([response.dispose?.(), cleanup]);
        throw error;
      }
    },
    async get(url, requestOptions) {
      const { response, maxBytes } = await dispatch(url, { ...requestOptions, method: 'GET' });
      try {
        return bufferedResponse(response, maxBytes);
      } catch (error) {
        const cleanup = close(error instanceof Error ? error : new Error('NATIVE_HTTP_RESPONSE_INVALID'));
        await Promise.allSettled([response.dispose?.(), cleanup]);
        throw error;
      }
    },
    async stream(url, requestOptions) {
      const { response, maxBytes, remainingTimeoutMs } = await dispatch(url, requestOptions, true);
      try {
        return streamResponse(
          response,
          maxBytes,
          requestOptions?.signal,
          remainingTimeoutMs,
          error => { void close(error).catch(() => undefined); },
          dispose => activeStreams.add(dispose),
          dispose => activeStreams.delete(dispose)
        );
      } catch (error) {
        const cleanup = close(error instanceof Error ? error : new Error('NATIVE_HTTP_RESPONSE_INVALID'));
        await Promise.allSettled([response.dispose?.(), cleanup]);
        throw error;
      }
    },
    dispose: close
  };
}
