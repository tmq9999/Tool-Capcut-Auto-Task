import { describe, it, expect } from 'vitest';
import { DongVanFBProvider } from '../DongVanFBProvider';
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

const API_KEY = 'dvfb-secret-key';

describe('DongVanFBProvider.checkBalance', () => {
  it('reads the balance from the envelope', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { error_code: 0, status: true, message: 'ok', balance: 250000 } });
    const provider = new DongVanFBProvider(http);

    await expect(provider.checkBalance(API_KEY)).resolves.toBe(250000);
    expect(http.requests[0].url).toBe('https://api.dongvanfb.net/user/balance?apikey=dvfb-secret-key');
  });

  it('maps status:false to a CONFIG_ERROR without echoing the api key', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { error_code: 1, status: false, message: 'apikey invalid' } });
    const provider = new DongVanFBProvider(http);

    const error = await provider.checkBalance(API_KEY).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).not.toContain(API_KEY);
  });
});

describe('DongVanFBProvider.listAccountTypes', () => {
  it('normalizes account types', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: true,
        data: [{ id: 1, name: 'Hotmail Trusted', quality: 3, price: 1200 }]
      }
    });
    const provider = new DongVanFBProvider(http);

    await expect(provider.listAccountTypes(API_KEY)).resolves.toEqual([
      { id: 1, name: 'Hotmail Trusted', quality: 3, price: 1200 }
    ]);
  });
});

describe('DongVanFBProvider.buyMail', () => {
  it('reads list_data nested under data, as the live API returns it', async () => {
    const http = new FakeHttpClient();
    // Shape returned by api.dongvanfb.net: list_data sits inside "data".
    http.enqueue({
      body: {
        error_code: 200,
        status: true,
        message: 'Mua thanh cong',
        data: {
          order_code: 'DV12345678',
          account_type: 'Outlook TRUSTED [GRAPH API]',
          quality: 1,
          price: 350,
          total_amount: 350,
          balance: 15800,
          list_data: ['pisang67@hotmail.com|Pa55w0rd|0.ARoA-refresh|9e5f94bc-e8a4-4e73']
        }
      }
    });
    const provider = new DongVanFBProvider(http);

    const mails = await provider.buyMail(API_KEY, { accountType: 6, quality: 1 });

    expect(mails).toEqual([
      {
        email: 'pisang67@hotmail.com',
        password: 'Pa55w0rd',
        refreshToken: '0.ARoA-refresh',
        clientId: '9e5f94bc-e8a4-4e73',
        raw: 'pisang67@hotmail.com|Pa55w0rd|0.ARoA-refresh|9e5f94bc-e8a4-4e73'
      }
    ]);
  });

  it('still parses a top-level list_data for older responses', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        error_code: 0,
        status: true,
        list_data: ['pisang67@hotmail.com|Pa55w0rd|0.ARoA-refresh|9e5f94bc-e8a4-4e73']
      }
    });
    const provider = new DongVanFBProvider(http);

    const mails = await provider.buyMail(API_KEY, { accountType: 1, quality: 3 });

    expect(http.requests[0].url).toBe(
      'https://api.dongvanfb.net/user/buy?apikey=dvfb-secret-key&account_type=1&quality=3&type=full'
    );
    expect(mails).toEqual([
      {
        email: 'pisang67@hotmail.com',
        password: 'Pa55w0rd',
        refreshToken: '0.ARoA-refresh',
        clientId: '9e5f94bc-e8a4-4e73',
        raw: 'pisang67@hotmail.com|Pa55w0rd|0.ARoA-refresh|9e5f94bc-e8a4-4e73'
      }
    ]);
  });

  it('accepts a two-field line where only email and password are provided', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, list_data: ['a@hotmail.com|OnlyPass'] } });
    const provider = new DongVanFBProvider(http);

    const mails = await provider.buyMail(API_KEY, { accountType: 1, quality: 3 });

    expect(mails[0].refreshToken).toBeNull();
    expect(mails[0].clientId).toBeNull();
    expect(mails[0].password).toBe('OnlyPass');
  });

  it('accepts an object row shape as well as a pipe-delimited string', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: true,
        data: [{ email: 'b@hotmail.com', password: 'p2', refresh_token: 'r2', client_id: 'c2' }]
      }
    });
    const provider = new DongVanFBProvider(http);

    const mails = await provider.buyMail(API_KEY, { accountType: 1, quality: 3 });

    expect(mails[0]).toMatchObject({
      email: 'b@hotmail.com',
      password: 'p2',
      refreshToken: 'r2',
      clientId: 'c2'
    });
  });

  it('reads a pipe-delimited list_data delivered as one string', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: true,
        data: { order_code: 'DV1', list_data: 'a@hotmail.com|p1|r1|c1' }
      }
    });
    const provider = new DongVanFBProvider(http);

    const mails = await provider.buyMail(API_KEY, { accountType: 6, quality: 1 });

    expect(mails[0]).toMatchObject({ email: 'a@hotmail.com', password: 'p1', refreshToken: 'r1', clientId: 'c1' });
  });

  it('rejects a purchase that returned no usable row', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, data: { list_data: [] } } });
    const provider = new DongVanFBProvider(http);

    await expect(provider.buyMail(API_KEY, { accountType: 1, quality: 3 })).rejects.toBeInstanceOf(ProviderError);
  });

  it('honours a non-default list format', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, list_data: ['c@hotmail.com|p3'] } });
    const provider = new DongVanFBProvider(http);

    await provider.buyMail(API_KEY, { accountType: 2, quality: 1, type: 'null' });

    expect(http.requests[0].url).toContain('&type=null');
    expect(http.requests[0].url).toContain('&account_type=2');
  });
});

describe('DongVanFBProvider.getOauth2', () => {
  it('sends the api key in the json body and splits refresh_token|client_id', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, oauth2: '0.ARoA-refresh|9e5f94bc' } });
    const provider = new DongVanFBProvider(http);

    const oauth = await provider.getOauth2(API_KEY, 'a@hotmail.com', 'pass1');

    expect(http.requests[0].method).toBe('POST');
    expect(http.requests[0].url).toBe('https://api.dongvanfb.net/api/getOauth2');
    expect(http.requests[0].json).toEqual({
      email: 'a@hotmail.com',
      password: 'pass1',
      apikey: API_KEY
    });
    expect(oauth).toEqual({ refreshToken: '0.ARoA-refresh', clientId: '9e5f94bc' });
  });

  it('also accepts discrete refresh_token and client_id fields', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, refresh_token: 'r9', client_id: 'c9' } });
    const provider = new DongVanFBProvider(http);

    await expect(provider.getOauth2(API_KEY, 'a@hotmail.com', 'p')).resolves.toEqual({
      refreshToken: 'r9',
      clientId: 'c9'
    });
  });

  it('fails when neither shape yields a token pair', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true } });
    const provider = new DongVanFBProvider(http);

    await expect(provider.getOauth2(API_KEY, 'a@hotmail.com', 'p')).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('DongVanFBProvider.readCode', () => {
  it('reads a verification code through the oauth2 tools endpoint', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        email: 'a@hotmail.com',
        status: true,
        code: '37589',
        content: '37589 is your Facebook confirmation code',
        date: '22:43 - 15/04/2022'
      }
    });
    const provider = new DongVanFBProvider(http);

    const result = await provider.readCode('oauth2', {
      email: 'a@hotmail.com',
      refreshToken: 'r1',
      clientId: 'c1',
      type: 'facebook'
    });

    expect(http.requests[0].url).toBe('https://tools.dongvanfb.net/api/get_code_oauth2');
    expect(http.requests[0].json).toEqual({
      email: 'a@hotmail.com',
      refresh_token: 'r1',
      client_id: 'c1',
      type: 'facebook'
    });
    expect(result).toEqual({ code: '37589', content: '37589 is your Facebook confirmation code' });
  });

  it('uses the graph endpoint when graph mode is requested', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, code: '11111' } });
    const provider = new DongVanFBProvider(http);

    await provider.readCode('graph', {
      email: 'a@hotmail.com',
      refreshToken: 'r1',
      clientId: 'c1',
      type: 'all'
    });

    expect(http.requests[0].url).toBe('https://tools.dongvanfb.net/api/graph_code');
  });

  it('returns null while no code has landed in the mailbox', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: false, message: 'no code' } });
    const provider = new DongVanFBProvider(http);

    await expect(
      provider.readCode('oauth2', { email: 'a@hotmail.com', refreshToken: 'r', clientId: 'c', type: 'facebook' })
    ).resolves.toBeNull();
  });
});
