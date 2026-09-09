import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CookieJar } from 'tough-cookie';
import {
  createCycleTlsContext,
  type CycleTlsContextDependencies
} from '../cycleTlsContext';
import type {
  CycleTlsDriver,
  CycleTlsDriverRequest,
  CycleTlsDriverResponse
} from '../cycleTlsRuntime';

class FakeDriver implements CycleTlsDriver {
  readonly requests: CycleTlsDriverRequest[] = [];
  disposed = false;

  constructor(
    private readonly respond: (request: CycleTlsDriverRequest) => Promise<CycleTlsDriverResponse>
  ) {}

  async request(request: CycleTlsDriverRequest): Promise<CycleTlsDriverResponse> {
    this.requests.push(request);
    const result = await this.respond(request);
    return result.finalUrl ? result : { ...result, finalUrl: request.url };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

function dependencies(
  driver: FakeDriver,
  createDriver: CycleTlsContextDependencies['createDriver'] = vi.fn(async () => driver)
): CycleTlsContextDependencies {
  return { createDriver };
}

function response(overrides: Partial<CycleTlsDriverResponse> = {}): CycleTlsDriverResponse {
  return {
    status: 200,
    headers: [],
    body: Buffer.from('ok'),
    finalUrl: '',
    ...overrides
  };
}

describe('createCycleTlsContext cookie and request policy', () => {
  it.each([
    ['get', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.get('https://www.capcut.com/')],
    ['form', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.fetch('https://login-row.www.capcut.com/passport/web/region/', {
      method: 'POST', data: new URLSearchParams({ type: '1' })
    })],
    ['stream', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.stream('https://edit-api-sg.capcut.com/events')]
  ])('rejects a direct CapCut %s before native driver startup', async (_mode, request) => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);
    const context = await createCycleTlsContext({}, dependencies(driver, createDriver));

    await expect(request(context)).rejects.toThrow('CYCLETLS_CAPCUT_PROXY_REQUIRED');
    expect(createDriver).not.toHaveBeenCalled();
    expect(driver.requests).toHaveLength(0);
    await context.dispose();
  });

  it.each([
    ['get', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.get('https://capcut.com./')],
    ['form', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.fetch('https://login-row.www.capcut.com./passport/web/region/', {
      method: 'POST', data: new URLSearchParams({ type: '1' })
    })],
    ['stream', (context: Awaited<ReturnType<typeof createCycleTlsContext>>) => context.stream('https://edit-api-sg.capcutapi.com../events')]
  ])('rejects a trailing-dot direct CapCut %s before native driver startup', async (_mode, request) => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);
    const context = await createCycleTlsContext({}, dependencies(driver, createDriver));

    await expect(request(context)).rejects.toThrow('CYCLETLS_CAPCUT_PROXY_REQUIRED');
    expect(createDriver).not.toHaveBeenCalled();
    expect(driver.requests).toHaveLength(0);
    await context.dispose();
  });

  it('accepts a bare SOCKS proxy URL whose parsed pathname is empty', async () => {
    const driver = new FakeDriver(async request => response({ finalUrl: request.url }));
    const createDriver: NonNullable<CycleTlsContextDependencies['createDriver']> = vi.fn(async () => driver);
    const context = await createCycleTlsContext({
      proxy: { server: 'socks5://proxy.example.test:1080' }
    }, dependencies(driver, createDriver));

    expect((await context.get('https://example.test/')).status()).toBe(200);
    expect(vi.mocked(createDriver).mock.calls[0]![0].proxy).toEqual({
      server: 'socks5://proxy.example.test:1080'
    });
    await context.dispose();
  });

  it('clones and freezes the validated proxy and TLS route for the account lifetime', async () => {
    const proxy = { server: 'http://proxy.example.test:8080', username: 'account-a', password: 'synthetic' };
    const tls = { forceHTTP1: true, userAgent: 'synthetic-agent' };
    const driver = new FakeDriver(async request => response({ finalUrl: request.url }));
    const createDriver: NonNullable<CycleTlsContextDependencies['createDriver']> = vi.fn(async () => driver);
    const context = await createCycleTlsContext({ proxy, tls }, dependencies(driver, createDriver));
    proxy.server = 'http://other.example.test:9090';
    proxy.username = 'account-b';
    tls.forceHTTP1 = false;
    tls.userAgent = 'changed-agent';

    await context.get('https://www.capcut.com/');

    const captured = vi.mocked(createDriver).mock.calls[0]![0];
    expect(captured.proxy).toEqual({
      server: 'http://proxy.example.test:8080', username: 'account-a', password: 'synthetic'
    });
    expect(captured.tls).toEqual({ forceHTTP1: true, userAgent: 'synthetic-agent' });
    expect(Object.isFrozen(captured.proxy)).toBe(true);
    expect(Object.isFrozen(captured.tls)).toBe(true);
    await context.dispose();
  });

  it('does not retry a failed proxied CapCut request or fall back to direct transport', async () => {
    const driver = new FakeDriver(async () => { throw new Error('KIOT_PROXY_FAILED'); });
    const context = await createCycleTlsContext({
      proxy: { server: 'http://proxy.example.test:8080', username: 'account-a', password: 'synthetic' }
    }, dependencies(driver));

    await expect(context.get('https://www.capcut.com/')).rejects.toThrow('KIOT_PROXY_FAILED');
    expect(driver.requests).toHaveLength(1);
    await context.dispose();
  });

  it('isolates a valid proxied CapCut context from a sibling missing its proxy', async () => {
    const proxiedDriver = new FakeDriver(async request => response({ finalUrl: request.url }));
    const directDriver = new FakeDriver(async request => response({ finalUrl: request.url }));
    const proxied = await createCycleTlsContext({
      proxy: { server: 'http://proxy.example.test:8080' }
    }, dependencies(proxiedDriver));
    const createDirectDriver = vi.fn(async () => directDriver);
    const direct = await createCycleTlsContext({}, dependencies(directDriver, createDirectDriver));

    await expect(direct.get('https://www.capcut.com/')).rejects.toThrow('CYCLETLS_CAPCUT_PROXY_REQUIRED');
    expect((await proxied.get('https://www.capcut.com/')).status()).toBe(200);
    expect(createDirectDriver).not.toHaveBeenCalled();
    expect(proxiedDriver.requests).toHaveLength(1);
    await Promise.all([direct.dispose(), proxied.dispose()]);
  });

  it('does not lose repeated Set-Cookie headers and rotated cookies replace the initial value', async () => {
    let call = 0;
    const driver = new FakeDriver(async request => {
      call += 1;
      if (call === 1) {
        expect(request.headers.cookie).toBe('sid=stale');
        return response({
          headers: [
            { name: 'Set-Cookie', value: 'sid=fresh; Path=/; HttpOnly' },
            { name: 'set-cookie', value: 'theme=dark; Path=/' }
          ]
        });
      }
      return response({ body: Buffer.from(request.headers.cookie ?? '') });
    });
    const context = await createCycleTlsContext({
      initialCookie: { header: 'sid=stale', origin: 'https://api.example.test/' }
    }, dependencies(driver));

    const first = await context.get('https://api.example.test/data');
    expect(first.headersArray()).toEqual([
      { name: 'Set-Cookie', value: 'sid=fresh; Path=/; HttpOnly' },
      { name: 'set-cookie', value: 'theme=dark; Path=/' }
    ]);
    const second = await context.get('https://api.example.test/data');
    expect(await second.text()).toBe('sid=fresh; theme=dark');
    await context.dispose();
  });

  it('does not leak cookies across domains or account contexts', async () => {
    const echo = () => new FakeDriver(async request => response({
      finalUrl: request.url,
      body: Buffer.from(request.headers.cookie ?? '')
    }));
    const driverA = echo();
    const driverB = echo();
    const accountA = await createCycleTlsContext({
      initialCookie: { header: 'sid=account-a', origin: 'https://api.example.test/private' }
    }, dependencies(driverA));
    const accountB = await createCycleTlsContext({}, dependencies(driverB));

    expect(await (await accountA.get('https://api.example.test/private')).text()).toBe('sid=account-a');
    expect(await (await accountA.get('https://upload.example.test/private')).text()).toBe('');
    expect(await (await accountB.get('https://api.example.test/private')).text()).toBe('');
    await Promise.all([accountA.dispose(), accountB.dispose()]);
  });

  it('honors cookie domain, path, and expiry rules', async () => {
    let call = 0;
    const driver = new FakeDriver(async request => {
      call += 1;
      if (call === 1) {
        return response({
          finalUrl: request.url,
          headers: [
            { name: 'set-cookie', value: 'scoped=one; Path=/private' },
            { name: 'set-cookie', value: 'expired=gone; Path=/; Max-Age=0' }
          ]
        });
      }
      return response({ finalUrl: request.url, body: Buffer.from(request.headers.cookie ?? '') });
    });
    const context = await createCycleTlsContext({
      initialCookie: { header: 'expired=old', origin: 'https://api.example.test/' }
    }, dependencies(driver));

    await context.get('https://api.example.test/private/rotate');
    expect(await (await context.get('https://api.example.test/private/check')).text()).toBe('scoped=one');
    expect(await (await context.get('https://api.example.test/public/check')).text()).toBe('');
    await context.dispose();
  });

  it('restores saved response cookies in order with their original domain, path, and expiry rules', async () => {
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      body: Buffer.from(request.headers.cookie ?? '')
    }));
    const context = await createCycleTlsContext({
      proxy: { server: 'http://proxy.example.test:8080' },
      initialResponseCookies: [
        {
          url: 'https://login-row.www.capcut.com/passport/web/email/register_verify_login/',
          receivedAt: Date.now(),
          setCookieHeaders: [
            'sid=first; Domain=.capcut.com; Path=/; HttpOnly',
            'passport_scope=row-only; Path=/passport',
            'retired=old; Domain=.capcut.com; Path=/'
          ]
        },
        {
          url: 'https://www.capcut.com/passport/web/account/info/',
          setCookieHeaders: [
            'sid=rotated; Domain=.capcut.com; Path=/; HttpOnly',
            'retired=gone; Domain=.capcut.com; Path=/; Max-Age=0'
          ]
        },
        {
          url: 'https://www.capcut.com/passport/web/account/info/',
          receivedAt: Date.now() - 120_000,
          setCookieHeaders: ['already_expired=gone; Domain=.capcut.com; Path=/; Max-Age=60']
        }
      ]
    }, dependencies(driver));

    expect(await (await context.get('https://www.capcut.com/passport/web/account/info/')).text()).toBe('sid=rotated');
    expect(await (await context.get('https://login-row.www.capcut.com/passport/check')).text())
      .toBe('passport_scope=row-only; sid=rotated');
    expect(await (await context.get('https://login.us.capcut.com/passport/check')).text()).toBe('sid=rotated');
    expect(await (await context.get('https://example.test/passport/check')).text()).toBe('');
    await context.dispose();
  });

  it.each([
    [{
      initialCookie: { header: 'sid=legacy', origin: 'https://www.capcut.com/' },
      initialResponseCookies: []
    }, 'NATIVE_HTTP_COOKIE_SEED_AMBIGUOUS'],
    [{
      initialResponseCookies: [{
        url: 'https://www.capcut.com/passport/web/account/info/',
        setCookieHeaders: ['sid=foreign; Domain=example.test; Path=/']
      }]
    }, 'NATIVE_HTTP_COOKIE_INVALID'],
    [{
      initialResponseCookies: [{
        url: 'https://www.capcut.com/passport/web/account/info/',
        setCookieHeaders: ['not a cookie']
      }]
    }, 'NATIVE_HTTP_COOKIE_INVALID'],
    [{
      initialResponseCookies: [{
        url: 'https://www.capcut.com/passport/web/account/info/',
        receivedAt: Number.NaN,
        setCookieHeaders: ['sid=value; Path=/']
      }]
    }, 'NATIVE_HTTP_COOKIE_RECEIVED_AT_INVALID'],
    [{
      initialResponseCookies: [{
        url: 'https://user:password@www.capcut.com/passport/web/account/info/',
        setCookieHeaders: ['sid=value; Path=/']
      }]
    }, 'NATIVE_HTTP_URL_CREDENTIALS_FORBIDDEN'],
    [{
      initialResponseCookies: [{
        url: '/relative',
        setCookieHeaders: ['sid=value; Path=/']
      }]
    }, 'NATIVE_HTTP_COOKIE_ORIGIN_INVALID'],
    [{
      initialResponseCookies: [{
        url: 'https://www.capcut.com/passport/web/account/info/',
        setCookieHeaders: ['sid=value; Path=/\r\nX-Bad: yes']
      }]
    }, 'NATIVE_HTTP_COOKIE_INVALID']
  ])('rejects invalid response-cookie seed state before native spawn', async (options, message) => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);

    await expect(createCycleTlsContext(options, dependencies(driver, createDriver))).rejects.toThrow(message);
    expect(createDriver).not.toHaveBeenCalled();
    expect(driver.requests).toHaveLength(0);
  });

  it('does not send a Secure cookie over HTTP', async () => {
    let call = 0;
    const driver = new FakeDriver(async request => {
      call += 1;
      if (call === 1) {
        return response({
          finalUrl: request.url,
          headers: [{ name: 'set-cookie', value: 'secure=value; Path=/; Secure' }]
        });
      }
      return response({ finalUrl: request.url, body: Buffer.from(request.headers.cookie ?? '') });
    });
    const context = await createCycleTlsContext({}, dependencies(driver));
    await context.get('https://api.example.test/rotate');
    expect(await (await context.get('http://api.example.test/check')).text()).toBe('');
    await context.dispose();
  });

  it('does not retry a dispatched mutation', async () => {
    const driver = new FakeDriver(async () => {
      throw new Error('wire closed after dispatch');
    });
    const context = await createCycleTlsContext({}, dependencies(driver));

    await expect(context.fetch('https://api.example.test/mutate', {
      method: 'POST',
      data: '{"op":"synthetic"}',
      maxRetries: 0
    })).rejects.toThrow('wire closed after dispatch');
    expect(driver.requests).toHaveLength(1);
    await expect(context.fetch('https://api.example.test/mutate', {
      method: 'POST',
      data: '{"op":"synthetic"}',
      maxRetries: 4
    })).rejects.toThrow('NATIVE_HTTP_RETRIES_UNSUPPORTED');
    expect(driver.requests).toHaveLength(1);
    await context.dispose();
  });

  it('accepts a cookie refresh from stream headers before yielding the stream', async () => {
    let call = 0;
    const driver = new FakeDriver(async request => {
      call += 1;
      if (call === 1) {
        return response({
          finalUrl: request.url,
          headers: [{ name: 'Set-Cookie', value: 'sid=stream-fresh; Path=/' }],
          body: Readable.from([Buffer.from('a'), Buffer.from('b')])
        });
      }
      return response({ finalUrl: request.url, body: Buffer.from(request.headers.cookie ?? '') });
    });
    const context = await createCycleTlsContext({}, dependencies(driver));

    const streamed = await context.stream('https://api.example.test/events');
    const chunks: Buffer[] = [];
    for await (const chunk of streamed.body) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('ab');
    expect(await (await context.get('https://api.example.test/check')).text()).toBe('sid=stream-fresh');
    await context.dispose();
  });

  it('aborts a pre-header request, quarantines only that context, and rejects later requests', async () => {
    const driver = new FakeDriver(() => new Promise(() => undefined));
    const otherDriver = new FakeDriver(async request => response({ finalUrl: request.url }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const other = await createCycleTlsContext({}, dependencies(otherDriver));
    const abort = new AbortController();
    const pending = context.get('https://api.example.test/hang', { signal: abort.signal });

    await vi.waitFor(() => expect(driver.requests).toHaveLength(1));
    abort.abort();
    await expect(pending).rejects.toThrow('NATIVE_HTTP_ABORTED');
    expect(driver.disposed).toBe(true);
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
    expect((await other.get('https://api.example.test/ready')).status()).toBe(200);
    await other.dispose();
  });

  it.each([
    ['bad path', 'not a URL', {}, 'NATIVE_HTTP_URL_INVALID'],
    ['credential target', 'https://user:pass@example.test/', {}, 'NATIVE_HTTP_URL_CREDENTIALS_FORBIDDEN'],
    ['bad headers', 'https://api.example.test/', { headers: { x: 'ok\r\nbad: value' } }, 'NATIVE_HTTP_HEADER_INVALID']
  ])('rejects %s before native spawn', async (_name, url, requestOptions, message) => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);
    const context = await createCycleTlsContext({}, dependencies(driver, createDriver));
    await expect(context.get(url, requestOptions)).rejects.toThrow(message);
    expect(createDriver).not.toHaveBeenCalled();
    expect(driver.requests).toHaveLength(0);
    await context.dispose();
  });

  it.each([
    [{ proxy: { server: 'not-a-proxy' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://user:password@proxy.example.test:8080' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://proxy.example.test:8080/route' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://proxy.example.test:8080/?route=one' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://proxy.example.test:8080/#route' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://proxy.example.test:8080/\r\n' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ proxy: { server: 'http://proxy.example.test:8080', username: 'account\r\nbad' } }, 'NATIVE_HTTP_PROXY_INVALID'],
    [{ initialCookie: { header: 'sid=x\r\nX-Bad: yes', origin: 'https://api.example.test/' } }, 'NATIVE_HTTP_COOKIE_INVALID'],
    [{ initialCookie: { header: 'sid=x', origin: '/relative' } }, 'NATIVE_HTTP_COOKIE_ORIGIN_INVALID']
  ])('rejects invalid context options before native spawn', async (options, message) => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);
    await expect(createCycleTlsContext(options, dependencies(driver, createDriver))).rejects.toThrow(message);
    expect(createDriver).not.toHaveBeenCalled();
  });

  it('rejects an oversized response before parsing it', async () => {
    const driver = new FakeDriver(async () => response({ body: Buffer.alloc(9, 1) }));
    const context = await createCycleTlsContext({ maxResponseBytes: 8 }, dependencies(driver));
    const result = context.get('https://api.example.test/large');
    await expect(result).rejects.toThrow('NATIVE_HTTP_RESPONSE_TOO_LARGE');
    await context.dispose();
  });

  it('does not falsely accept malformed JSON', async () => {
    const driver = new FakeDriver(async () => response({ body: Buffer.from('{broken') }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const result = await context.get('https://api.example.test/json');
    await expect(result.json()).rejects.toBeInstanceOf(SyntaxError);
    await context.dispose();
  });

  it('passes binary request bytes through a lossless base64 driver field', async () => {
    const driver = new FakeDriver(async request => response({
      body: Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? '')
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const result = await context.fetch('https://api.example.test/upload', {
      method: 'POST',
      data: Buffer.from([0xff, 0x00])
    });
    expect(await result.body()).toEqual(Buffer.from([0xff, 0x00]));
    expect(driver.requests).toHaveLength(1);
    await context.dispose();
  });

  it.each([408, 502, 503])('classifies metadata-free native status %s as transport failure', async status => {
    const driver = new FakeDriver(async () => response({ status, headers: [] }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await expect(context.get('https://api.example.test/unavailable')).rejects.toThrow(`NATIVE_HTTP_TRANSPORT_FAILURE_${status}`);
    await context.dispose();
  });

  it('settles sibling pending operations and ignores late response cookies after quarantine', async () => {
    let resolveLate: ((value: CycleTlsDriverResponse) => void) | undefined;
    const driver = new FakeDriver(request => new Promise(resolve => {
      if (request.url.endsWith('/late')) resolveLate = resolve;
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const firstAbort = new AbortController();
    const first = context.get('https://api.example.test/abort', { signal: firstAbort.signal });
    const late = context.get('https://api.example.test/late');
    await vi.waitFor(() => expect(driver.requests).toHaveLength(2));
    const firstRejected = expect(first).rejects.toThrow('NATIVE_HTTP_ABORTED');
    const lateRejected = expect(late).rejects.toThrow('NATIVE_HTTP_ABORTED');
    firstAbort.abort();
    await Promise.all([firstRejected, lateRejected]);
    resolveLate?.(response({
      finalUrl: 'https://api.example.test/late',
      headers: [{ name: 'set-cookie', value: 'sid=too-late; Path=/' }]
    }));
    await expect(context.get('https://api.example.test/check')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it.each(['host', 'proxy-authorization'])('rejects the unsafe %s header before spawn', async header => {
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(async () => driver);
    const context = await createCycleTlsContext({}, dependencies(driver, createDriver));
    await expect(context.get('https://api.example.test/', {
      headers: { [header]: 'synthetic' }
    })).rejects.toThrow('NATIVE_HTTP_HEADER_FORBIDDEN');
    expect(createDriver).not.toHaveBeenCalled();
    await context.dispose();
  });

  it('does not dispatch after abort wins a native startup race', async () => {
    let release: ((value: CycleTlsDriver) => void) | undefined;
    const driver = new FakeDriver(async () => response());
    const createDriver = vi.fn(() => new Promise<CycleTlsDriver>(resolve => { release = resolve; }));
    const context = await createCycleTlsContext({}, dependencies(driver, createDriver));
    const abort = new AbortController();
    const request = context.get('https://api.example.test/data', { signal: abort.signal });
    const rejected = expect(request).rejects.toThrow('NATIVE_HTTP_ABORTED');
    await vi.waitFor(() => expect(createDriver).toHaveBeenCalledTimes(1));
    abort.abort();
    await rejected;
    release?.(driver);
    await vi.waitFor(() => expect(driver.disposed).toBe(true));
    expect(driver.requests).toHaveLength(0);
  });

  it('rejects an unexpected final URL and does not accept its cookies', async () => {
    const driver = new FakeDriver(async () => response({
      finalUrl: 'https://other.example.test/redirected',
      headers: [{ name: 'set-cookie', value: 'sid=redirected; Path=/' }]
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await expect(context.get('https://api.example.test/start')).rejects.toThrow('NATIVE_HTTP_UNEXPECTED_FINAL_URL');
    await context.dispose();
  });

  it('keeps timeout active for a returned stream and destroys active streams on context close', async () => {
    let releaseChunk: (() => void) | undefined;
    let streamDisposed = 0;
    const driver = new FakeDriver(async () => response({
      headers: [],
      body: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>(resolve => { releaseChunk = resolve; });
          yield Buffer.from('late');
        }
      },
      dispose: async () => { streamDisposed += 1; releaseChunk?.(); }
    }));
    const context = await createCycleTlsContext({ timeoutMs: 30 }, dependencies(driver));
    const stream = await context.stream('https://api.example.test/events');
    const read = (async () => {
      for await (const _chunk of stream.body) { /* consume */ }
    })();
    await expect(read).rejects.toThrow('NATIVE_HTTP_TIMEOUT');
    expect(streamDisposed).toBeGreaterThan(0);
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it('destroys an active returned stream when the context is disposed', async () => {
    let streamDisposed = 0;
    const driver = new FakeDriver(async () => response({
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('one'); } },
      dispose: async () => { streamDisposed += 1; }
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await context.stream('https://api.example.test/events');
    await context.dispose();
    expect(streamDisposed).toBe(1);
  });

  it('settles a blocked active stream reader when the stream is disposed', async () => {
    let release: (() => void) | undefined;
    const driver = new FakeDriver(async () => response({
      body: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>(resolve => { release = resolve; });
          yield Buffer.from('late');
        }
      },
      dispose: async () => { release?.(); }
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const stream = await context.stream('https://api.example.test/events');
    const read = (async () => {
      for await (const _chunk of stream.body) { /* consume */ }
    })();
    const rejected = expect(read).rejects.toThrow('NATIVE_HTTP_STREAM_CLOSED');
    await stream.dispose();
    await rejected;
    await context.dispose();
  });

  it('reports native cleanup failure and concurrent dispose calls await the same cleanup', async () => {
    let releaseCleanup: (() => void) | undefined;
    const dispose = vi.fn(async () => {
      await new Promise<void>(resolve => { releaseCleanup = resolve; });
      throw new Error('sensitive native detail');
    });
    const driver: CycleTlsDriver = {
      request: async request => response({ finalUrl: request.url }),
      dispose
    };
    const context = await createCycleTlsContext({}, { createDriver: async () => driver });
    await context.get('https://api.example.test/data');
    const first = context.dispose();
    const second = context.dispose();
    const firstRejected = expect(first).rejects.toThrow('NATIVE_HTTP_CLEANUP_UNCONFIRMED');
    const secondRejected = expect(second).rejects.toThrow('NATIVE_HTTP_CLEANUP_UNCONFIRMED');
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    releaseCleanup?.();
    await Promise.all([firstRejected, secondRejected]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('still attempts driver cleanup when active stream cleanup fails', async () => {
    const disposeDriver = vi.fn(async () => undefined);
    const driver: CycleTlsDriver = {
      request: async request => response({
        finalUrl: request.url,
        body: { async *[Symbol.asyncIterator]() { yield Buffer.from('one'); } },
        dispose: async () => { throw new Error('stream cleanup failed'); }
      }),
      dispose: disposeDriver
    };
    const context = await createCycleTlsContext({}, { createDriver: async () => driver });
    await context.stream('https://api.example.test/events');
    await expect(context.dispose()).rejects.toThrow('NATIVE_HTTP_CLEANUP_UNCONFIRMED');
    expect(disposeDriver).toHaveBeenCalledTimes(1);
  });

  it('does not return a response when abort occurs during cookie persistence', async () => {
    const original = CookieJar.prototype.setCookie;
    let releaseCookie: (() => void) | undefined;
    const setCookie = vi.spyOn(CookieJar.prototype, 'setCookie').mockImplementation(function (this: CookieJar, ...args) {
      return new Promise((resolve, reject) => {
        releaseCookie = () => {
          Promise.resolve(original.apply(this, args)).then(resolve, reject);
        };
      }) as ReturnType<CookieJar['setCookie']>;
    });
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'set-cookie', value: 'sid=late; Path=/' }]
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const abort = new AbortController();
    const pending = context.get('https://api.example.test/rotate', { signal: abort.signal });
    const rejected = expect(pending).rejects.toThrow('NATIVE_HTTP_ABORTED');
    await vi.waitFor(() => expect(setCookie).toHaveBeenCalledTimes(1));
    abort.abort();
    releaseCookie?.();
    await rejected;
    await expect(context.get('https://api.example.test/check')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it('atomically quarantines an abort during cookie persistence before a sibling can observe it', async () => {
    const original = CookieJar.prototype.setCookie;
    let releaseCookie: (() => void) | undefined;
    const setCookie = vi.spyOn(CookieJar.prototype, 'setCookie').mockImplementation(function (this: CookieJar, ...args) {
      return new Promise((resolve, reject) => {
        releaseCookie = () => { Promise.resolve(original.apply(this, args)).then(resolve, reject); };
      }) as ReturnType<CookieJar['setCookie']>;
    });
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'set-cookie', value: 'sid=late; Path=/' }]
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const abort = new AbortController();
    const rotating = context.get('https://api.example.test/rotate', { signal: abort.signal });
    const rotatingRejected = expect(rotating).rejects.toThrow('NATIVE_HTTP_ABORTED');
    await vi.waitFor(() => expect(setCookie).toHaveBeenCalledTimes(1));
    abort.abort();
    const sibling = context.get('https://api.example.test/sibling');
    const siblingRejected = expect(sibling).rejects.toThrow(/NATIVE_HTTP_(?:ABORTED|CONTEXT_CLOSED)/);
    releaseCookie?.();
    await Promise.all([rotatingRejected, siblingRejected]);
    expect(driver.requests).toHaveLength(1);
  });

  it('atomically quarantines a timeout during cookie persistence before a sibling can observe it', async () => {
    const original = CookieJar.prototype.setCookie;
    let releaseCookie: (() => void) | undefined;
    const setCookie = vi.spyOn(CookieJar.prototype, 'setCookie').mockImplementation(function (this: CookieJar, ...args) {
      return new Promise((resolve, reject) => {
        releaseCookie = () => { Promise.resolve(original.apply(this, args)).then(resolve, reject); };
      }) as ReturnType<CookieJar['setCookie']>;
    });
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'set-cookie', value: 'sid=late; Path=/' }]
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const rotating = context.get('https://api.example.test/rotate', { timeout: 20 });
    const rotatingRejected = expect(rotating).rejects.toThrow('NATIVE_HTTP_TIMEOUT');
    await vi.waitFor(() => expect(setCookie).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 25));
    const sibling = context.get('https://api.example.test/sibling');
    const siblingRejected = expect(sibling).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
    releaseCookie?.();
    await Promise.all([rotatingRejected, siblingRejected]);
    expect(driver.requests).toHaveLength(1);
  });

  it('disposes a stream and quarantines the context when its final URL is unexpected', async () => {
    const disposeResponse = vi.fn(async () => undefined);
    const driver = new FakeDriver(async () => response({
      finalUrl: 'https://other.example.test/redirected',
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('data'); } },
      dispose: disposeResponse
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await expect(context.stream('https://api.example.test/start')).rejects.toThrow('NATIVE_HTTP_UNEXPECTED_FINAL_URL');
    await vi.waitFor(() => expect(disposeResponse).toHaveBeenCalledTimes(1));
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it('disposes a stream and quarantines the context when a response cookie is invalid', async () => {
    const disposeResponse = vi.fn(async () => undefined);
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'set-cookie', value: 'not a cookie' }],
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('data'); } },
      dispose: disposeResponse
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await expect(context.stream('https://api.example.test/start')).rejects.toThrow();
    await vi.waitFor(() => expect(disposeResponse).toHaveBeenCalledTimes(1));
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it('disposes a stream and quarantines the context when Content-Length is invalid', async () => {
    const disposeResponse = vi.fn(async () => undefined);
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'content-length', value: 'invalid' }],
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('data'); } },
      dispose: disposeResponse
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    await expect(context.stream('https://api.example.test/start')).rejects.toThrow('NATIVE_HTTP_CONTENT_LENGTH_INVALID');
    await vi.waitFor(() => expect(disposeResponse).toHaveBeenCalledTimes(1));
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });

  it('quarantines the context when a stream length mismatch proves truncation', async () => {
    const driver = new FakeDriver(async request => response({
      finalUrl: request.url,
      headers: [{ name: 'content-length', value: '3' }],
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('ab'); } }
    }));
    const context = await createCycleTlsContext({}, dependencies(driver));
    const stream = await context.stream('https://api.example.test/start');
    const consume = async () => {
      for await (const _chunk of stream.body) { /* consume */ }
    };
    await expect(consume()).rejects.toThrow('NATIVE_HTTP_STREAM_TRUNCATED');
    await expect(context.get('https://api.example.test/later')).rejects.toThrow('NATIVE_HTTP_CONTEXT_CLOSED');
  });
});
