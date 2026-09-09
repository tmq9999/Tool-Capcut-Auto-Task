import { describe, expect, it } from 'vitest';
import {
  FetchHttpClient,
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type HttpResponseHeadersMetadata
} from '../HttpClient';
import {
  ObservedHttpClient,
  type HttpObservationEvent
} from '../ObservedHttpClient';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class DeferredHttpClient implements HttpClient {
  readonly pending = new Map<string, ReturnType<typeof deferred<HttpResponse>>>();
  readonly requests: HttpRequest[] = [];

  send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const gate = deferred<HttpResponse>();
    this.pending.set(request.url, gate);
    return gate.promise;
  }
}

describe('ObservedHttpClient', () => {
  it('keeps reverse-order responses with their immutable async owner and leaves outside calls unscoped', async () => {
    const raw = new DeferredHttpClient();
    const events: HttpObservationEvent[] = [];
    const http = new ObservedHttpClient(raw, (event) => { events.push(event); });

    const firstIdentity = {
      runId: 'run-1',
      workerAlias: 'worker-1',
      acquisitionAlias: 'acq-1',
      accountAlias: 'unassigned',
      sessionAlias: 'unassigned'
    } as const;
    const first = http.withObservationScope(firstIdentity, () =>
      http.send({ method: 'POST', url: 'https://provider.test/purchase', json: { secret: 'first' } })
    );
    const second = http.withObservationScope({
      runId: 'run-1', workerAlias: 'worker-2', acquisitionAlias: 'acq-2',
      accountAlias: 'unassigned', sessionAlias: 'unassigned'
    }, () => http.send({ method: 'GET', url: 'https://provider.test/otp?token=second' }));
    const outside = http.send({ method: 'GET', url: 'https://provider.test/outside' });

    raw.pending.get('https://provider.test/otp?token=second')?.resolve({
      status: 202, ok: true, body: { code: '654321' }, rawText: '654321'
    });
    raw.pending.get('https://provider.test/outside')?.resolve({
      status: 204, ok: true, body: null, rawText: ''
    });
    raw.pending.get('https://provider.test/purchase')?.resolve({
      status: 201, ok: true, body: { email: 'secret@example.com' }, rawText: 'raw-secret'
    });
    await Promise.all([first, second, outside]);

    const terminals = events.filter((event) => event.phase === 'response');
    expect(terminals.map((event) => [event.status, event.identity])).toEqual([
      [202, expect.objectContaining({ workerAlias: 'worker-2', acquisitionAlias: 'acq-2' })],
      [204, { scope: 'unscoped' }],
      [201, expect.objectContaining({ workerAlias: 'worker-1', acquisitionAlias: 'acq-1' })]
    ]);
    expect(firstIdentity).toEqual({
      runId: 'run-1', workerAlias: 'worker-1', acquisitionAlias: 'acq-1',
      accountAlias: 'unassigned', sessionAlias: 'unassigned'
    });
    expect(Object.isFrozen(terminals[0].identity)).toBe(true);
    expect(new Set(terminals.map((event) => event.requestId)).size).toBe(3);
  });

  it('binds nested account and session aliases without leaking them to a peer scope', async () => {
    const raw: HttpClient = {
      send: async () => ({ status: 200, ok: true, body: null, rawText: '' })
    };
    const events: HttpObservationEvent[] = [];
    const http = new ObservedHttpClient(raw, (event) => { events.push(event); });

    await Promise.all([
      http.withObservationScope({ runId: 'run', workerAlias: 'worker-1' }, () =>
        http.withObservationScope({ accountAlias: 'account-1', sessionAlias: 'session-1' }, () =>
          http.send({ method: 'GET', url: 'https://provider.test/one' })
        )
      ),
      http.withObservationScope({ runId: 'run', workerAlias: 'worker-2' }, () =>
        http.send({ method: 'GET', url: 'https://provider.test/two' })
      )
    ]);

    const requests = events.filter((event) => event.phase === 'request');
    expect(requests[0].identity).toEqual({
      scope: 'scoped', runId: 'run', workerAlias: 'worker-1',
      accountAlias: 'account-1', sessionAlias: 'session-1'
    });
    expect(requests[1].identity).toEqual({ scope: 'scoped', runId: 'run', workerAlias: 'worker-2' });
  });

  it('records response headers before a body failure and reports an early status', async () => {
    const events: HttpObservationEvent[] = [];
    let captureResponseHeaders = (_metadata: HttpResponseHeadersMetadata): void => {};
    const raw = new FetchHttpClient(
      async () => ({
        status: 206,
        ok: true,
        text: async () => {
          const error = new Error('body timed out');
          error.name = 'AbortError';
          throw error;
        }
      } as unknown as Response),
      (headers) => captureResponseHeaders(headers)
    );
    const http = new ObservedHttpClient(raw, (event) => { events.push(event); });
    captureResponseHeaders = (metadata) => http.captureResponseHeaders(metadata);

    await expect(http.withObservationScope({ provider: 'gmail94', operation: 'read-otp' }, () =>
      http.send({ method: 'GET', url: 'https://provider.test/body-timeout' })
    )).rejects.toBeInstanceOf(HttpTransportError);

    expect(events.map((event) => event.phase)).toEqual(['request', 'response-headers', 'error']);
    expect(events[1]).toMatchObject({ phase: 'response-headers', status: 206, ok: true });
    expect(events[2]).toMatchObject({ phase: 'error', headersSource: 'early', status: 206 });
  });

  it('does not alter raw requests, responses, or failures when the observer throws', async () => {
    const response = { status: 200, ok: true, body: { safe: true }, rawText: '{"safe":true}' };
    const failure = new Error('raw provider failure');
    const rawRequests: HttpRequest[] = [];
    let fail = false;
    const raw: HttpClient = {
      send: async (request) => {
        rawRequests.push(request);
        if (fail) throw failure;
        return response;
      }
    };
    const http = new ObservedHttpClient(raw, () => { throw new Error('observer failed'); });
    const request: HttpRequest = {
      method: 'POST',
      url: 'https://provider.test/order?token=URL_SECRET',
      headers: { Authorization: 'Bearer HEADER_SECRET' },
      json: { password: 'BODY_SECRET' }
    };

    await expect(http.withObservationScope({ runId: 'run-1' }, () => http.send(request))).resolves.toBe(response);
    expect(rawRequests[0]).toBe(request);
    fail = true;
    await expect(http.send(request)).rejects.toBe(failure);
  });

  it('does not alter a response when the async observer rejects', async () => {
    const response = { status: 200, ok: true, body: null, rawText: '' };
    const raw: HttpClient = { send: async () => response };
    const http = new ObservedHttpClient(raw, async () => {
      throw new Error('async observer rejected');
    });

    await expect(http.send({ method: 'GET', url: 'https://provider.test/services' }))
      .resolves.toBe(response);
  });

  it('emits only allowlisted metadata and honestly marks custom-client headers as final-response', async () => {
    const events: HttpObservationEvent[] = [];
    const raw: HttpClient = {
      send: async () => ({
        status: 200,
        ok: true,
        body: { inbox: 'INBOX_SECRET', otp: 'OTP_SECRET' },
        rawText: 'RAW_PURCHASE_SECRET'
      })
    };
    const http = new ObservedHttpClient(raw, (event) => { events.push(event); });

    await http.withObservationScope({
      runId: 'run-safe', provider: 'dongvanfb', operation: 'purchase-mailbox'
    }, () => http.send({
      method: 'POST',
      url: 'https://provider.test?apiKey=QUERY_SECRET',
      headers: { Authorization: 'HEADER_SECRET' },
      json: { raw: 'BODY_SECRET' }
    }));

    const serialized = JSON.stringify(events);
    for (const secret of [
      'QUERY_SECRET', 'HEADER_SECRET', 'BODY_SECRET', 'INBOX_SECRET', 'OTP_SECRET',
      'RAW_PURCHASE_SECRET', 'provider.test'
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(events.at(-1)).toMatchObject({
      phase: 'response', headersSource: 'final-response', status: 200, bodyType: 'object',
      routeTemplate: '/unknown', businessCategory: 'mailbox-purchase', durationMs: expect.any(Number)
    });
  });

  it('redacts unknown identity values and custom error names instead of forwarding them', async () => {
    const events: HttpObservationEvent[] = [];
    const secret = 'IDENTITY_SECRET@example.com';
    const raw: HttpClient = {
      send: async () => {
        const error = new Error('ignored message');
        error.name = 'SECRET_ERROR_NAME';
        throw error;
      }
    };
    const http = new ObservedHttpClient(raw, (event) => { events.push(event); });

    await expect(http.withObservationScope({
      runId: secret,
      provider: secret,
      operation: secret
    }, () => http.send({
      method: 'GET',
      url: 'https://provider.test/api/emails/' + encodeURIComponent(secret)
    }))).rejects.toThrow('ignored message');

    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events[0]).toMatchObject({
      routeTemplate: '/api/emails/:address',
      businessCategory: 'other',
      identity: { scope: 'scoped', runId: 'redacted', provider: 'unknown', operation: 'unknown' }
    });
    expect(events[1]).toMatchObject({ phase: 'error', errorName: 'Error' });
  });
});
