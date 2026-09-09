import { describe, expect, it, vi } from 'vitest';
import type { Page, Route } from 'playwright-core';

describe('offline selector fixture boundary', () => {
  it('installs deny-by-default routing before navigation and never serves a remote resource', async () => {
    const module = await import('../../tools/offlineFixture');
    const events: string[] = [];
    let handler: ((route: Route) => Promise<void>) | undefined;
    const page = {
      route: vi.fn(async (_pattern: string, callback: typeof handler) => { events.push('route'); handler = callback; }),
      goto: vi.fn(async () => { events.push('goto'); })
    } as unknown as Page;
    await module.loadOfflineFixture(page, '<script src="https://example.invalid/secret.js"></script><div>fixture</div>');
    expect(events).toEqual(['route', 'goto']);
    const fulfill = vi.fn();
    const abort = vi.fn();
    const localRoute = { request: () => ({ url: () => 'http://127.0.0.1/offline-fixture', method: () => 'GET' }), fulfill, abort } as unknown as Route;
    await handler!(localRoute);
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({
      'content-security-policy': expect.stringContaining("script-src 'none'")
    }) }));
    fulfill.mockClear();
    for (const url of ['https://example.invalid/secret.js', 'http://127.0.0.1/another', 'http://localhost/private']) {
      await handler!({ request: () => ({ url: () => url, method: () => 'GET' }), fulfill, abort } as unknown as Route);
    }
    expect(abort).toHaveBeenCalledTimes(3);
    expect(fulfill).not.toHaveBeenCalled();
  });

  it('does not navigate when cancellation arrives while route installation is pending', async () => {
    const module = await import('../../tools/offlineFixture');
    const controller = new AbortController();
    let releaseRoute!: () => void;
    const routePending = new Promise<void>((resolve) => { releaseRoute = resolve; });
    const page = {
      route: vi.fn(async () => routePending),
      goto: vi.fn(async () => {})
    } as unknown as Page;

    const loading = module.loadOfflineFixture(page, '<div>fixture</div>', controller.signal);
    controller.abort(new Error('test abort'));
    releaseRoute();

    await expect(loading).rejects.toThrow('test abort');
    expect(page.goto).not.toHaveBeenCalled();
  });
});
