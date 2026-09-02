import { describe, it, expect } from 'vitest';
import { KiotProxyProvider, ProxyKeyUnavailableError } from '../KiotProxyProvider';
import { ProviderError } from '../ProviderError';
import type { HttpClient, HttpRequest, HttpResponse } from '../HttpClient';

class FakeHttpClient implements HttpClient {
  public requests: HttpRequest[] = [];
  private queue: HttpResponse[] = [];

  enqueue(response: Partial<HttpResponse>): void {
    const status = response.status ?? 200;
    this.queue.push({
      status,
      ok: response.ok ?? (status >= 200 && status < 300),
      body: response.body ?? null,
      rawText: response.rawText ?? ''
    });
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeHttpClient: no response enqueued');
    return next;
  }
}

describe('KiotProxyProvider.listKeys', () => {
  it('authenticates with the Api-token header and reads the real key row shape', async () => {
    const http = new FakeHttpClient();
    // Shape returned by api.kiotproxy.com: the key lives in "value", the id is a
    // uuid, and expiry is epoch milliseconds in "expirationAt".
    http.enqueue({
      body: {
        success: true,
        status: 'SUCCESS',
        code: 200,
        data: [
          {
            id: 'd8efcc33-3c58-42c5-82df-de1da991cba5',
            value: 'K48fbd08e60494f24b0fa7871d5a1eceb',
            status: 'ACTIVE',
            deleted: false,
            effectiveAt: 1788201942390,
            expirationAt: 1788288342390
          },
          {
            id: '0ccf5049-0d55-4ca2-b95e-290e3370ddcb',
            value: 'K282b6e16df454dbea05675027c78388a',
            status: 'ACTIVE',
            deleted: false,
            effectiveAt: 1788201942390,
            expirationAt: 1788288342390
          }
        ]
      }
    });
    const provider = new KiotProxyProvider(http);

    const keys = await provider.listKeys('API-TOKEN');

    expect(http.requests[0].url).toBe('https://api.kiotproxy.com/api/public/keys');
    expect(http.requests[0].headers).toEqual({ 'Api-token': 'API-TOKEN' });
    expect(keys).toEqual([
      {
        id: 'd8efcc33-3c58-42c5-82df-de1da991cba5',
        keyValue: 'K48fbd08e60494f24b0fa7871d5a1eceb',
        expiredAt: new Date(1788288342390).toISOString()
      },
      {
        id: '0ccf5049-0d55-4ca2-b95e-290e3370ddcb',
        keyValue: 'K282b6e16df454dbea05675027c78388a',
        expiredAt: new Date(1788288342390).toISOString()
      }
    ]);
  });

  it('leaves out deleted and non-active keys so a run never picks one', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        success: true,
        data: [
          { id: 'a', value: 'K-ACTIVE', status: 'ACTIVE', deleted: false, expirationAt: 1788288342390 },
          { id: 'b', value: 'K-DELETED', status: 'ACTIVE', deleted: true, expirationAt: 1788288342390 },
          { id: 'c', value: 'K-EXPIRED', status: 'EXPIRED', deleted: false, expirationAt: 1788288342390 }
        ]
      }
    });
    const provider = new KiotProxyProvider(http);

    const keys = await provider.listKeys('API-TOKEN');

    expect(keys.map((entry) => entry.keyValue)).toEqual(['K-ACTIVE']);
  });

  it('still reads a row that omits status and deleted flags', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: [{ id: 7, value: 'K-PLAIN' }] } });
    const provider = new KiotProxyProvider(http);

    await expect(provider.listKeys('API-TOKEN')).resolves.toEqual([
      { id: 7, keyValue: 'K-PLAIN', expiredAt: null }
    ]);
  });

  it('maps a 401 to an AUTH_ERROR provider error', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 401, body: { success: false, message: 'unauthorized' } });
    const provider = new KiotProxyProvider(http);

    await expect(provider.listKeys('bad')).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });
});

describe('KiotProxyProvider.getNewProxy', () => {
  it('requests a fresh proxy for the key and normalizes an http endpoint', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        success: true,
        data: {
          ip: '113.161.10.5',
          httpPort: 20001,
          socks5Port: 20002,
          httpUsername: 'user1',
          httpPassword: 'pass1',
          nextChangeSeconds: 120
        }
      }
    });
    const provider = new KiotProxyProvider(http);

    const lease = await provider.getNewProxy('KEY-AAA', { region: 'random' });

    expect(http.requests[0].method).toBe('POST');
    expect(http.requests[0].url).toBe('https://api.kiotproxy.com/api/public/proxies/get-new');
    expect(http.requests[0].json).toEqual({ keyValue: 'KEY-AAA', region: 'random' });
    expect(lease).toEqual({
      keyValue: 'KEY-AAA',
      ip: '113.161.10.5',
      host: '113.161.10.5',
      port: 20001,
      protocol: 'http',
      username: 'user1',
      password: 'pass1',
      nextChangeSeconds: 120
    });
  });

  it('selects the socks5 port when socks5 is requested', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: { success: true, data: { ip: '1.2.3.4', httpPort: 20001, socks5Port: 20002 } }
    });
    const provider = new KiotProxyProvider(http);

    const lease = await provider.getNewProxy('KEY-AAA', { protocol: 'socks5' });

    expect(lease.port).toBe(20002);
    expect(lease.protocol).toBe('socks5');
    expect(lease.username).toBeNull();
  });

  it('treats a business-level failure as the key being unavailable for rotation', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: { success: false, message: 'Chưa đến thời gian đổi IP' }
    });
    const provider = new KiotProxyProvider(http);

    await expect(provider.getNewProxy('KEY-AAA')).rejects.toBeInstanceOf(ProxyKeyUnavailableError);
  });

  it('propagates an auth failure instead of marking the key unavailable', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 403, body: { success: false, message: 'forbidden' } });
    const provider = new KiotProxyProvider(http);

    const error = await provider.getNewProxy('KEY-AAA').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(ProxyKeyUnavailableError);
  });

  it('rejects a success payload whose shape carries no usable endpoint', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { location: 'Hanoi' } } });
    const provider = new KiotProxyProvider(http);

    await expect(provider.getNewProxy('KEY-AAA')).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('KiotProxyProvider release and connectivity', () => {
  it('releases a key through the out endpoint', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true } });
    const provider = new KiotProxyProvider(http);

    await provider.releaseKey('KEY-AAA');

    expect(http.requests[0].url).toBe('https://api.kiotproxy.com/api/public/proxies/out');
    expect(http.requests[0].json).toEqual({ keyValue: 'KEY-AAA' });
  });

  it('never throws when releasing a key that the gateway already rotated', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 400, body: { success: false, message: 'key not in use' } });
    const provider = new KiotProxyProvider(http);

    await expect(provider.releaseKey('KEY-AAA')).resolves.toBeUndefined();
  });

  it('reads user info for the connectivity probe', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { username: 'acme', balance: 150000 } } });
    const provider = new KiotProxyProvider(http);

    const info = await provider.getUserInfo('API-TOKEN');

    expect(http.requests[0].url).toBe('https://api.kiotproxy.com/api/public/get-user-info');
    expect(info.balance).toBe(150000);
  });

  it('reports a null balance when the payload omits it', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { username: 'acme' } } });
    const provider = new KiotProxyProvider(http);

    await expect(provider.getUserInfo('API-TOKEN')).resolves.toEqual({
      username: 'acme',
      balance: null
    });
  });
});
