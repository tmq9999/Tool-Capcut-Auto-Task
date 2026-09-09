import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import type { NativeHttpHeader } from './nativeHttpContext';
import { parseCycleTlsFrame, type CycleTlsFrame } from './cycleTlsProtocol';

export interface CycleTlsProxy { readonly server: string; readonly username?: string; readonly password?: string }
export interface CycleTlsFingerprintOptions {
  readonly ja3?: string; readonly ja4r?: string; readonly http2Fingerprint?: string; readonly quicFingerprint?: string;
  readonly disableGrease?: boolean; readonly userAgent?: string; readonly forceHTTP1?: boolean; readonly forceHTTP3?: boolean;
}
export interface CycleTlsDriverOptions {
  proxy?: CycleTlsProxy; startupTimeoutMs: number; requestTimeoutMs: number; tls?: CycleTlsFingerprintOptions;
}
export interface CycleTlsDriverRequest {
  url: string; method: string; headers: Record<string, string>; body?: string | Buffer;
  timeoutMs: number; stream: boolean; signal?: AbortSignal; maxBytes?: number;
}
export interface CycleTlsDriverResponse {
  status: number; headers: NativeHttpHeader[]; body: Buffer | AsyncIterable<Buffer>;
  finalUrl: string; dispose?: () => Promise<void>;
}
export interface CycleTlsDriver { request(request: CycleTlsDriverRequest): Promise<CycleTlsDriverResponse>; dispose(): Promise<void> }

interface ChildLike {
  stdout: NodeJS.ReadableStream;
  exitCode: number | null;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}
interface RuntimeSpawnOptions {
  shell: false;
  windowsHide: true;
  stdio: ['ignore', 'pipe', 'ignore'];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
export interface CycleTlsRuntimeDependencies {
  allocatePort?: () => Promise<number>;
  resolveExecutable?: () => string;
  spawnProcess?: (command: string, args: readonly string[], options: RuntimeSpawnOptions) => ChildLike;
  createSocket?: (url: string) => WebSocket;
  createRequestId?: () => string;
}
interface Metadata { status: number; headers: NativeHttpHeader[]; finalUrl: string }
interface PendingRequest {
  stream: boolean; maxBytes: number; receivedBytes: number; chunks: Buffer[]; metadata?: Metadata;
  queue?: BoundedAsyncQueue; resolve: (response: CycleTlsDriverResponse) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void;
}

const reservedPorts = new Set<number>();
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

class BoundedAsyncQueue implements AsyncIterable<Buffer> {
  private readonly values: Buffer[] = [];
  private readonly waiters: Array<{ resolve: (result: IteratorResult<Buffer>) => void; reject: (error: Error) => void }> = [];
  private ended = false;
  private failure?: Error;

  push(value: Buffer): void {
    if (this.ended || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }
  end(): void {
    if (this.ended || this.failure) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }
  fail(error: Error): void {
    if (this.ended || this.failure) return;
    this.failure = error;
    this.values.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  [Symbol.asyncIterator](): AsyncIterator<Buffer> {
    return { next: async () => {
      if (this.failure) throw this.failure;
      const value = this.values.shift();
      if (value) return { done: false, value };
      if (this.ended) return { done: true, value: undefined };
      return new Promise<IteratorResult<Buffer>>((resolve, reject) => this.waiters.push({ resolve, reject }));
    } };
  }
}

export function resolveCycleTlsExecutable(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'cycletls-bridge', 'index.exe')] : []),
    path.resolve(process.cwd(), 'build', 'cycletls-bridge', 'index.exe')
  ];
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error('CYCLETLS_BINARY_MISSING');
  return executable;
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return void server.close(() => reject(new Error('CYCLETLS_PORT_ALLOCATION_FAILED')));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function reserveUniquePort(allocate: () => Promise<number>): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await allocate();
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== 9119 && !reservedPorts.has(port)) {
      reservedPorts.add(port);
      return port;
    }
  }
  throw new Error('CYCLETLS_PORT_ALLOCATION_FAILED');
}
function childEnvironment(port: number): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { WS_PORT: String(port) };
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'] as const) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}
function proxyUrl(proxy: CycleTlsProxy | undefined): string | undefined {
  if (!proxy) return undefined;
  const parsed = new URL(proxy.server);
  if (proxy.username !== undefined) parsed.username = proxy.username;
  if (proxy.password !== undefined) parsed.password = proxy.password;
  return parsed.toString();
}

export function validatedCycleTlsProxy(proxy: CycleTlsProxy | undefined, errorCode = 'CYCLETLS_PROXY_INVALID'): CycleTlsProxy | undefined {
  if (!proxy) return undefined;
  if (typeof proxy.server !== 'string' || /[\r\n\0]/.test(proxy.server)) throw runtimeError(errorCode);
  let parsed: URL;
  try {
    parsed = new URL(proxy.server);
  } catch {
    throw runtimeError(errorCode);
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname ||
      parsed.username || parsed.password || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw runtimeError(errorCode);
  }
  for (const value of [proxy.username, proxy.password]) {
    if (value !== undefined && (typeof value !== 'string' || /[\r\n\0]/.test(value))) throw runtimeError(errorCode);
  }
  return Object.freeze({
    server: proxy.server,
    ...(proxy.username === undefined ? {} : { username: proxy.username }),
    ...(proxy.password === undefined ? {} : { password: proxy.password })
  });
}

export function assertCycleTlsProxyForTarget(target: URL, proxy: CycleTlsProxy | undefined): void {
  const hostname = target.hostname.toLowerCase().replace(/\.+$/, '');
  const isCapCut = hostname === 'capcut.com' || hostname.endsWith('.capcut.com') ||
    hostname === 'capcutapi.com' || hostname.endsWith('.capcutapi.com');
  if (isCapCut && !proxy) throw runtimeError('CYCLETLS_CAPCUT_PROXY_REQUIRED');
}
function fingerprintOptions(tls: CycleTlsFingerprintOptions | undefined): CycleTlsFingerprintOptions {
  if (!tls) return {};
  return {
    ...(tls.ja3 === undefined ? {} : { ja3: tls.ja3 }),
    ...(tls.ja4r === undefined ? {} : { ja4r: tls.ja4r }),
    ...(tls.http2Fingerprint === undefined ? {} : { http2Fingerprint: tls.http2Fingerprint }),
    ...(tls.quicFingerprint === undefined ? {} : { quicFingerprint: tls.quicFingerprint }),
    ...(tls.disableGrease === undefined ? {} : { disableGrease: tls.disableGrease }),
    ...(tls.userAgent === undefined ? {} : { userAgent: tls.userAgent }),
    ...(tls.forceHTTP1 === undefined ? {} : { forceHTTP1: tls.forceHTTP1 }),
    ...(tls.forceHTTP3 === undefined ? {} : { forceHTTP3: tls.forceHTTP3 })
  };
}
const runtimeError = (code: string) => new Error(code);

async function awaitReady(child: ChildLike, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: string | Buffer) => {
      output += chunk.toString();
      if (output.length > 64) return finish(runtimeError('CYCLETLS_STARTUP_INVALID'));
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      if (output.slice(0, newline).replace(/\r$/, '') !== `READY:${port}`) return finish(runtimeError('CYCLETLS_STARTUP_INVALID'));
      finish();
      child.stdout.on('data', () => { /* Discard all upstream diagnostics. */ });
    };
    const timer = setTimeout(() => finish(runtimeError('CYCLETLS_STARTUP_TIMEOUT')), timeoutMs);
    child.stdout.on('data', onData);
    child.once('error', () => finish(runtimeError('CYCLETLS_CHILD_FAILED')));
    child.once('exit', () => finish(runtimeError('CYCLETLS_CHILD_EXITED')));
  });
}
async function connectSocket(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.off('open', onOpen);
      socket.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => finish();
    const onError = () => finish(runtimeError('CYCLETLS_SOCKET_FAILED'));
    const timer = setTimeout(() => finish(runtimeError('CYCLETLS_STARTUP_TIMEOUT')), timeoutMs);
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}
function socketData(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
function validateRequest(request: CycleTlsDriverRequest): void {
  const target = new URL(request.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw runtimeError('CYCLETLS_URL_UNSUPPORTED');
  if (!['HEAD', 'GET', 'POST', 'PUT', 'DELETE', 'TRACE', 'OPTIONS', 'CONNECT', 'PATCH'].includes(request.method.toUpperCase())) throw runtimeError('CYCLETLS_METHOD_UNSUPPORTED');
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) throw runtimeError('CYCLETLS_TIMEOUT_INVALID');
  if (request.maxBytes !== undefined && (!Number.isInteger(request.maxBytes) || request.maxBytes < 1)) throw runtimeError('CYCLETLS_MAX_BYTES_INVALID');
}

export function validatedCycleTlsFingerprintOptions(tls: CycleTlsFingerprintOptions | undefined): CycleTlsFingerprintOptions | undefined {
  if (!tls) return undefined;
  for (const value of [tls.ja3, tls.ja4r, tls.http2Fingerprint, tls.quicFingerprint, tls.userAgent]) {
    if (value !== undefined && typeof value !== 'string') throw runtimeError('CYCLETLS_TLS_OPTIONS_INVALID');
  }
  for (const value of [tls.disableGrease, tls.forceHTTP1, tls.forceHTTP3]) {
    if (value !== undefined && typeof value !== 'boolean') throw runtimeError('CYCLETLS_TLS_OPTIONS_INVALID');
  }
  return Object.freeze({ ...fingerprintOptions(tls) });
}

async function stopChild(
  child: ChildLike,
  childExitPromise: Promise<void>,
  hasExited: () => boolean,
  timeoutMs = 1_000
): Promise<boolean> {
  if (hasExited()) return true;
  child.kill();
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void childExitPromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function createCycleTlsDriver(options: CycleTlsDriverOptions, dependencies: CycleTlsRuntimeDependencies = {}): Promise<CycleTlsDriver> {
  const routeOptions = Object.freeze({
    ...options,
    proxy: validatedCycleTlsProxy(options.proxy),
    tls: validatedCycleTlsFingerprintOptions(options.tls)
  });
  const port = await reserveUniquePort(dependencies.allocatePort ?? allocateLoopbackPort);
  let child: ChildLike | undefined;
  let socket: WebSocket | undefined;
  let childExited = false;
  let childExitPromise: Promise<void> | undefined;
  try {
    const executable = (dependencies.resolveExecutable ?? resolveCycleTlsExecutable)();
    const spawnProcess = dependencies.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions) as unknown as ChildLike);
    child = spawnProcess(executable, [], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], cwd: path.dirname(executable), env: childEnvironment(port)
    });
    childExited = child.exitCode !== null;
    childExitPromise = childExited ? Promise.resolve() : new Promise<void>(resolve => {
      child?.once('exit', () => {
        childExited = true;
        reservedPorts.delete(port);
        resolve();
      });
    });
    if (childExited) reservedPorts.delete(port);
    await awaitReady(child, port, routeOptions.startupTimeoutMs);
    socket = (dependencies.createSocket ?? (url => new WebSocket(url, { maxPayload: 4 * 1024 * 1024 })))(`ws://127.0.0.1:${port}/`);
    await connectSocket(socket, routeOptions.startupTimeoutMs);
    if (childExited) throw runtimeError('CYCLETLS_CHILD_EXITED');
  } catch (error) {
    try { socket?.terminate(); } catch { /* Cleanup confirmation comes from child exit. */ }
    if (child && childExitPromise) {
      const cleanupConfirmed = await stopChild(child, childExitPromise, () => childExited).catch(() => false);
      if (!cleanupConfirmed) throw runtimeError('CYCLETLS_CLEANUP_UNCONFIRMED');
    } else {
      reservedPorts.delete(port);
    }
    throw error;
  }
  if (!child || !socket || !childExitPromise) throw runtimeError('CYCLETLS_STARTUP_INVALID');
  const ownedChild = child;
  const ownedSocket = socket;
  const pending = new Map<string, PendingRequest>();
  let closed = false;
  let disposePromise: Promise<void> | undefined;
  const clearPending = (requestId: string, operation: PendingRequest) => {
    clearTimeout(operation.timer);
    if (operation.abort) operation.signal?.removeEventListener('abort', operation.abort);
    pending.delete(requestId);
  };
  const cancel = (requestId: string, operation: PendingRequest, error: Error) => {
    if (!pending.has(requestId)) return;
    if (ownedSocket.readyState === WebSocket.OPEN) ownedSocket.send(JSON.stringify({ action: 'cancel', requestId }));
    clearPending(requestId, operation);
    operation.queue?.fail(error);
    operation.reject(error);
  };
  const failAll = (code: string) => {
    const error = runtimeError(code);
    for (const [requestId, operation] of [...pending]) cancel(requestId, operation, error);
  };
  const handleFrame = (frame: CycleTlsFrame) => {
    const operation = pending.get(frame.requestId);
    if (!operation) return;
    if (frame.method === 'response') {
      if (operation.metadata) return cancel(frame.requestId, operation, runtimeError('CYCLETLS_PROTOCOL_INVALID'));
      operation.metadata = { status: frame.status, headers: frame.headers, finalUrl: frame.finalUrl };
      if (operation.stream) {
        operation.queue = new BoundedAsyncQueue();
        operation.resolve({ ...operation.metadata, body: operation.queue, dispose: async () => cancel(frame.requestId, operation, runtimeError('CYCLETLS_STREAM_DISPOSED')) });
      }
      return;
    }
    if (frame.method === 'error') return cancel(frame.requestId, operation, runtimeError(`CYCLETLS_NATIVE_ERROR_${frame.status}`));
    if (!operation.metadata) return cancel(frame.requestId, operation, runtimeError('CYCLETLS_PROTOCOL_INVALID'));
    if (frame.method === 'data') {
      operation.receivedBytes += frame.data.length;
      if (operation.receivedBytes > operation.maxBytes) cancel(frame.requestId, operation, runtimeError('CYCLETLS_RESPONSE_TOO_LARGE'));
      else if (operation.stream) operation.queue?.push(frame.data);
      else operation.chunks.push(frame.data);
      return;
    }
    clearPending(frame.requestId, operation);
    if (operation.stream) operation.queue?.end();
    else operation.resolve({ ...operation.metadata, body: Buffer.concat(operation.chunks) });
  };
  ownedSocket.on('message', data => {
    try { handleFrame(parseCycleTlsFrame(socketData(data))); }
    catch { failAll('CYCLETLS_PROTOCOL_INVALID'); ownedSocket.terminate(); }
  });
  ownedSocket.on('close', () => {
    if (!closed) {
      closed = true;
      failAll('CYCLETLS_SOCKET_CLOSED');
      ownedChild.kill();
    }
  });
  ownedSocket.on('error', () => {
    if (!closed) {
      closed = true;
      failAll('CYCLETLS_SOCKET_FAILED');
      ownedChild.kill();
    }
  });
  void childExitPromise.then(() => {
    if (!closed) {
      closed = true;
      failAll('CYCLETLS_CHILD_EXITED');
      ownedSocket.terminate();
    }
  });

  return {
    request(request): Promise<CycleTlsDriverResponse> {
      if (closed) return Promise.reject(runtimeError('CYCLETLS_DRIVER_CLOSED'));
      try {
        validateRequest(request);
        assertCycleTlsProxyForTarget(new URL(request.url), routeOptions.proxy);
      } catch (error) { return Promise.reject(error); }
      if (request.signal?.aborted) return Promise.reject(runtimeError('CYCLETLS_REQUEST_ABORTED'));
      const requestId = (dependencies.createRequestId ?? randomUUID)();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return Promise.reject(runtimeError('CYCLETLS_REQUEST_ID_INVALID'));
      }
      if (pending.has(requestId)) return Promise.reject(runtimeError('CYCLETLS_REQUEST_ID_COLLISION'));
      return new Promise((resolve, reject) => {
        const timeoutMs = request.timeoutMs;
        const operation = {} as PendingRequest;
        Object.assign(operation, {
          stream: request.stream, maxBytes: request.maxBytes ?? DEFAULT_MAX_BYTES, receivedBytes: 0,
          chunks: [], resolve, reject,
          timer: setTimeout(() => cancel(requestId, operation, runtimeError('CYCLETLS_REQUEST_TIMEOUT')), timeoutMs),
          signal: request.signal
        });
        operation.abort = () => cancel(requestId, operation, runtimeError('CYCLETLS_REQUEST_ABORTED'));
        pending.set(requestId, operation);
        request.signal?.addEventListener('abort', operation.abort, { once: true });
        if (request.signal?.aborted) {
          cancel(requestId, operation, runtimeError('CYCLETLS_REQUEST_ABORTED'));
          return;
        }
        const bodyBytes = Buffer.isBuffer(request.body) ? request.body.toString('base64') : undefined;
        ownedSocket.send(JSON.stringify({ requestId, options: {
          url: request.url, method: request.method.toLowerCase(), headers: request.headers,
          body: typeof request.body === 'string' ? request.body : '', ...(bodyBytes === undefined ? {} : { bodyBytes }),
          proxy: proxyUrl(routeOptions.proxy) ?? '', timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
          ...fingerprintOptions(routeOptions.tls), disableRedirect: true
        } }), error => { if (error) cancel(requestId, operation, runtimeError('CYCLETLS_SOCKET_FAILED')); });
      });
    },
    async dispose(): Promise<void> {
      if (!disposePromise) {
        disposePromise = (async () => {
          closed = true;
          failAll('CYCLETLS_DRIVER_CLOSED');
          if (ownedSocket.readyState === WebSocket.OPEN) ownedSocket.send(JSON.stringify({ action: 'exit' }));
          const childExited = await new Promise<boolean>(resolve => {
            const forceTimer = setTimeout(() => {
              ownedSocket.terminate();
              ownedChild.kill();
            }, 250);
            const failureTimer = setTimeout(() => {
              clearTimeout(forceTimer);
              resolve(false);
            }, 1_250);
            void childExitPromise.then(() => {
              clearTimeout(forceTimer);
              clearTimeout(failureTimer);
              resolve(true);
            });
          });
          if (!childExited) throw runtimeError('CYCLETLS_CLEANUP_UNCONFIRMED');
        })();
      }
      return disposePromise;
    }
  };
}
