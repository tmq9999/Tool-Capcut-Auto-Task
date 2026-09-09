import { Buffer } from 'node:buffer';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createCycleTlsContext } from '../cycleTlsContext';

const servers: Server[] = [];
const contexts: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.dispose()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('CycleTLS native localhost integration', () => {
  it('preserves multi-cookie rotation, binary bytes, redirect policy, and malformed JSON rejection', async () => {
    const binary = Buffer.from([0x00, 0xff, 0x80, 0x41]);
    const origin = await listen((request, response) => {
      if (request.url === '/cookies') {
        response.setHeader('Set-Cookie', ['sid=fresh; Path=/', 'theme=dark; Path=/']);
        response.end('set');
      } else if (request.url === '/echo') {
        response.end(request.headers.cookie ?? '');
      } else if (request.url === '/binary') {
        response.setHeader('content-type', 'application/octet-stream');
        response.end(binary);
      } else if (request.url === '/upload') {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(Buffer.from(chunk)));
        request.on('end', () => response.end(Buffer.concat(chunks)));
      } else if (request.url === '/redirect') {
        response.writeHead(302, { location: '/echo' });
        response.end();
      } else {
        response.setHeader('content-type', 'application/json');
        response.end('{broken');
      }
    });
    const context = await createCycleTlsContext({ initialCookie: { header: 'sid=stale', origin } });
    contexts.push(context);

    await context.get(`${origin}/cookies`);
    expect(await (await context.get(`${origin}/echo`)).text()).toBe('sid=fresh; theme=dark');
    expect(await (await context.get(`${origin}/binary`)).body()).toEqual(binary);
    expect(await (await context.fetch(`${origin}/upload`, {
      method: 'POST',
      data: binary
    })).body()).toEqual(binary);
    const redirect = await context.get(`${origin}/redirect`);
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe('/echo');
    await expect((await context.get(`${origin}/bad-json`)).json()).rejects.toBeInstanceOf(SyntaxError);
  }, 20_000);

  it('returns stream headers before delayed end and keeps another account responsive when one aborts', async () => {
    const origin = await listen((request, response) => {
      if (request.url === '/stream') {
        response.setHeader('Set-Cookie', 'sid=stream; Path=/');
        response.write('first');
        setTimeout(() => response.end('-last'), 250);
      } else if (request.url === '/hang') {
        setTimeout(() => response.end('late'), 5_000);
      } else {
        response.end(request.headers.cookie ?? 'ready');
      }
    });
    const first = await createCycleTlsContext({ timeoutMs: 10_000 });
    const second = await createCycleTlsContext({ timeoutMs: 10_000 });
    contexts.push(first, second);

    const stream = await first.stream(`${origin}/stream`);
    expect(stream.headers()['set-cookie']).toBe('sid=stream; Path=/');
    const chunks: Buffer[] = [];
    for await (const chunk of stream.body) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('first-last');
    expect(await (await first.get(`${origin}/echo`)).text()).toBe('sid=stream');

    const abort = new AbortController();
    const hanging = first.get(`${origin}/hang`, { signal: abort.signal });
    const aborted = expect(hanging).rejects.toThrow('NATIVE_HTTP_ABORTED');
    abort.abort();
    const startedAt = Date.now();
    expect(await (await second.get(`${origin}/ready`)).text()).toBe('ready');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await aborted;
  }, 20_000);
});
