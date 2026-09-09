import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountHttpSession } from '../accountSession';
import { createHttpOnlyTransport } from '../httpOnlyTransport';
import type {
  NativeHttpContext,
  NativeHttpRequestOptions,
  NativeHttpResponse,
  NativeHttpStreamResponse
} from '../nativeHttpContext';

function response(value: unknown, headers: Readonly<Record<string, string>> = {}): NativeHttpResponse {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return {
    status: () => 200,
    ok: () => true,
    headers: () => headers,
    headersArray: () => Object.entries(headers).map(([name, headerValue]) => ({ name, value: headerValue })),
    body: async () => Buffer.from(bytes),
    text: async () => bytes.toString('utf8'),
    json: async () => JSON.parse(bytes.toString('utf8')) as unknown,
    dispose: vi.fn(async () => undefined)
  };
}

function streamResponse(chunks: readonly Buffer[], headers: Readonly<Record<string, string>> = {}): NativeHttpStreamResponse {
  return {
    status: () => 200,
    ok: () => true,
    headers: () => headers,
    headersArray: () => Object.entries(headers).map(([name, value]) => ({ name, value })),
    body: (async function* () { yield* chunks; })(),
    dispose: vi.fn(async () => undefined)
  };
}

function context(overrides: Partial<NativeHttpContext> = {}): NativeHttpContext {
  return {
    transport: 'cycletls',
    fetch: vi.fn(async () => response({ ok: true })),
    get: vi.fn(async () => response({ ok: true })),
    stream: vi.fn(async () => streamResponse([])),
    dispose: vi.fn(async () => undefined),
    ...overrides
  };
}

function client(native = context(), headers: Record<string, string> = {}, origin = 'https://www.capcut.com') {
  const session = createAccountHttpSession({ accountId: 'a', origin, proxy: { server: 'http://127.0.0.1:9' }, context: native, headers });
  return { native, transport: createHttpOnlyTransport(session) };
}

beforeEach(() => vi.clearAllMocks());

describe('HTTP-only native transport', () => {
  it('serializes JSON once and preserves form encoding', async () => {
    const calls: NativeHttpRequestOptions[] = [];
    const native = context({ fetch: vi.fn(async (_url, options) => { calls.push(options ?? {}); return response({ ok: true }); }) });
    const transport = client(native).transport;
    await transport.requestJson({ path: '/json', method: 'POST', body: { scene: 'capcut_web_task' }, effect: 'read' });
    await transport.requestJson({ path: '/wire', method: 'POST', body: '{"scene":"capcut_web_task"}', effect: 'read' });
    await transport.requestForm({ path: '/form', form: { hashed_id: 'synthetic+value', type: 1 }, effect: 'read' });
    expect(calls.map(call => call.data)).toEqual([
      '{"scene":"capcut_web_task"}',
      '{"scene":"capcut_web_task"}',
      new URLSearchParams('hashed_id=synthetic%2Bvalue&type=1')
    ]);
  });

  it('uses only origin-bound headers and rejects ambiguous paths before dispatch', async () => {
    const native = context();
    const transport = client(native, { authorization: 'Bearer synthetic', sign: 'synthetic' }).transport;
    await transport.requestJson({ origin: 'https://edit-api-sg.capcut.com', path: '/read' });
    expect(vi.mocked(native.fetch).mock.calls[0][1]?.headers).toEqual({});
    for (const path of ['//other.test/path', '/\\other.test/path', '/path#fragment', '/path\n']) {
      await expect(transport.requestJson({ path })).rejects.toThrow('CAPCUT_HTTP_PATH_INVALID');
    }
    expect(native.fetch).toHaveBeenCalledOnce();
  });

  it('rejects host, proxy authorization, and raw cookie headers before dispatch', async () => {
    for (const headers of [
      { host: 'other.test' },
      { 'proxy-authorization': 'synthetic' },
      { cookie: 'sid=stale' },
      { 'bad name': 'value' },
      { authorization: 'Bearer synthetic\r\ninjected: yes' }
    ] as Record<string, string>[]) {
      const { native, transport } = client(context(), headers);
      await expect(transport.requestJson({ path: '/read' })).rejects.toThrow('CAPCUT_HTTP_HEADER_INVALID');
      expect(native.fetch).not.toHaveBeenCalled();
    }
  });

  it('maps malformed JSON and native byte limits without retrying reads', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('not-json'))
      .mockRejectedValueOnce(new Error('NATIVE_HTTP_RESPONSE_TOO_LARGE'));
    const transport = client(context({ fetch })).transport;
    await expect(transport.requestJson({ path: '/invalid' })).rejects.toThrow('CAPCUT_HTTP_INVALID_JSON');
    await expect(transport.requestJson({ path: '/large' })).rejects.toThrow('CAPCUT_HTTP_BODY_TOO_LARGE');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('maps any dispatched mutation failure to unknown without retry', async () => {
    const fetch = vi.fn(async () => { throw new Error('NATIVE_HTTP_TIMEOUT'); });
    const transport = client(context({ fetch })).transport;
    await expect(transport.requestJson({ path: '/write', method: 'POST', body: '{}', effect: 'mutation' })).rejects.toThrow('CAPCUT_HTTP_OUTCOME_UNKNOWN');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('dispatches a bounded stream through the native context and accepts Set-Cookie metadata', async () => {
    const stream = vi.fn(async () => streamResponse(
      [Buffer.from('data: one\n\n'), Buffer.from('data: two\n\n')],
      { 'content-type': 'text/event-stream', 'set-cookie': 'sid=rotated; Path=/' }
    ));
    const transport = client(context({ stream })).transport;
    const result = await transport.requestStream({ path: '/events', method: 'POST', effect: 'read', deadlineMs: 1_000, maxBytes: 64 });
    const received: Buffer[] = [];
    for await (const chunk of result.body) received.push(Buffer.from(chunk));
    expect(Buffer.concat(received).toString()).toBe('data: one\n\ndata: two\n\n');
    expect(stream).toHaveBeenCalledWith('https://www.capcut.com/events', expect.objectContaining({
      method: 'POST', timeout: 1_000, maxBytes: 64, maxRedirects: 0, maxRetries: 0
    }));
  });

  it('preserves stream cancellation and mutation uncertainty', async () => {
    const controller = new AbortController();
    const stream = vi.fn(async (_url: string, options?: NativeHttpRequestOptions) => ({
      ...streamResponse([]),
      body: (async function* () {
        await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
        yield Buffer.alloc(0);
      })()
    }));
    const transport = client(context({ stream })).transport;
    const result = await transport.requestStream({ path: '/write', method: 'POST', effect: 'mutation', signal: controller.signal });
    controller.abort();
    await expect((async () => { for await (const _chunk of result.body) { /* consume */ } })()).rejects.toThrow('CAPCUT_HTTP_OUTCOME_UNKNOWN');
  });

  it('rejects invalid stream limits before native dispatch', async () => {
    const { native, transport } = client();
    await expect(transport.requestStream({ path: '/events', maxBytes: 0 })).rejects.toThrow('CAPCUT_HTTP_STREAM_LIMIT_INVALID');
    await expect(transport.requestStream({ path: '/events', deadlineMs: 0 })).rejects.toThrow('CAPCUT_HTTP_DEADLINE_INVALID');
    expect(native.stream).not.toHaveBeenCalled();
  });
});
