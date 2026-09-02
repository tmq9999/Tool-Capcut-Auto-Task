import { describe, it, expect } from 'vitest';
import { CustomDomainMailProvider } from '../CustomDomainMailProvider';
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

const BASE_URL = 'http://103.116.38.76:3000';
const ADDRESS = 'toibisidamatroi19090@oldevlk.com';

function capcutMail(code: string, date: string, id = 'm-' + code) {
  return {
    id,
    from: '"CapCut" <admin@mail.capcut.com>',
    fromAddress: 'admin@mail.capcut.com',
    subject: 'Welcome to CapCut and your verification code is ' + code,
    date,
    read: false,
    hasAttachments: false
  };
}

describe('CustomDomainMailProvider.listInbox', () => {
  it('percent-encodes the address in the path', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { address: ADDRESS, count: 0, emails: [] } });
    const provider = new CustomDomainMailProvider(http);

    await provider.listInbox(BASE_URL, ADDRESS);

    expect(http.requests[0].method).toBe('GET');
    expect(http.requests[0].url).toBe(
      'http://103.116.38.76:3000/api/emails/toibisidamatroi19090%40oldevlk.com'
    );
  });

  it('parses the inbox payload as the service returns it', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: { address: ADDRESS, count: 1, emails: [capcutMail('260973', '2026-09-01T10:54:16.000Z')] }
    });
    const provider = new CustomDomainMailProvider(http);

    const inbox = await provider.listInbox(BASE_URL, ADDRESS);

    expect(inbox.address).toBe(ADDRESS);
    expect(inbox.count).toBe(1);
    expect(inbox.emails).toHaveLength(1);
    expect(inbox.emails[0]).toMatchObject({
      id: 'm-260973',
      fromAddress: 'admin@mail.capcut.com',
      subject: 'Welcome to CapCut and your verification code is 260973',
      read: false
    });
  });

  it('treats an unknown address with an empty inbox as a normal answer', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { address: 'khongcothat@oldevlk.com', count: 0, emails: [] } });
    const provider = new CustomDomainMailProvider(http);

    const inbox = await provider.listInbox(BASE_URL, 'khongcothat@oldevlk.com');

    expect(inbox.count).toBe(0);
    expect(inbox.emails).toEqual([]);
  });

  it('trims a trailing slash off the base url', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { address: ADDRESS, count: 0, emails: [] } });
    const provider = new CustomDomainMailProvider(http);

    await provider.listInbox('http://103.116.38.76:3000/', ADDRESS);

    expect(http.requests[0].url).toBe(
      'http://103.116.38.76:3000/api/emails/toibisidamatroi19090%40oldevlk.com'
    );
  });

  it('maps a server error to a provider error', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 502, body: null });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.listInbox(BASE_URL, ADDRESS)).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a payload that is not an inbox', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { unexpected: true } });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.listInbox(BASE_URL, ADDRESS)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('CustomDomainMailProvider.readOtp', () => {
  it('pulls the code out of the CapCut subject line', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: { address: ADDRESS, count: 1, emails: [capcutMail('260973', '2026-09-01T10:54:16.000Z')] }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBe('260973');
  });

  it('ignores mail from anyone other than CapCut', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        address: ADDRESS,
        count: 1,
        emails: [{
          id: 'spam-1',
          from: '"Shopee" <no-reply@shopee.vn>',
          fromAddress: 'no-reply@shopee.vn',
          subject: 'Ma xac thuc cua ban la 999888',
          date: '2026-09-01T11:00:00.000Z',
          read: false,
          hasAttachments: false
        }]
      }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBeNull();
  });

  it('takes the newest CapCut mail when the inbox has several', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        address: ADDRESS,
        count: 3,
        emails: [
          capcutMail('111111', '2026-09-01T10:00:00.000Z'),
          capcutMail('333333', '2026-09-01T12:00:00.000Z'),
          capcutMail('222222', '2026-09-01T11:00:00.000Z')
        ]
      }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBe('333333');
  });

  it('returns null while the inbox is still empty', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { address: ADDRESS, count: 0, emails: [] } });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBeNull();
  });

  it('returns null when a CapCut mail carries no code in its subject', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        address: ADDRESS,
        count: 1,
        emails: [{
          id: 'n-1',
          from: '"CapCut" <admin@mail.capcut.com>',
          fromAddress: 'admin@mail.capcut.com',
          subject: 'Your CapCut subscription receipt',
          date: '2026-09-01T10:00:00.000Z',
          read: true,
          hasAttachments: false
        }]
      }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBeNull();
  });

  it('lets the caller widen the sender filter', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        address: ADDRESS,
        count: 1,
        emails: [{
          id: 'tk-1',
          from: '"TikTok" <no-reply@tiktok.com>',
          fromAddress: 'no-reply@tiktok.com',
          subject: 'Your code is 445566',
          date: '2026-09-01T10:00:00.000Z',
          read: false,
          hasAttachments: false
        }]
      }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS, { senderContains: 'tiktok' })).resolves.toBe('445566');
  });

  it('ignores a number that is too short or too long to be a code', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        address: ADDRESS,
        count: 1,
        emails: [{
          id: 'x-1',
          from: '"CapCut" <admin@mail.capcut.com>',
          fromAddress: 'admin@mail.capcut.com',
          subject: 'Order 123 confirmed, ref 1234567890123',
          date: '2026-09-01T10:00:00.000Z',
          read: false,
          hasAttachments: false
        }]
      }
    });
    const provider = new CustomDomainMailProvider(http);

    await expect(provider.readOtp(BASE_URL, ADDRESS)).resolves.toBeNull();
  });
});
