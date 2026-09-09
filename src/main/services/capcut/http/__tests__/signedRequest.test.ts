import { expect, it, vi } from 'vitest';
import { assertSignedRequest, captureNextSignedRequest } from '../signedRequest';

it('captures one browser-signed request draft without editing its query or body', async () => {
  const request = { url: () => 'https://edit-api-sg.capcut.com/lv/v2/canvas/save?X-Bogus=current', method: () => 'POST', postData: () => '{"draft_id":"fresh"}', headers: () => ({ 'content-type': 'application/json', sign: 'current' }) };
  const page = { waitForRequest: vi.fn(async (predicate: (r: typeof request) => boolean) => { expect(predicate(request)).toBe(true); return { path: '/lv/v2/canvas/save?X-Bogus=current', method: 'POST', body: '{"draft_id":"fresh"}', headers: { 'content-type': 'application/json', sign: 'current' } }; }) } as never;
  const draft = await captureNextSignedRequest(page, r => r.path.startsWith('/lv/v2/canvas/save'), async () => {});
  assertSignedRequest(draft);
  expect(draft.path).toContain('X-Bogus=current');
  expect(draft.body).toBe('{"draft_id":"fresh"}');
});

it('rejects unsigned or newline-injected drafts', () => {
  expect(() => assertSignedRequest({ path: '/x', method: 'POST', headers: {} })).toThrow('CAPCUT_SIGNED_REQUEST_INVALID');
  expect(() => assertSignedRequest({ path: '/x\n/y', method: 'GET', headers: { 'content-type': 'application/json' } })).toThrow('CAPCUT_SIGNED_REQUEST_INVALID');
});
