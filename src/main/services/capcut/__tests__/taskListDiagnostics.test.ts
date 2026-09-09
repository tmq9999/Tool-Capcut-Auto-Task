import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Request, Response } from 'playwright-core';
import { attachTaskListDiagnostics, type TaskListDiagnostic } from '../taskApi';

afterEach(() => vi.useRealTimers());

function fixture() {
  const context = new EventEmitter();
  const controller = new AbortController();
  const events: TaskListDiagnostic[] = [];
  const stop = attachTaskListDiagnostics(context as unknown as BrowserContext, controller.signal, event => events.push(event));
  const request = { url: () => 'https://edit-api-sg.capcut.com/task/v1/task_list?token=private-token' } as Request;
  const response = (body: () => Promise<string>, status = 200) => ({
    request: () => request, status: () => status, text: body,
    headers: () => ({ 'content-type': 'application/json', 'content-length': '512' })
  }) as unknown as Response;
  return { context, controller, events, stop, request, response };
}

describe('passive task-list diagnostics', () => {
  it('correlates request/status/body categories without copying payloads or credentials', async () => {
    const h = fixture();
    h.context.emit('request', h.request);
    h.context.emit('response', h.response(async () => JSON.stringify({
      err_no: 0, token: 'private-token', data: { task_list: [{ task_key: 'capcut_web_pwa_install', task_status: 4, title: 'private-title' }] }
    })));
    await vi.waitFor(() => expect(h.events).toHaveLength(3));
    expect(h.events).toEqual([
      expect.objectContaining({ requestId: 1, phase: 'request' }),
      expect.objectContaining({ requestId: 1, phase: 'response', status: 200 }),
      expect.objectContaining({ requestId: 1, phase: 'body', result: 'valid', taskCount: 1, errNo: 0 })
    ]);
    expect(JSON.stringify(h.events)).not.toMatch(/private-|https:|token|title/);
    h.stop();
    expect(h.context.eventNames()).toEqual([]);
  });

  it.each([
    ['{"data":{"task_list":[]},"err_no":12}', 'empty'],
    ['not-json', 'malformed'],
    ['{"data":{"task_list":{}}}', 'malformed']
  ])('distinguishes %s from a valid task response', async (body, result) => {
    const h = fixture();
    h.context.emit('response', h.response(async () => body));
    await vi.waitFor(() => expect(h.events).toHaveLength(2));
    expect(h.events.at(-1)).toMatchObject({ phase: 'body', result });
    h.stop();
  });

  it('records unreadable response bodies without propagating response errors', async () => {
    const h = fixture();
    h.context.emit('response', h.response(async () => { throw new Error('secret-url'); }, 503));
    await vi.waitFor(() => expect(h.events).toHaveLength(2));
    expect(h.events[0]).toMatchObject({ phase: 'response', status: 503 });
    expect(h.events[1]).toMatchObject({ phase: 'body', result: 'unreadable' });
    expect(JSON.stringify(h.events)).not.toContain('secret-url');
    h.stop();
  });

  it('ignores unrelated domains and reports only categorical request failures', () => {
    const h = fixture();
    h.context.emit('request', { url: () => 'https://other.invalid/task/v1/task_list' });
    h.context.emit('requestfailed', h.request);
    expect(h.events).toEqual([expect.objectContaining({ phase: 'request-failed', requestId: 1 })]);
    h.stop();
  });

  it('observes the real prefixed CapCut task route rather than only a root-relative route', async () => {
    const h = fixture();
    Object.assign(h.request, { url: () => 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list?token=private' });
    h.context.emit('request', h.request);
    h.context.emit('response', h.response(async () => '{"data":{"task_list":[]}}'));
    await vi.waitFor(() => expect(h.events).toHaveLength(3));
    expect(h.events.at(-1)).toMatchObject({ phase: 'body', result: 'empty' });
    h.stop();
  });

  it('bounds a pending body read and never emits a late result', async () => {
    vi.useFakeTimers();
    const h = fixture();
    let release!: (body: string) => void;
    h.context.emit('response', h.response(() => new Promise(resolve => { release = resolve; })));
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.events.at(-1)).toMatchObject({ phase: 'body', result: 'timeout' });
    const count = h.events.length;
    release('{"data":{"task_list":[]}}');
    await vi.runAllTimersAsync();
    expect(h.events).toHaveLength(count);
    h.stop();
  });

  it('abort removes listeners and cancels diagnostic waits without waiting for the body', async () => {
    vi.useFakeTimers();
    const h = fixture();
    let release!: (body: string) => void;
    h.context.emit('response', h.response(() => new Promise(resolve => { release = resolve; })));
    await vi.advanceTimersByTimeAsync(0);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.context.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    release('{"data":{"task_list":[]}}');
    await vi.runAllTimersAsync();
    expect(h.events).toHaveLength(1);
  });

  it('does not let a diagnostic consumer exception escape the request callback', () => {
    const context = new EventEmitter();
    const stop = attachTaskListDiagnostics(context as unknown as BrowserContext, new AbortController().signal, () => {
      throw new Error('observer failed');
    });
    expect(() => context.emit('request', { url: () => 'https://edit-api-sg.capcut.com/task/v1/task_list' })).not.toThrow();
    stop();
  });

  it('does not start a body read when the response observer stops diagnostics', () => {
    const context = new EventEmitter();
    const request = { url: () => 'https://edit-api-sg.capcut.com/task/v1/task_list' } as Request;
    const text = vi.fn(async () => '{}');
    const stop = attachTaskListDiagnostics(context as unknown as BrowserContext, new AbortController().signal, () => stop());
    context.emit('response', { request: () => request, status: () => 200, headers: () => ({}), text });
    expect(text).not.toHaveBeenCalled();
    expect(context.eventNames()).toEqual([]);
  });

  it('does not read an oversized advertised body', () => {
    const h = fixture();
    const text = vi.fn(async () => '{}');
    const response = h.response(text);
    Object.assign(response, { headers: () => ({ 'content-length': '2097152' }) });
    h.context.emit('response', response);
    expect(h.events.at(-1)).toMatchObject({ phase: 'body', result: 'omitted' });
    expect(text).not.toHaveBeenCalled();
    h.stop();
  });

  it('survives a response metadata exception without affecting the event emitter', () => {
    const h = fixture();
    const response = h.response(async () => '{}');
    Object.assign(response, { status: () => { throw new Error('private transport details'); } });
    expect(() => h.context.emit('response', response)).not.toThrow();
    expect(h.events).toEqual([]);
    h.stop();
  });

  it('counts only one body read for a duplicate response event', async () => {
    const h = fixture();
    const text = vi.fn(async () => '{"data":{"task_list":[]}}');
    const response = h.response(text);
    h.context.emit('response', response);
    h.context.emit('response', response);
    await vi.waitFor(() => expect(h.events.filter(event => event.phase === 'body')).toHaveLength(1));
    expect(text).toHaveBeenCalledOnce();
    h.stop();
  });

  it.each([undefined, 'invalid', '-1', '2097152'])(
    'omits body reads with unbounded declared length %s', length => {
      const h = fixture();
      const text = vi.fn(async () => '{}');
      const response = h.response(text);
      Object.assign(response, { headers: () => ({ 'content-length': length }) });
      h.context.emit('response', response);
      expect(h.events.at(-1)).toMatchObject({ phase: 'body', result: 'omitted' });
      expect(text).not.toHaveBeenCalled();
      h.stop();
    }
  );

  it('retains all four raw read slots after timeout until the raw reads settle', async () => {
    vi.useFakeTimers();
    const h = fixture();
    const text = vi.fn(() => new Promise<string>(() => {}));
    for (let i = 0; i < 4; i++) h.context.emit('response', h.response(text));
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.events.filter(event => event.result === 'timeout')).toHaveLength(4);
    h.context.emit('response', h.response(text));
    expect(text).toHaveBeenCalledTimes(4);
    expect(h.events.at(-1)).toMatchObject({ phase: 'body', result: 'omitted' });
    h.stop();
  });
});
