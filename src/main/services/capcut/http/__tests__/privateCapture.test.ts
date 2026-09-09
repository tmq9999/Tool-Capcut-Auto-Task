import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { attachPrivateCapture } from '../privateCapture';
import { SessionEvidenceBudget } from '../../evidenceBudget';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it('retains body recovery, extra headers and stream correlation only in encrypted records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-capture-')); dirs.push(dir);
  const file = path.join(dir, 'trace.enc');
  const key = randomBytes(32);
  const encrypt = (text: string) => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  };
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string) => {
      if (method === 'Network.getRequestPostData') return { postData: '{"thread_id":"secret-thread"}' };
      if (method === 'Network.streamResourceContent') return { bufferedData: Buffer.from('data: accepted\n\n').toString('base64') };
      return {};
    }), detach: async () => {}
  });
  const context = Object.assign(new EventEmitter(), { pages: () => [{}], newCDPSession: async () => session });
  const capture = await attachPrivateCapture(context as unknown as BrowserContext, file, encrypt);
  capture.mark('design:chat');
  session.emit('Network.requestWillBeSent', { type: 'Fetch', requestId: 'a', request: { url: 'https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/run/start', method: 'POST', hasPostData: true, headers: {} } });
  session.emit('Network.requestWillBeSentExtraInfo', { requestId: 'a', headers: { cookie: 'secret-cookie' } });
  session.emit('Network.responseReceived', { requestId: 'a', response: { mimeType: 'text/event-stream', status: 200 } });
  session.emit('Network.dataReceived', { requestId: 'a', data: Buffer.from('data: complete\n\n').toString('base64') });
  await capture.stop();
  const raw = fs.readFileSync(file, 'utf8');
  expect(raw).not.toContain('secret-');
  const records = raw.trim().split('\n').map(line => {
    const b = Buffer.from(line, 'base64'); const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  });
  expect(records.find(r => r.type === 'request-body')).toMatchObject({ requestId: 'a', stage: 'design:chat', postData: '{"thread_id":"secret-thread"}' });
  expect(records.find(r => r.type === 'request')).toMatchObject({ requestId: 'a', resourceType: 'Fetch' });
  expect(records.find(r => r.type === 'request-extra')).toMatchObject({ headers: { cookie: 'secret-cookie' } });
  expect(records.filter(r => r.type === 'stream')).toHaveLength(2);
  expect(records.at(-1).type).toBe('capture-end');
  expect(session.listenerCount('Network.requestWillBeSent')).toBe(0);
  await expect(attachPrivateCapture(context as unknown as BrowserContext, file, encrypt)).rejects.toThrow();
});

it('limits raw body commands to two across every owned page target and reports capacity honestly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-capture-')); dirs.push(dir);
  const file = path.join(dir, 'trace.enc');
  const key = randomBytes(32);
  const encrypt = (text: string) => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  };
  const bodyResolvers: Array<(value: { body: string }) => void> = [];
  const makeSession = () => Object.assign(new EventEmitter(), {
    send: vi.fn((method: string) => method === 'Network.getResponseBody'
      ? new Promise<{ body: string }>(resolve => bodyResolvers.push(resolve))
      : Promise.resolve({})),
    detach: vi.fn(async () => undefined)
  });
  const sessions = [makeSession(), makeSession()];
  let sessionIndex = 0;
  const pages = [{}, {}];
  const context = Object.assign(new EventEmitter(), {
    pages: () => pages,
    newCDPSession: async () => sessions[sessionIndex++]
  });
  const capture = await attachPrivateCapture(
    context as unknown as BrowserContext,
    file,
    encrypt,
    { budget: new SessionEvidenceBudget({ maxBytes: 1024 * 1024 }) }
  );
  for (const [index, requestId] of ['a', 'b', 'c'].entries()) {
    const session = sessions[index % 2];
    session.emit('Network.requestWillBeSent', {
      requestId, type: 'Fetch', request: { url: 'https://edit-api-sg.capcut.com/lv/body', method: 'GET', headers: {} }
    });
    session.emit('Network.loadingFinished', { requestId, encodedDataLength: 20 });
  }
  expect(sessions.flatMap(session => session.send.mock.calls).filter(call => call[0] === 'Network.getResponseBody')).toHaveLength(2);
  for (const resolve of bodyResolvers) resolve({ body: '{"private":"secret"}' });
  const summary = await capture.stop();
  expect(summary.policyLimit).toBe(1);
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => {
    const b = Buffer.from(line, 'base64'); const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  });
  expect(records.find(record => record.type === 'response-body-missing')).toMatchObject({ reason: 'capacity' });
  expect(sessions.every(session => session.detach.mock.calls.length === 1)).toBe(true);
});

it('uses the shared budget for encrypted records and exposes policy-limit coverage loss', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-capture-')); dirs.push(dir);
  const file = path.join(dir, 'trace.enc');
  const session = Object.assign(new EventEmitter(), { send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) });
  const context = Object.assign(new EventEmitter(), { pages: () => [{}], newCDPSession: async () => session });
  const budget = new SessionEvidenceBudget({ maxBytes: 300 });
  const capture = await attachPrivateCapture(
    context as unknown as BrowserContext,
    file,
    text => Buffer.from(text.repeat(2)),
    { budget }
  );
  for (let index = 0; index < 10; index++) capture.mark(`stage-${index}`);
  const summary = await capture.stop();
  expect(summary.policyLimit).toBeGreaterThan(0);
  expect(budget.snapshot().rejectedReservations).toBeGreaterThan(0);
  expect(summary.bytes).toBeLessThanOrEqual(300);
});
