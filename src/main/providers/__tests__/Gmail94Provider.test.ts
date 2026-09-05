import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Gmail94Provider } from '../Gmail94Provider';
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

const TOKEN = 'gm94-secret-token';

describe('Gmail94Provider.getProfile', () => {
  it('reads the account name and numeric balance', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { name: 'khainv', email: 'google@gmail.com', money: '969500' } } });
    const provider = new Gmail94Provider(http);

    const profile = await provider.getProfile(TOKEN);

    expect(http.requests[0].url).toBe('https://gmail94.com/api/profile?token=gm94-secret-token');
    expect(profile).toEqual({ name: 'khainv', email: 'google@gmail.com', balance: 969500 });
  });

  it('maps a 403 to AUTH_ERROR and keeps the token out of the message', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 403, body: { success: false, message: 'Unauthorized' } });
    const provider = new Gmail94Provider(http);

    const error = await provider.getProfile(TOKEN).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('AUTH_ERROR');
    expect((error as ProviderError).message).not.toContain(TOKEN);
  });
});

describe('Gmail94Provider.createOtpOrder', () => {
  it('buys one mailbox for a service and returns the email plus order id', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { email: 'doducs60830@gmail.com', order_id: '68bdb654d878a' } } });
    const provider = new Gmail94Provider(http);

    const order = await provider.createOtpOrder(TOKEN, 'facebook');

    expect(http.requests[0].url).toBe(
      'https://gmail94.com/api/otp/create?token=gm94-secret-token&service=facebook'
    );
    expect(order).toEqual({ email: 'doducs60830@gmail.com', orderId: '68bdb654d878a' });
  });

  it('rejects a success payload missing the order id', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { email: 'a@gmail.com' } } });
    const provider = new Gmail94Provider(http);

    await expect(provider.createOtpOrder(TOKEN, 'facebook')).rejects.toBeInstanceOf(ProviderError);
  });

  it('reports a business failure as a CONFIG_ERROR', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: false, message: 'Invalid request' } });
    const provider = new Gmail94Provider(http);

    await expect(provider.createOtpOrder(TOKEN, 'facebook')).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    });
  });

  it('classifies the observed Gmail94 order balance failure', async () => {
    const http = new FakeHttpClient();
    const body = JSON.parse(
      fs.readFileSync(
        'src/main/providers/__tests__/fixtures/gmail94-insufficient-funds.json',
        'utf8'
      )
    ) as unknown;
    http.enqueue({ body });
    const provider = new Gmail94Provider(http);

    const error = await provider.createOtpOrder(TOKEN, 'capcut').then(
      () => {
        throw new Error('Expected createOtpOrder to throw');
      },
      (caught: unknown) => caught as ProviderError
    );

    expect(error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      serviceName: 'gmail94'
    });
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(JSON.stringify(body));
  });

  it('url-encodes the service slug', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, data: { email: 'a@gmail.com', order_id: 'o1' } } });
    const provider = new Gmail94Provider(http);

    await provider.createOtpOrder(TOKEN, 'my service');

    expect(http.requests[0].url).toContain('service=my%20service');
  });
});

describe('Gmail94Provider.readOtp', () => {
  it('returns the code once the mailbox has received it', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true, otp: '03909' } });
    const provider = new Gmail94Provider(http);

    const otp = await provider.readOtp(TOKEN, '68bdb654d878a', 'facebook');

    expect(http.requests[0].url).toBe(
      'https://gmail94.com/api/otp/read?token=gm94-secret-token&order_id=68bdb654d878a&service=facebook'
    );
    expect(otp).toBe('03909');
  });

  it('returns null while the code has not arrived yet instead of throwing', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: true } });
    const provider = new Gmail94Provider(http);

    await expect(provider.readOtp(TOKEN, 'o1', 'facebook')).resolves.toBeNull();
  });

  it('returns null when the service answers success:false for a pending mailbox', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { success: false, message: 'Resource not found' } });
    const provider = new Gmail94Provider(http);

    await expect(provider.readOtp(TOKEN, 'o1', 'facebook')).resolves.toBeNull();
  });

  it('still fails loudly on an authentication error', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 403, body: { success: false, message: 'Unauthorized' } });
    const provider = new Gmail94Provider(http);

    await expect(provider.readOtp(TOKEN, 'o1', 'facebook')).rejects.toMatchObject({
      code: 'AUTH_ERROR'
    });
  });
});

describe('Gmail94Provider.listServices', () => {
  it('normalizes the service catalogue including price as a number', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: true,
        message: 'Services fetched successfully',
        data: [
          { id: 3, name: 'facebook', slug: 'facebook', price: '1000', description: null },
          { id: 7, name: 'tiktok', slug: 'tiktok', price: '900', description: null }
        ]
      }
    });
    const provider = new Gmail94Provider(http);

    const services = await provider.listServices();

    expect(http.requests[0].url).toBe('https://gmail94.com/api/services');
    expect(services).toEqual([
      { id: 3, name: 'facebook', slug: 'facebook', price: 1000 },
      { id: 7, name: 'tiktok', slug: 'tiktok', price: 900 }
    ]);
  });

  it('skips catalogue rows without a slug rather than inventing one', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: true, data: [{ id: 1, name: 'broken' }] } });
    const provider = new Gmail94Provider(http);

    await expect(provider.listServices()).resolves.toEqual([]);
  });
});
