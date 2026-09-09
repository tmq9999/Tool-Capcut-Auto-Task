import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createHttpOnlySession } from '../httpSessionFactory';
import type { NativeHttpContext } from '../nativeHttpContext';

function nativeContext(): NativeHttpContext {
  return {
    transport: 'cycletls',
    fetch: async () => { throw new Error('unused'); },
    get: async () => { throw new Error('unused'); },
    stream: async () => { throw new Error('unused'); },
    dispose: vi.fn(async () => undefined)
  };
}

describe('HTTP-only session factory', () => {
  it('uses a real native session for localhost requests and keeps rotated cookies in its jar', async () => {
    const target = http.createServer((request, response) => {
      if (request.url === '/rotate') response.setHeader('set-cookie', 'sid=rotated; Path=/; HttpOnly');
      response.end(request.headers.cookie ?? 'none');
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as AddressInfo).port;
    const sockets = new Set<Duplex>();
    const proxy = http.createServer();
    proxy.on('connect', (_request, downstream, head) => {
      const upstream = net.connect(targetPort, '127.0.0.1');
      sockets.add(upstream);
      sockets.add(downstream);
      upstream.on('error', () => downstream.destroy());
      downstream.on('error', () => upstream.destroy());
      upstream.once('connect', () => {
        downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(downstream);
        downstream.pipe(upstream);
      });
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const live = await createHttpOnlySession({
      accountId: 'a',
      proxy: { server: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` },
      headers: {}
    });
    try {
      await (await live.session.context.get('http://session.example.test/rotate')).dispose();
      const echo = await live.session.context.get('http://session.example.test/echo');
      expect(await echo.text()).toBe('sid=rotated');
      await echo.dispose();
    } finally {
      await live.dispose();
      for (const socket of sockets) socket.destroy();
      proxy.closeAllConnections();
      target.closeAllConnections();
      await Promise.all([proxy, target].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    }
  }, 20_000);

  it('imports an initial cookie once and excludes it from reusable session headers', async () => {
    const context = nativeContext();
    const createContext = vi.fn(async () => context);
    const live = await createHttpOnlySession({
      accountId: 'account-a',
      proxy: { server: 'http://127.0.0.1:9' },
      origin: 'https://www.capcut.com',
      headers: { Cookie: 'sid=initial', Authorization: 'Bearer synthetic' }
    }, { createContext });
    expect(createContext).toHaveBeenCalledWith({
      proxy: { server: 'http://127.0.0.1:9' },
      initialCookie: { header: 'sid=initial', origin: 'https://www.capcut.com' }
    });
    expect(live.session.context).toBe(context);
    expect(live.session.headers).toEqual({ Authorization: 'Bearer synthetic' });
  });

  it('passes explicit TLS settings to the native context', async () => {
    const createContext = vi.fn(async () => nativeContext());
    await createHttpOnlySession({
      accountId: 'account-a',
      proxy: { server: 'http://127.0.0.1:9' },
      headers: {},
      tls: { ja3: 'synthetic-ja3' }
    }, { createContext });
    expect(createContext).toHaveBeenCalledWith(expect.objectContaining({ tls: { ja3: 'synthetic-ja3' } }));
  });

  it.each([
    { accountId: '', proxy: { server: 'http://127.0.0.1:9' }, headers: {}, error: 'HTTP_SESSION_ACCOUNT_ID_REQUIRED' },
    { accountId: 'a', proxy: { server: 'invalid' }, headers: {}, error: 'HTTP_SESSION_PROXY_INVALID' },
    { accountId: 'a', proxy: { server: 'http://127.0.0.1:9' }, headers: {}, expiresAt: 1, error: 'HTTP_SESSION_EXPIRED' }
  ])('rejects invalid identity, proxy, or expiry before native initialization: $error', async ({ error, ...material }) => {
    const createContext = vi.fn(async () => nativeContext());
    await expect(createHttpOnlySession(material, { createContext })).rejects.toThrow(error);
    expect(createContext).not.toHaveBeenCalled();
  });

  it('delegates live-session disposal to its account-owned native context', async () => {
    const context = nativeContext();
    const live = await createHttpOnlySession({ accountId: 'a', proxy: { server: 'http://127.0.0.1:9' }, headers: {} }, { createContext: async () => context });
    await live.dispose();
    expect(context.dispose).toHaveBeenCalledOnce();
  });
});
