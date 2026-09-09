import { expect, it } from 'vitest';
import { observedTaskRequest } from '../observedTaskRequest';

const base = { sessionId: 1, requestId: 'r', at: 100 };
const request = { ...base, request: { url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', method: 'POST', postData: '{"scene":"captured-scene"}', headers: { sign: 'synthetic', 'content-type': 'application/json' } } };
const extra = { ...base, type: 'request-extra', headers: { Cookie: 'session=synthetic', ':authority': 'evil.example', 'Proxy-Authorization': 'forbidden' } };

it('uses exact observed request bytes and cookie headers within one session', () => {
  const result = observedTaskRequest([request, extra]);
  expect(result.origin).toBe('https://edit-api-sg.capcut.com');
  expect(result.request).toEqual({ path: '/luckycat/i18n/capcut/task/v1/task_list', method: 'POST', body: '{"scene":"captured-scene"}', effect: 'read', headers: { sign: 'synthetic', 'content-type': 'application/json', cookie: 'session=synthetic' } });
});

it.each([
  [request, { ...extra, sessionId: 2 }],
  [{ ...request, request: { ...request.request, postData: '{}' } }, extra],
  [{ ...request, request: { ...request.request, url: 'https://evil.example/luckycat/i18n/capcut/task/v1/task_list' } }, extra],
  [{ ...request, request: { ...request.request, url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action' } }, extra],
])('rejects missing session credentials, missing scene or non-read contracts', (...rows) => {
  expect(() => observedTaskRequest(rows)).toThrow('CAPCUT_HTTP_READ_CONTRACT_UNAVAILABLE');
});
