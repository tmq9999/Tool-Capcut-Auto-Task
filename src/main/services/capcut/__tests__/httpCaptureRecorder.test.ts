import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { BrowserContext, Request } from 'playwright-core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { attachRedactedHttpCapture, type CaptureOptions } from '../httpCapture';
import { createCaptureRedactor } from '../captureRedaction';
import { SessionEvidenceBudget } from '../evidenceBudget';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcut-recorder-')); });
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });
const request = (body = '{"action_key":"capcut_web_pwa_install","token":"secret-body"}') => ({
  url: () => 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?X-Bogus=secret-query',
  method: () => 'POST', headers: () => ({ 'content-type': 'application/json', cookie: 'secret-cookie' }),
  postData: () => body, resourceType: () => 'fetch', redirectedFrom: () => null,
  failure: () => ({ errorText: 'net::ERR_FAILED secret-error' })
}) as unknown as Request;
function setup(options: CaptureOptions = {}) {
  const context = new EventEmitter(); const file = path.join(dir, 'capture.ndjson');
  const capture = attachRedactedHttpCapture(context as unknown as BrowserContext, file, options);
  const rows = () => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { context, capture, rows, file };
}
function response(req: Request, body: string, mime = 'application/json') {
  return { request: () => req, status: () => 200, headers: () => ({ 'content-type': mime, 'set-cookie': 'secret-response' }), body: async () => Buffer.from(body) };
}
it('pairs v3 header and body records and carries immutable identity and step context', async () => {
  const h = setup({ identity: { runId: 'run-1', sessionId: 'session-1', accountId: 'account-1' } });
  const a = request(); const b = request(); h.capture.mark('design-chat');
  h.capture.markStep({ stepId: 'S12', stepAttemptId: 'attempt-1', phase: 'action' });
  h.context.emit('request', a); h.context.emit('request', b);
  h.context.emit('response', response(b, JSON.stringify({ data: Array.from({ length: 200 }, () => ({ task_status: 4, token: 'secret-value' })) })));
  h.context.emit('response', response(a, '{"err_no":0}'));
  await h.capture.stop();
  const starts = h.rows().filter(r => r.type === 'request-start');
  const headers = h.rows().filter(r => r.type === 'response');
  const bodies = h.rows().filter(r => r.type === 'response-body');
  expect(new Set(starts.map(r => r.requestId)).size).toBe(2);
  expect(headers[0]).toMatchObject({ requestId: starts[1].requestId, status: 200 });
  expect(bodies.find(r => r.requestId === starts[1].requestId).body.value.data).toHaveLength(200);
  expect(starts[0]).toMatchObject({
    version: 3,
    timestamp: expect.any(String),
    elapsedMs: expect.any(Number),
    identity: { runId: 'run-1', sessionId: 'session-1', accountId: 'account-1' },
    stage: 'design-chat',
    step: { stepId: 'S12', stepAttemptId: 'attempt-1', phase: 'action' }
  });
  expect(fs.readFileSync(h.file,'utf8')).not.toContain('secret-');
});
it('records redirect, failed and incomplete requests, and stops idempotently', async () => {
  const h = setup(); const a = request(); const b = { ...request(), redirectedFrom: () => a } as Request;
  h.context.emit('request', a); h.context.emit('request', b); h.context.emit('requestfailed', a);
  const stop = h.capture.stop(); expect(h.capture.stop()).toBe(stop); await stop;
  const rows = h.rows(); const starts = rows.filter(r => r.type === 'request-start');
  expect(starts[1].redirectedFromId).toBe(starts[0].requestId);
  expect(rows.some(r => r.type === 'request-terminal' && r.outcome === 'failed')).toBe(true);
  expect(rows.some(r => r.type === 'request-terminal' && r.outcome === 'incomplete')).toBe(true);
  expect(h.context.eventNames()).toEqual([]);
});
it('writes response headers and a later body timeout without waiting for the raw promise to settle', async () => {
  let onResponseWritten: (() => void) | undefined;
  const responseWritten = new Promise<void>(r => { onResponseWritten = r; });
  const h = setup({
    bodyTimeoutMs: 20,
    createOutputStream: (filePath, fd) => {
      const fileStream = fs.createWriteStream(filePath, { fd, autoClose: true });
      return new Writable({
        write(chunk, encoding, callback) {
          fileStream.write(chunk, encoding, (err) => {
            callback(err);
            if (chunk.toString().includes('"type":"response"')) {
              onResponseWritten?.();
            }
          });
        },
        final(callback) {
          fileStream.end(callback);
        }
      });
    }
  });
  const req = request(); let release!: (b: Buffer) => void;
  h.context.emit('request', req);
  h.context.emit('response', { ...response(req,''), body: () => new Promise<Buffer>(r => { release = r; }) });
  await responseWritten;
  expect(h.rows().find(r => r.type === 'response')).toMatchObject({ status: 200 });
  await h.capture.stop();
  expect(h.rows().find(r => r.type === 'response-body').body.state).toBe('timeout');
  const before = fs.readFileSync(h.file,'utf8'); release(Buffer.from('secret-late'));
  await new Promise(r => setImmediate(r)); expect(fs.readFileSync(h.file,'utf8')).toBe(before);
});
it('omits streams/binary and marks oversized data, without slicing JSON', async () => {
  const h = setup({ maxBodyBytes: 100 }); const read = vi.fn(async () => Buffer.from('secret-binary'));
  for (const mime of ['image/png','text/event-stream']) {
    const req = request(); h.context.emit('request',req); h.context.emit('response',{ ...response(req,'',mime), body: read });
  }
  const big = request(); h.context.emit('request',big); h.context.emit('response',response(big, JSON.stringify({ data:'x'.repeat(200) })));
  await h.capture.stop(); expect(read).not.toHaveBeenCalled();
  expect(h.rows().filter(r => r.type === 'response-body').map(r => r.body.state).sort()).toEqual(['omitted-binary','omitted-stream','oversize']);
});
it('redacts numeric credentials, nested JSON strings, forms, headers, URL query and dynamic keys', async () => {
  const h = setup();
  const a = request(JSON.stringify({ job_id:'secret-job', otp:123456, nested:'{"password":"secret-password"}', 'email@example.com':'secret-email' }));
  const b = { ...request(), headers: () => ({'content-type':'application/x-www-form-urlencoded'}), postData: () => 'job_id=secret-job&code=987654' } as Request;
  h.context.emit('request',a); h.context.emit('request',b); await h.capture.stop();
  const starts = h.rows().filter(r => r.type === 'request-start');
  expect(starts[0].body.value.job_id).toBe(starts[1].body.value.job_id);
  const text = fs.readFileSync(h.file,'utf8');
  for (const value of ['secret-', '123456','987654','email@example.com']) expect(text).not.toContain(value);
});
it('keeps reviewed response codes only at allowlisted endpoint paths', () => {
  const redact = createCaptureRedactor();
  const reviewed = redact.responseValue(
    { ret: 0, error_code: 1001, status_code: '200', code: 123456, message: 'private text' },
    'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action'
  ) as Record<string, unknown>;
  expect(reviewed).toMatchObject({ ret: 0, error_code: 1001, status_code: '200', code: '<redacted>' });
  expect(reviewed.message).toMatch(/^<ref-/);
  const unknown = redact.responseValue({ ret: 0, error_code: 1001 }, '/unknown') as Record<string, unknown>;
  expect(unknown.ret).toMatch(/^<ref-/);
  expect(unknown.error_code).toBe('<redacted>');
  const nested = redact.responseValue({ data: { ret: 0 } }, 'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action') as {
    data: { ret: unknown };
  };
  expect(nested.data.ret).toMatch(/^<ref-/);
  expect(redact.value({ code: 987654 })).toEqual({ code: '<redacted>' });
  expect(redact.headers({ 'content-length': '4096', cookie: 'private' })).toEqual({
    'content-length': '4096',
    cookie: '<redacted>'
  });
});

it('retains reviewed task-list keys, status and reward in the real response-body event', async () => {
  const h = setup();
  const req = { ...request(), url: () => 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list' } as Request;
  h.context.emit('request', req);
  h.context.emit('response', response(req, JSON.stringify({
    err_no: 0,
    data: { task_list: [{
      task_key: 'capcut_web_design_studio_canvas_edit',
      task_status: 4,
      task_reward_view: { reward_amount: 70 },
      code: 654321
    }] }
  })));
  await h.capture.stop();
  expect(h.rows().find(row => row.type === 'response-body').body.value).toMatchObject({
    err_no: 0,
    data: { task_list: [{
      task_key: 'capcut_web_design_studio_canvas_edit',
      task_status: 4,
      task_reward_view: { reward_amount: 70 },
      code: '<redacted>'
    }] }
  });
});

it('rejects unsafe identity and step aliases before they can leak into records', async () => {
  const h = setup({ identity: { runId: 'user@example.com', sessionId: 'token secret', accountId: 'account-ok' } });
  expect(() => h.capture.markStep({ stepId: 'email@example.com', stepAttemptId: 'attempt-1', phase: 'before' })).toThrow('CAPTURE_INVALID_STEP');
  await h.capture.stop();
  const text = fs.readFileSync(h.file, 'utf8');
  expect(text).not.toContain('user@example.com');
  expect(text).not.toContain('token secret');
  expect(JSON.parse(text.split('\n')[0]).identity).toEqual({ runId: 'unassigned', sessionId: 'unassigned', accountId: 'account-ok' });
});

it('does not permit options to raise body, file or raw-read hard caps', async () => {
  const h = setup({
    bodyTimeoutMs: 60_000,
    closeTimeoutMs: 60_000,
    maxBodyBytes: 20 * 1024 * 1024,
    maxFileBytes: 512 * 1024 * 1024,
    maxPendingBodies: 10
  });
  await h.capture.stop();
  expect(h.rows().find(row => row.type === 'capture-start').limits).toMatchObject({
    bodyTimeoutMs: 5000,
    closeTimeoutMs: 5000,
    maxBodyBytes: 2 * 1024 * 1024,
    maxFileBytes: 128 * 1024 * 1024,
    maxUnsettledBodyReads: 2
  });
});

it('applies the file hard cap to capture-end instead of bypassing it', async () => {
  const h = setup({ maxFileBytes: 1 });
  const summary = await h.capture.stop();
  expect(fs.readFileSync(h.file, 'utf8')).toBe('');
  expect(summary.recordOmittedByReason).toMatchObject({ file: 2 });
  expect(JSON.parse(fs.readFileSync(h.file + '.summary.json', 'utf8')).summary.recordOmittedByReason).toMatchObject({ file: 2 });
});

it('does not count response headers or bodies as recorded when the file cap rejects their records', async () => {
  const h = setup({ maxFileBytes: 1 });
  const req = request();
  h.context.emit('request', req);
  h.context.emit('response', response(req, '{"err_no":0}'));
  const summary = await h.capture.stop();
  expect(summary).toMatchObject({
    responseHeadersObserved: 1,
    responseHeadersAccepted: 0,
    headersRecorded: 0,
    responses: 0,
    bodyRecordsObserved: 1,
    bodyRecordsAccepted: 0,
    bodyStored: 0,
    recordOmittedByReason: { file: 6 },
    bodyOmittedByReason: { file: 1 }
  });
  expect(summary.bodyRecordsObserved).toBe(summary.bodyStored + summary.omittedBodies);
});

it('counts each policy-omitted body once when its response-body row also exceeds the file cap', async () => {
  const h = setup({ maxBodyBytes: 100, maxFileBytes: 1 });
  const policy = { ...request(), url: () => 'https://www.capcut.com/static-resource/app.js' } as Request;
  const stream = request();
  const oversized = request();
  h.context.emit('request', policy);
  h.context.emit('response', response(policy, '{"err_no":0}'));
  h.context.emit('request', stream);
  h.context.emit('response', response(stream, 'ignored', 'text/event-stream'));
  h.context.emit('request', oversized);
  h.context.emit('response', response(oversized, JSON.stringify({ data: 'x'.repeat(200) })));
  const summary = await h.capture.stop();
  expect(summary).toMatchObject({
    bodyRecordsObserved: 3,
    bodyStored: 0,
    omittedBodies: 3,
    bodyOmittedByReason: { 'policy-omitted': 1, stream: 1, oversize: 1 }
  });
  expect(summary.bodyOmittedByReason).not.toHaveProperty('file');
  expect(summary.recordOmittedByReason.file).toBeGreaterThanOrEqual(3);
  expect(summary.bodyRecordsObserved).toBe(summary.bodyStored + summary.omittedBodies);
});

it('records owned CDP targets, pre-request extra info and redirect hops without leaking headers', async () => {
  const page = new EventEmitter();
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => ({})),
    detach: vi.fn(async () => undefined)
  });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page],
    newCDPSession: vi.fn(async (target: unknown) => {
      expect(target).toBe(page);
      return session;
    })
  });
  const file = path.join(dir, 'target.ndjson');
  const capture = attachRedactedHttpCapture(context as unknown as BrowserContext, file);
  await new Promise(resolve => setImmediate(resolve));

  session.emit('Network.requestWillBeSentExtraInfo', {
    requestId: 'raw-request-id',
    headers: { cookie: 'secret-cookie', accept: 'application/json' }
  });
  session.emit('Network.requestWillBeSent', {
    requestId: 'raw-request-id',
    type: 'Preflight',
    frameId: 'raw-frame-id',
    initiator: { type: 'script', url: 'https://private.example/source.js' },
    request: { url: 'https://edit-api-sg.capcut.com/lv/start?token=secret-query', method: 'POST', headers: {} }
  });
  session.emit('Network.responseReceived', {
    requestId: 'raw-request-id',
    type: 'Fetch',
    response: { status: 302, mimeType: 'application/json', fromDiskCache: true, headers: { 'set-cookie': 'secret-response' } }
  });
  session.emit('Network.requestWillBeSent', {
    requestId: 'raw-request-id',
    type: 'Fetch',
    frameId: 'raw-frame-id',
    redirectResponse: { status: 302, headers: { location: 'https://edit-api-sg.capcut.com/lv/final?token=secret' } },
    request: { url: 'https://edit-api-sg.capcut.com/lv/final', method: 'GET', headers: {} }
  });
  session.emit('Network.loadingFailed', { requestId: 'raw-request-id', errorText: 'net::ERR_FAILED private-detail' });
  await capture.stop();

  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(rows.find(row => row.type === 'target-capability')).toMatchObject({
    target: 'page-1',
    capabilities: { pageNetwork: true, workers: false, serviceWorkerNetwork: false },
    gaps: ['worker-target-unsupported', 'service-worker-target-unsupported']
  });
  expect(rows.filter(row => row.type === 'cdp-request').map(row => ({ requestRef: row.requestRef, hop: row.hop })))
    .toEqual([{ requestRef: 'net-1', hop: 0 }, { requestRef: 'net-1', hop: 1 }]);
  expect(rows.find(row => row.type === 'cdp-request-extra')).toMatchObject({ requestRef: 'net-1', hop: 0 });
  expect(rows.find(row => row.type === 'cdp-response')).toMatchObject({ requestRef: 'net-1', hop: 0, cache: 'disk' });
  expect(rows.find(row => row.type === 'cdp-redirect')).toMatchObject({ requestRef: 'net-1', fromHop: 0, toHop: 1 });
  expect(rows.find(row => row.type === 'cdp-terminal')).toMatchObject({ requestRef: 'net-1', hop: 1, outcome: 'failed' });
  const text = fs.readFileSync(file, 'utf8');
  for (const secret of ['raw-request-id', 'raw-frame-id', 'secret-', 'private-detail', 'private.example']) {
    expect(text).not.toContain(secret);
  }
  expect(session.send).toHaveBeenCalledWith('Network.enable', expect.any(Object));
  expect(session.detach).toHaveBeenCalledOnce();
});

it('uses one SSE payload source and records bounded WebSocket and client metadata shapes', async () => {
  const page = new EventEmitter();
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => ({})),
    detach: vi.fn(async () => undefined)
  });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page],
    newCDPSession: async () => session
  });
  const file = path.join(dir, 'stream.ndjson');
  const capture = attachRedactedHttpCapture(context as unknown as BrowserContext, file);
  await new Promise(resolve => setImmediate(resolve));
  session.emit('Network.requestWillBeSent', {
    requestId: 'sse-raw', type: 'EventSource', request: {
      url: 'https://edit-api-sg.capcut.com/lv/stream', method: 'GET', headers: {}
    }
  });
  session.emit('Network.dataReceived', { requestId: 'sse-raw', dataLength: 20, encodedDataLength: 20, data: 'data: secret-stream\n\n' });
  session.emit('Network.eventSourceMessageReceived', { requestId: 'sse-raw', eventName: 'message', eventId: 'private-id', data: 'secret-stream' });
  session.emit('Network.webSocketCreated', { requestId: 'ws-raw', url: 'wss://edit-api-sg.capcut.com/lv/socket?token=secret' });
  session.emit('Network.webSocketWillSendHandshakeRequest', { requestId: 'ws-raw', request: { headers: { cookie: 'secret-cookie' } } });
  session.emit('Network.webSocketFrameSent', { requestId: 'ws-raw', response: { opcode: 1, payloadData: '{"token":"secret-frame","kind":"progress"}' } });
  session.emit('Network.webSocketFrameReceived', { requestId: 'ws-raw', response: { opcode: 2, payloadData: 'secret-binary' } });
  session.emit('Network.webSocketFrameError', { requestId: 'ws-raw', errorMessage: 'secret-error' });
  session.emit('Network.webSocketClosed', { requestId: 'ws-raw' });
  page.emit('pageerror', new TypeError('secret client failure'));
  page.emit('console', { type: () => 'error', text: () => 'secret console failure' });
  page.emit('dialog', { type: () => 'alert', message: () => 'secret dialog' });
  await capture.stop();

  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(rows.filter(row => row.type === 'sse-message')).toHaveLength(1);
  expect(rows.some(row => row.type === 'cdp-data' && 'data' in row)).toBe(false);
  expect(rows.filter(row => row.type === 'websocket-frame').map(row => [row.direction, row.opcode]))
    .toEqual([['sent', 1], ['received', 2]]);
  expect(rows.find(row => row.type === 'websocket-error')).toMatchObject({ socketRef: 'socket-1', category: 'frame-error' });
  expect(rows.find(row => row.type === 'websocket-closed')).toMatchObject({ socketRef: 'socket-1' });
  expect(rows.find(row => row.type === 'client-pageerror')).toMatchObject({ target: 'page-1', category: 'TypeError' });
  expect(rows.find(row => row.type === 'client-console')).toMatchObject({ target: 'page-1', level: 'error' });
  expect(rows.find(row => row.type === 'client-dialog')).toMatchObject({ target: 'page-1', dialogType: 'alert' });
  const text = fs.readFileSync(file, 'utf8');
  for (const secret of ['secret-stream', 'private-id', 'secret-frame', 'secret-binary', 'secret-error', 'secret client', 'secret console', 'secret dialog']) {
    expect(text).not.toContain(secret);
  }
});

it('keeps request metadata when body access fails and does not leak or throw', async () => {
  const h = setup();
  const broken = { ...request(), postData: () => { throw new Error('private-body'); } } as Request;
  expect(() => h.context.emit('request', broken)).not.toThrow();
  await h.capture.stop();
  expect(h.rows().find(row => row.type === 'request-start')).toMatchObject({
    requestId: 'req-1',
    body: { state: 'unreadable' }
  });
  expect(fs.readFileSync(h.file, 'utf8')).not.toContain('private-body');
});
it('caps requests and refuses to overwrite a prior capture', async () => {
  const h = setup({maxRequests:2}); for(let i=0;i<10;i++) h.context.emit('request',request());
  const summary = await h.capture.stop(); expect(summary.dropped).toBe(8);
  expect(h.rows().filter(r => r.type==='request-start')).toHaveLength(2);
  const before = fs.readFileSync(h.file,'utf8');
  expect(() => attachRedactedHttpCapture(h.context as unknown as BrowserContext,h.file)).toThrow();
  expect(fs.readFileSync(h.file,'utf8')).toBe(before);
});

it('starts at most two unsettled raw reads and marks the rest capacity-omitted without a read queue', async () => {
  const h = setup({ bodyTimeoutMs: 20 });
  const releases: Array<(b: Buffer) => void> = [];
  const reads = Array.from({ length: 10 }, () => vi.fn(() => new Promise<Buffer>(resolve => releases.push(resolve))));
  for (const read of reads.slice(0, 2)) {
    const req = request(); h.context.emit('request', req); h.context.emit('response', { ...response(req, ''), body: read });
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  for (const read of reads.slice(2)) {
    const req = request(); h.context.emit('request', req); h.context.emit('response', { ...response(req, ''), body: read });
  }
  const summary = await h.capture.stop();
  expect(reads.reduce((count, read) => count + read.mock.calls.length, 0)).toBe(2);
  expect(h.rows().filter(r => r.type === 'response')).toHaveLength(10);
  expect(h.rows().filter(r => r.type === 'response-body' && r.body.state === 'capacity-omitted')).toHaveLength(8);
  expect(summary.bodyOmittedByReason).toMatchObject({ capacity: 8, timeout: 2 });

  releases.forEach(resolve => resolve(Buffer.from('{"err_no":0}')));
  await new Promise(resolve => setImmediate(resolve));
  expect(reads.reduce((count, read) => count + read.mock.calls.length, 0)).toBe(2);
});

it('reuses a raw-read permit only after the original raw promise settles', async () => {
  const h = setup();
  let release!: (body: Buffer) => void;
  const firstRead = vi.fn(() => new Promise<Buffer>(resolve => { release = resolve; }));
  const secondRead = vi.fn(async () => Buffer.from('{"err_no":0}'));
  const first = request();
  h.context.emit('request', first);
  h.context.emit('response', { ...response(first, ''), body: firstRead });
  release(Buffer.from('{"err_no":0}'));
  await new Promise(resolve => setImmediate(resolve));
  const second = request();
  h.context.emit('request', second);
  h.context.emit('response', { ...response(second, ''), body: secondRead });
  await h.capture.stop();
  expect(firstRead).toHaveBeenCalledOnce();
  expect(secondRead).toHaveBeenCalledOnce();
});

it('records requestfailed after response headers as the separate terminal outcome', async () => {
  const h = setup(); const req = request();
  h.context.emit('request', req);
  h.context.emit('response', { ...response(req,''), body: async () => { throw new Error('interrupted'); } });
  h.context.emit('requestfailed', req);
  const result = await h.capture.stop();
  expect(h.rows().filter(r => r.type === 'response')).toHaveLength(1);
  expect(h.rows().filter(r => r.type === 'request-terminal')).toEqual([
    expect.objectContaining({ requestId: 'req-1', outcome: 'failed', error: 'REQUEST_FAILED' })
  ]);
  expect(result).toMatchObject({ headersRecorded: 1, failed: 1, incomplete: 0 });
});

it('preserves route separators and known version/locale words', () => {
  expect(createCaptureRedactor().url('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list')).toMatchObject({
    path: '/luckycat/i18n/capcut/task/v1/task_list'
  });
});

it('records metadata for every observed resource and reports body eligibility separately', async () => {
  const h = setup({ maxRequests: 10 });
  for (const url of [
    'https://www.capcut.com/static-resource/foo.js',
    'https://mon-sg.capcutapi.com/monitor_browser/collect/batch/',
    'https://mcs-normal-sg.capcutapi.com/list',
    'https://analytics.google.com/g/collect'
  ]) h.context.emit('request', { ...request(), url: () => url });
  const actual = request(); h.context.emit('request', actual); h.context.emit('response', response(actual, '{"err_no":0}'));
  const summary = await h.capture.stop();
  expect(h.rows().filter(r => r.type === 'request-start')).toHaveLength(5);
  expect(summary).toMatchObject({ seenRequests: 5, requests: 5, bodyEligible: 1, bodyIneligible: 4, dropped: 0 });
});

it('persists authoritative scheduled, written and failed counts after an output error', async () => {
  class FailingOutput extends Writable {
    override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      callback(new Error('disk failure'));
    }
  }
  const warnings: string[] = [];
  const budget = new SessionEvidenceBudget({ maxBytes: 1024 * 1024 });
  budget.reserve('artifact', 512)?.commit(512);
  const h = setup({
    budget,
    createOutputStream: (_filePath, fd) => {
      fs.closeSync(fd);
      return new FailingOutput();
    },
    onWarning: code => warnings.push(code)
  });
  const summary = await h.capture.stop();
  expect(summary).toMatchObject({ recordsScheduled: 2, recordsWritten: 0, recordsFailed: 2, ioErrors: 2, summaryPersisted: true });
  expect(summary.recordsWritten + summary.recordsFailed).toBe(summary.recordsScheduled);
  expect(warnings).toContain('CAPTURE_WRITE_FAILED');
  const sidecar = JSON.parse(fs.readFileSync(h.file + '.summary.json', 'utf8'));
  expect(sidecar).toMatchObject({ version: 3, captureId: expect.any(String), closure: 'closed-with-errors', summary });
  expect(budget.snapshot()).toMatchObject({
    actualBytes: 512 + fs.statSync(h.file + '.summary.json').size,
    reservedBytes: 0
  });
});

it('bounds a stalled close and records the timeout only in the authoritative sidecar', async () => {
  class StalledCloseOutput extends Writable {
    override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
    override _final(_callback: (error?: Error | null) => void): void { /* intentionally unsettled */ }
  }
  const h = setup({
    closeTimeoutMs: 20,
    createOutputStream: (_filePath, fd) => {
      fs.closeSync(fd);
      return new StalledCloseOutput();
    }
  });
  const summary = await h.capture.stop();
  expect(summary).toMatchObject({ stopTimedOut: true, ioErrors: 1, summaryPersisted: true });
  const sidecar = JSON.parse(fs.readFileSync(h.file + '.summary.json', 'utf8'));
  expect(sidecar).toMatchObject({ closure: 'close-timeout', summary: { stopTimedOut: true, ioErrors: 1 } });
});

it('finalizes accepted writes as failed on close timeout and ignores late write callbacks', async () => {
  const callbacks: Array<(error?: Error | null) => void> = [];
  class DeferredOutput extends Writable {
    override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      callbacks.push(callback);
    }
  }
  const h = setup({
    closeTimeoutMs: 20,
    createOutputStream: (_filePath, fd) => {
      fs.closeSync(fd);
      return new DeferredOutput();
    }
  });
  const req = request();
  h.context.emit('request', req);
  h.context.emit('response', response(req, '{"err_no":0}'));
  const summary = await h.capture.stop();
  const sidecarBefore = fs.readFileSync(h.file + '.summary.json', 'utf8');
  const returnedBefore = JSON.stringify(summary);
  expect(summary).toMatchObject({
    stopTimedOut: true,
    responseHeadersObserved: 1,
    responseHeadersAccepted: 1,
    headersRecorded: 0,
    bodyRecordsObserved: 1,
    bodyRecordsAccepted: 1,
    bodyStored: 0,
    bodyOmittedByReason: { writer: 1 }
  });
  expect(summary.omittedBodies).toBe(1);
  expect(summary.bodyRecordsObserved).toBe(summary.bodyStored + summary.omittedBodies);
  expect(summary.recordOmittedByReason.writer).toBeGreaterThanOrEqual(1);
  callbacks.forEach(callback => callback());
  await new Promise(resolve => setImmediate(resolve));
  expect(JSON.stringify(summary)).toBe(returnedBefore);
  expect(fs.readFileSync(h.file + '.summary.json', 'utf8')).toBe(sidecarBefore);
});

it('closes the exclusively-created descriptor and removes only that new file when stream construction throws', () => {
  const context = new EventEmitter();
  const file = path.join(dir, 'factory-throws.ndjson');
  const unrelated = path.join(dir, 'unrelated.txt');
  fs.writeFileSync(unrelated, 'preserve-me');
  let openedFd = -1;
  expect(() => attachRedactedHttpCapture(context as unknown as BrowserContext, file, {
    createOutputStream: (_filePath, fd) => {
      openedFd = fd;
      throw new Error('factory failed');
    }
  })).toThrow('factory failed');
  expect(() => fs.fstatSync(openedFd)).toThrow();
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.readFileSync(unrelated, 'utf8')).toBe('preserve-me');
});

it('never overwrites a pre-existing final-summary sidecar and reports persistence failure', async () => {
  const h = setup();
  fs.writeFileSync(h.file + '.summary.json', 'prior');
  const summary = await h.capture.stop();
  expect(summary).toMatchObject({ summaryPersisted: false, summaryPersistenceErrors: 1, ioErrors: 1 });
  expect(fs.readFileSync(h.file + '.summary.json', 'utf8')).toBe('prior');
});

it('labels capture-end provisional without embedding a false clean close summary', async () => {
  const h = setup();
  await h.capture.stop();
  const end = h.rows().find(row => row.type === 'capture-end');
  expect(end).toMatchObject({ closure: 'flush-pending' });
  expect(end).not.toHaveProperty('summary.ioErrors');
});
