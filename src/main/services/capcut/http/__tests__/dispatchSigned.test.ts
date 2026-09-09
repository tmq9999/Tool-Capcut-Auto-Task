import { expect, it, vi } from 'vitest';
import { CapcutHttpClient } from '../CapcutHttpClient';

it('dispatches immutable signed body and query without rebuilding the request', async () => {
  const fetch = vi.fn().mockResolvedValue({ status: () => 200, ok: () => true, body: async () => Buffer.from('{"ret":0}') });
  const client = CapcutHttpClient.fromRequestContext({ fetch } as never);
  const signed = { path: '/lv/v2/intelligence/thread/run/start?X-Bogus=fresh', method: 'POST' as const, body: '{"thread_id":"fresh"}', headers: { 'content-type': 'application/json', sign: 'fresh' }, effect: 'mutation' as const };
  await expect(client.dispatchSigned(signed)).resolves.toMatchObject({ status: 200 });
  expect(fetch).toHaveBeenCalledWith('https://edit-api-sg.capcut.com' + signed.path, expect.objectContaining({ data: signed.body, headers: signed.headers, maxRetries: 0, maxRedirects: 0 }));
});
