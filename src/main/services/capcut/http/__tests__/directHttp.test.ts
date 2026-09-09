import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { request as apiRequest, type APIRequestContext } from 'playwright-core';
import { CapcutHttpClient } from '../CapcutHttpClient';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await apiRequest.newContext();
  cleanups.push(() => context.dispose());
  // Translate only the socket destination; exercise the production HTTP branch,
  // real cookies, body encoding, abort, redirect behavior and response lifecycle.
  const transport = { fetch: (url: string, options: Parameters<APIRequestContext['fetch']>[1]) => {
    expect(new URL(url).origin).toBe('https://edit-api-sg.capcut.com');
    return context.fetch(origin + new URL(url).pathname + new URL(url).search, options);
  } } as APIRequestContext;
  return CapcutHttpClient.fromRequestContext(transport);
}

it('sends real HTTP with captured headers and exact body, without a Page', async () => {
  const client = await fixture(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ method: req.method, url: req.url, signature: req.headers.sign, body: Buffer.concat(chunks).toString() }));
  });
  const result = await client.requestJson({ path: '/luckycat/i18n/capcut/task/v1/task_list', method: 'POST',
    body: '{"scene":"capcut_web_task"}', headers: { sign: 'synthetic-sign', 'content-type': 'application/json' }, query: { region: 'VN' } });
  expect(result.data).toEqual({ method: 'POST', url: '/luckycat/i18n/capcut/task/v1/task_list?region=VN', signature: 'synthetic-sign', body: '{"scene":"capcut_web_task"}' });
});

it('encodes authenticated form contracts without a browser', async () => {
  const client = await fixture(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString() }));
  });
  const result = await client.requestForm({ path: '/passport/web/email/send_code/', form: { email: 'test@example.com', type: 1 }, effect: 'mutation' });
  expect(result.data).toEqual({ contentType: 'application/x-www-form-urlencoded', body: 'email=test%40example.com&type=1' });
});

it('never follows redirects or leaks the credential to another path', async () => {
  let received = 0;
  const client = await fixture((_req, res) => { received++; res.writeHead(302, { location: '/another-account' }); res.end(); });
  await expect(client.requestJson({ path: '/read', headers: { cookie: 'session=private' } })).rejects.toThrow('CAPCUT_HTTP_REDIRECT_BLOCKED');
  expect(received).toBe(1);
});

it('cancels a hanging HTTP mutation once without leaking transport errors or retrying', async () => {
  let notify!: () => void; const received = new Promise<void>(r => { notify = r; }); let count = 0;
  const client = await fixture(() => { count++; notify(); });
  const controller = new AbortController();
  const result = client.requestJson({ path: '/submit', method: 'POST', body: {}, signal: controller.signal }).catch(e => e);
  await received; controller.abort(new Error('secret-cookie'));
  expect((await result).message).toBe('CAPCUT_HTTP_OUTCOME_UNKNOWN');
  expect(count).toBe(1);
});

it('blocks pre-aborted calls without dispatch and classifies malformed JSON', async () => {
  let received = 0;
  const client = await fixture((_req, res) => { received++; res.end('private server payload'); });
  const controller = new AbortController(); controller.abort();
  await expect(client.requestJson({ path: '/read', signal: controller.signal })).rejects.toThrow();
  expect(received).toBe(0);
  await expect(client.requestJson({ path: '/read' })).rejects.toThrow('CAPCUT_HTTP_INVALID_JSON');
});

it('isolates cookie jars across two accounts', async () => {
  const handler: http.RequestListener = (req, res) => {
    if (req.url === '/login') res.setHeader('set-cookie', 'session=account-a; Path=/');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
  };
  const a = await fixture(handler); const b = await fixture(handler);
  await a.requestJson({ path: '/login' });
  expect((await a.requestJson({ path: '/read' })).data).toEqual({ cookie: 'session=account-a' });
  expect((await b.requestJson({ path: '/read' })).data).toEqual({ cookie: null });
});
