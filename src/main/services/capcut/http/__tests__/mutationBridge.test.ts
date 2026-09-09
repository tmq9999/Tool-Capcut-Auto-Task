import { expect, it, vi } from 'vitest';
import { attachMutationBridge } from '../mutationBridge';

type FakeRoute = { request: () => { url: () => string; method: () => string; postData: () => string; headers: () => Record<string, string> }; fetch: ReturnType<typeof vi.fn>; fulfill: ReturnType<typeof vi.fn>; continue: ReturnType<typeof vi.fn> };

it('forwards one signed API request through the account API context and fulfills it', async () => {
  const response = { status: () => 200 };
  const route = { request: () => ({ url: () => 'https://edit-api-sg.capcut.com/lv/v2/canvas/save?X-Bogus=fresh', method: () => 'POST', postData: () => '{"draft_id":"fresh"}', headers: () => ({ sign: 'fresh' }) }), fetch: vi.fn(), fulfill: vi.fn(), continue: vi.fn() };
  let handler!: (route: FakeRoute) => Promise<void>;
  const context = { request: { fetch: vi.fn().mockResolvedValue(response) }, route: vi.fn(async (_p: string, fn: (route: FakeRoute) => Promise<void>) => { handler = fn; }), unroute: vi.fn() };
  const stop = await attachMutationBridge(context as never);
  await handler(route);
  expect(context.request.fetch).toHaveBeenCalledWith(route.request().url(), expect.objectContaining({ data: '{"draft_id":"fresh"}', maxRetries: 0, maxRedirects: 0 }));
  expect(route.fulfill).toHaveBeenCalledWith({ response });
  expect(route.continue).not.toHaveBeenCalled();
  await stop();
});

it('continues unrelated resources without interception', async () => {
  const route = { request: () => ({ url: () => 'https://www.capcut.com/home', method: () => 'GET', postData: () => '', headers: () => ({}) }), fetch: vi.fn(), fulfill: vi.fn(), continue: vi.fn() };
  let handler!: (route: FakeRoute) => Promise<void>;
  const context = { request: { fetch: vi.fn() }, route: vi.fn(async (_p: string, fn: (route: FakeRoute) => Promise<void>) => { handler = fn; }), unroute: vi.fn() };
  await attachMutationBridge(context as never);
  await handler(route);
  expect(route.continue).toHaveBeenCalledOnce();
  expect(context.request.fetch).not.toHaveBeenCalled();
});
