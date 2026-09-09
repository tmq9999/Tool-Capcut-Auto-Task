import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createCycleTlsDriver } from '../cycleTlsRuntime';

const servers: Server[] = [];
const drivers: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(drivers.splice(0).map(driver => driver.dispose()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function localServer(streamGate?: Promise<void>): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === '/stream') {
      response.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
      response.write('first');
      void (streamGate ?? Promise.resolve()).then(() => response.end('-last'));
      return;
    }
    if (request.url === '/disconnect') {
      response.write('partial');
      setTimeout(() => response.socket?.destroy(), 20);
      return;
    }
    if (request.url === '/hang') return;
    if (request.url === '/slow') {
      setTimeout(() => response.end('slow-ok'), 100);
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/echo' });
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => response.end(Buffer.concat(chunks)));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function driver() {
  const value = await createCycleTlsDriver({ startupTimeoutMs: 5_000, requestTimeoutMs: 5_000 });
  drivers.push(value);
  return value;
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  exitCode: number | null = null;
  killCalls = 0;
  exitOnKill = false;

  kill(): boolean {
    this.killCalls += 1;
    if (this.exitOnKill) this.exit(0);
    return true;
  }

  exit(code: number | null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  terminateCalls: number = 0;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    callback?.();
  }

  terminate(): void {
    this.terminateCalls += 1;
    this.readyState = WebSocket.CLOSED;
  }
}

function fakeRuntime(child: FakeChild, socket: FakeSocket, port: number) {
  return {
    allocatePort: async () => port,
    resolveExecutable: () => 'C:\\fake\\cycletls-bridge.exe',
    spawnProcess: () => {
      queueMicrotask(() => child.stdout.write(`READY:${port}\n`));
      return child as never;
    },
    createSocket: () => {
      queueMicrotask(() => socket.open());
      return socket as never;
    }
  };
}

describe('CycleTLS owned IPC runtime', () => {
  it('resolves stream metadata before end and preserves repeated headers', async () => {
    let releaseStream: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { releaseStream = resolve; });
    const origin = await localServer(gate);
    const native = await driver();
    const response = await native.request({
      url: `${origin}/stream`, method: 'GET', headers: {}, timeoutMs: 3_000, stream: true
    });

    expect(response.headers.filter(header => header.name === 'Set-Cookie')).toEqual([
      { name: 'Set-Cookie', value: 'a=1; Path=/' },
      { name: 'Set-Cookie', value: 'b=2; Path=/' }
    ]);
    releaseStream?.();
    const chunks: Buffer[] = [];
    for await (const chunk of response.body as AsyncIterable<Buffer>) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('first-last');
  });

  it('surfaces a midstream socket failure instead of clean EOF', async () => {
    const origin = await localServer();
    const native = await driver();
    const response = await native.request({
      url: `${origin}/disconnect`, method: 'GET', headers: {}, timeoutMs: 3_000, stream: true
    });
    const consume = async () => {
      for await (const _chunk of response.body as AsyncIterable<Buffer>) { /* consume */ }
    };
    await expect(consume()).rejects.toThrow(/CYCLETLS_NATIVE_ERROR_/);
  });

  it('round-trips arbitrary binary request and response bytes exactly', async () => {
    const origin = await localServer();
    const native = await driver();
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x41, 0xfe]);
    const response = await native.request({
      url: `${origin}/echo`, method: 'POST', headers: {}, body: bytes,
      timeoutMs: 3_000, stream: false, maxBytes: 32
    });
    expect(response.body).toEqual(bytes);
  });

  it('cancels only the aborted request and keeps the driver usable', async () => {
    const origin = await localServer();
    const native = await driver();
    const abort = new AbortController();
    const hanging = native.request({
      url: `${origin}/hang`, method: 'GET', headers: {}, timeoutMs: 4_000,
      stream: false, signal: abort.signal
    });
    abort.abort();
    await expect(hanging).rejects.toThrow('CYCLETLS_REQUEST_ABORTED');

    const response = await native.request({
      url: `${origin}/echo`, method: 'POST', headers: {}, body: 'still-alive',
      timeoutMs: 3_000, stream: false
    });
    expect((response.body as Buffer).toString()).toBe('still-alive');
  });

  it('fails bounded buffering instead of accepting an oversized response', async () => {
    const origin = await localServer();
    const native = await driver();
    await expect(native.request({
      url: `${origin}/echo`, method: 'POST', headers: {}, body: '12345',
      timeoutMs: 3_000, stream: false, maxBytes: 4
    })).rejects.toThrow('CYCLETLS_RESPONSE_TOO_LARGE');
  });

  it('correlates parallel requests and isolates separately owned drivers', async () => {
    const origin = await localServer();
    const first = await driver();
    const second = await driver();
    const [one, two, other] = await Promise.all([
      first.request({ url: `${origin}/echo`, method: 'POST', headers: {}, body: 'one', timeoutMs: 3_000, stream: false }),
      first.request({ url: `${origin}/echo`, method: 'POST', headers: {}, body: 'two', timeoutMs: 3_000, stream: false }),
      second.request({ url: `${origin}/echo`, method: 'POST', headers: {}, body: 'other', timeoutMs: 3_000, stream: false })
    ]);
    expect([(one.body as Buffer).toString(), (two.body as Buffer).toString(), (other.body as Buffer).toString()]).toEqual(['one', 'two', 'other']);

    await first.dispose();
    const alive = await second.request({
      url: `${origin}/echo`, method: 'POST', headers: {}, body: 'alive', timeoutMs: 3_000, stream: false
    });
    expect((alive.body as Buffer).toString()).toBe('alive');
  });

  it('rejects an occupied allocated port instead of attaching to its service', async () => {
    const occupied = createTcpServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '127.0.0.1', resolve);
    });
    const port = (occupied.address() as AddressInfo).port;
    try {
      await expect(createCycleTlsDriver(
        { startupTimeoutMs: 1_000, requestTimeoutMs: 1_000 },
        { allocatePort: async () => port }
      )).rejects.toThrow('CYCLETLS_CHILD_EXITED');
    } finally {
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  });

  it('uses the request deadline instead of shortening it to the driver default', async () => {
    const origin = await localServer();
    const native = await createCycleTlsDriver({ startupTimeoutMs: 5_000, requestTimeoutMs: 20 });
    drivers.push(native);
    const response = await native.request({
      url: `${origin}/slow`, method: 'GET', headers: {}, timeoutMs: 500, stream: false
    });
    expect((response.body as Buffer).toString()).toBe('slow-ok');
  });

  it('does not let TLS options override redirect policy', async () => {
    const origin = await localServer();
    const native = await createCycleTlsDriver({
      startupTimeoutMs: 5_000,
      requestTimeoutMs: 3_000,
      tls: { disableRedirect: false } as never
    });
    drivers.push(native);
    const response = await native.request({
      url: `${origin}/redirect`, method: 'GET', headers: {}, timeoutMs: 1_000, stream: false
    });
    expect(response.status).toBe(302);
  });

  it('releases a reserved port when executable resolution fails', async () => {
    const probe = createTcpServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 },
      { allocatePort: async () => port, resolveExecutable: () => { throw new Error('missing'); } }
    )).rejects.toThrow('missing');
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 5_000, requestTimeoutMs: 1_000 },
      { allocatePort: async () => port }
    );
    drivers.push(native);
  });

  it('rejects duplicate opaque request IDs without replacing the first operation', async () => {
    const origin = await localServer();
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 5_000, requestTimeoutMs: 3_000 },
      { createRequestId: () => '11111111-1111-4111-8111-111111111111' }
    );
    drivers.push(native);
    const abort = new AbortController();
    const first = native.request({
      url: `${origin}/hang`, method: 'GET', headers: {}, timeoutMs: 2_000, stream: false, signal: abort.signal
    });
    await expect(native.request({
      url: `${origin}/echo`, method: 'GET', headers: {}, timeoutMs: 1_000, stream: false
    })).rejects.toThrow('CYCLETLS_REQUEST_ID_COLLISION');
    abort.abort();
    await expect(first).rejects.toThrow('CYCLETLS_REQUEST_ABORTED');
  });

  it('does not dispatch when abort fires while the request listener is registered', async () => {
    const child = new FakeChild();
    child.exitOnKill = true;
    const socket = new FakeSocket();
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 },
      fakeRuntime(child, socket, 48101)
    );
    const listeners = new Set<EventListenerOrEventListenerObject>();
    let aborted = false;
    const signal = {
      get aborted() { return aborted; },
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
        listeners.add(listener);
        aborted = true;
        if (typeof listener === 'function') listener(new Event('abort'));
        else listener.handleEvent(new Event('abort'));
      },
      removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
        listeners.delete(listener);
      }
    } as AbortSignal;

    await expect(native.request({
      url: 'https://example.test/hang', method: 'GET', headers: {}, timeoutMs: 50,
      stream: false, signal
    })).rejects.toThrow('CYCLETLS_REQUEST_ABORTED');
    expect(socket.sent
      .map(frame => JSON.parse(frame) as { options?: unknown })
      .filter(frame => frame.options !== undefined)).toEqual([]);
    await native.dispose();
  });

  it('rejects a low-level direct CapCut request before sending a native frame', async () => {
    const child = new FakeChild();
    child.exitOnKill = true;
    const socket = new FakeSocket();
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 },
      fakeRuntime(child, socket, 48105)
    );

    await expect(native.request({
      url: 'https://www.capcut.com/', method: 'GET', headers: {}, timeoutMs: 50, stream: false
    })).rejects.toThrow('CYCLETLS_CAPCUT_PROXY_REQUIRED');
    expect(socket.sent
      .map(frame => JSON.parse(frame) as { options?: unknown })
      .filter(frame => frame.options !== undefined)).toEqual([]);
    await native.dispose();
  });

  it('rejects a low-level trailing-dot CapCut request before sending a native frame', async () => {
    const child = new FakeChild();
    child.exitOnKill = true;
    const socket = new FakeSocket();
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 },
      fakeRuntime(child, socket, 48106)
    );

    await expect(native.request({
      url: 'https://edit-api-sg.capcutapi.com../events', method: 'GET', headers: {}, timeoutMs: 50, stream: false
    })).rejects.toThrow('CYCLETLS_CAPCUT_PROXY_REQUIRED');
    expect(socket.sent
      .map(frame => JSON.parse(frame) as { options?: unknown })
      .filter(frame => frame.options !== undefined)).toEqual([]);
    await native.dispose();
  });

  it('fails startup cleanup and retains the port until child exit is confirmed', async () => {
    const port = 48102;
    const child = new FakeChild();
    const socket = new FakeSocket();
    const dependencies = fakeRuntime(child, socket, port);
    dependencies.createSocket = () => {
      queueMicrotask(() => socket.emit('error', new Error('connect failed')));
      return socket as never;
    };

    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 20, requestTimeoutMs: 20 }, dependencies
    )).rejects.toThrow('CYCLETLS_CLEANUP_UNCONFIRMED');
    expect(socket.terminateCalls).toBe(1);
    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 20, requestTimeoutMs: 20 }, {
        ...dependencies,
        resolveExecutable: () => { throw new Error('PORT_WAS_RELEASED'); }
      }
    )).rejects.toThrow('CYCLETLS_PORT_ALLOCATION_FAILED');

    child.exit(1);
    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 20, requestTimeoutMs: 20 }, {
        ...dependencies,
        resolveExecutable: () => { throw new Error('PORT_RELEASED_AFTER_EXIT'); }
      }
    )).rejects.toThrow('PORT_RELEASED_AFTER_EXIT');
  });

  it('retains a socket-failed driver port until its child exits', async () => {
    const port = 48103;
    const child = new FakeChild();
    const socket = new FakeSocket();
    const dependencies = fakeRuntime(child, socket, port);
    const native = await createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 }, dependencies
    );

    socket.emit('close');
    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 20, requestTimeoutMs: 20 }, {
        ...dependencies,
        resolveExecutable: () => { throw new Error('PORT_WAS_RELEASED'); }
      }
    )).rejects.toThrow('CYCLETLS_PORT_ALLOCATION_FAILED');

    child.exit(1);
    await native.dispose();
    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 20, requestTimeoutMs: 20 }, {
        ...dependencies,
        resolveExecutable: () => { throw new Error('PORT_RELEASED_AFTER_EXIT'); }
      }
    )).rejects.toThrow('PORT_RELEASED_AFTER_EXIT');
  });

  it('does not return a driver when the child exits immediately after socket open', async () => {
    const port = 48104;
    const child = new FakeChild();
    const socket = new FakeSocket();
    const dependencies = fakeRuntime(child, socket, port);
    dependencies.createSocket = () => {
      queueMicrotask(() => {
        socket.open();
        child.exit(1);
      });
      return socket as never;
    };

    await expect(createCycleTlsDriver(
      { startupTimeoutMs: 100, requestTimeoutMs: 100 }, dependencies
    )).rejects.toThrow('CYCLETLS_CHILD_EXITED');
  });
});
