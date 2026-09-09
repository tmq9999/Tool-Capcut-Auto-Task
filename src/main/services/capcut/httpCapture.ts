import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import type { BrowserContext, CDPSession, Page, Request, Response } from 'playwright-core';
import { withinDeadline, OperationDeadlineError } from './cancellation';
import { createCaptureRedactor } from './captureRedaction';
import { SessionEvidenceBudget } from './evidenceBudget';

export type CaptureStepPhase = 'before' | 'action' | 'client' | 'proof' | 'snapshot' | 'end' | 'fail';
export interface CaptureStep { stepId: string; stepAttemptId: string; phase: CaptureStepPhase; }
export interface CaptureIdentity { runId: string; sessionId: string; accountId: string; }
export interface CaptureOptions {
  bodyTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxRequests?: number;
  maxBodyBytes?: number;
  maxFileBytes?: number;
  maxPendingBodies?: number;
  identity?: Partial<CaptureIdentity>;
  budget?: SessionEvidenceBudget;
  createOutputStream?: (filePath: string, fd: number) => Writable;
  onWarning?: (code: string) => void;
}
export interface CaptureSummary {
  filtered: number;
  requests: number; responses: number; failed: number; incomplete: number;
  dropped: number; omittedBodies: number; ioErrors: number; bytes: number;
  seenRequests: number; headersRecorded: number; finished: number; pending: number;
  responseHeadersObserved: number; responseHeadersAccepted: number;
  bodyEligible: number; bodyIneligible: number; bodyStored: number;
  bodyRecordsObserved: number; bodyRecordsAccepted: number;
  bodyOmittedByReason: Record<string, number>;
  recordsScheduled: number; recordsWritten: number; recordsFailed: number;
  recordOmittedByReason: Record<string, number>;
  stopTimedOut: boolean; summaryPersisted: boolean; summaryPersistenceErrors: number;
}
export interface CaptureController {
  mark(stage: string): void;
  markStep(step: CaptureStep): void;
  stop(): Promise<CaptureSummary>;
}

const VALID_LABEL = /^[\p{L}\p{N} _:+.()-]{1,120}$/u;
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const STATIC_PATH = /\/(static-resource|obj\/capcut-web-login-static)\/|\.(js|css|woff2?|ttf|wasm|png|jpe?g|webp|mp4)$/i;
const TELEMETRY_HOST = /^(mon-|mcs-|mssdk-|vmweb-)|(^|\.)(google\.com|google-analytics\.com|googletagmanager\.com|bing\.com|clarity\.ms)$/;

function positive(value: number | undefined, fallback: number): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error('CAPTURE_INVALID_LIMIT');
  return value ?? fallback;
}

/** Passive, opt-in recorder. Never mutates Request objects or replays traffic. */
export function attachRedactedHttpCapture(context: BrowserContext, filePath: string, options: CaptureOptions = {}): CaptureController {
  const bodyTimeout = Math.min(5000, positive(options.bodyTimeoutMs, 5000));
  const closeTimeout = Math.min(5000, positive(options.closeTimeoutMs, 5000));
  const maxBody = Math.min(2 * 1024 * 1024, positive(options.maxBodyBytes, 2 * 1024 * 1024));
  const maxRequests = positive(options.maxRequests, 10000);
  const maxFile = Math.min(128 * 1024 * 1024, positive(options.maxFileBytes, 128 * 1024 * 1024));
  const maxPending = Math.min(2, positive(options.maxPendingBodies, 2));
  const budget = options.budget ?? new SessionEvidenceBudget();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'wx', 0o600);
  let output: Writable;
  try {
    output = options.createOutputStream?.(filePath, fd) ?? fs.createWriteStream(filePath, { fd, autoClose: true });
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* the factory may already have taken ownership */ }
    try { fs.unlinkSync(filePath); } catch { /* remove only the file exclusively created above */ }
    throw error;
  }
  let finalSummaryReservation = budget.reserve('network', 32 * 1024);
  const summary: CaptureSummary = {
    filtered: 0, requests: 0, responses: 0, failed: 0, incomplete: 0,
    dropped: 0, omittedBodies: 0, ioErrors: 0, bytes: 0,
    seenRequests: 0, headersRecorded: 0, finished: 0, pending: 0,
    responseHeadersObserved: 0, responseHeadersAccepted: 0,
    bodyEligible: 0, bodyIneligible: 0, bodyStored: 0, bodyOmittedByReason: {},
    bodyRecordsObserved: 0, bodyRecordsAccepted: 0,
    recordsScheduled: 0, recordsWritten: 0, recordsFailed: 0,
    recordOmittedByReason: {},
    stopTimedOut: false, summaryPersisted: false, summaryPersistenceErrors: 0
  };
  const redact = createCaptureRedactor();
  const start = performance.now();
  const captureId = randomUUID();
  const safeAlias = (value: string | undefined, fallback: string) => value && SAFE_ALIAS.test(value) ? value : fallback;
  const identity = Object.freeze({
    runId: safeAlias(options.identity?.runId, 'unassigned'),
    sessionId: safeAlias(options.identity?.sessionId, 'unassigned'),
    accountId: safeAlias(options.identity?.accountId, 'unscoped')
  });
  let sequence = 0;
  let stage = 'account-start';
  let step: Readonly<CaptureStep> | null = null;
  let accepting = true;
  let closed = false;
  let diskFailed = false;
  let activeRawReads = 0;
  let queuedBytes = 0;
  let accountingFinalized = false;
  let stopPromise: Promise<CaptureSummary> | undefined;
  const pending = new Set<Promise<void>>();
  const targetSessions = new Set<CDPSession>();
  const targetAliases = new WeakMap<Page, string>();
  const attachedTargets = new WeakSet<Page>();
  const clientDisposers = new Set<() => void>();
  let targetSequence = 0;
  let socketSequence = 0;
  let downloadSequence = 0;
  interface Entry {
    requestId: string; stage: string; step: Readonly<CaptureStep> | null; started: number;
    responseSeen: boolean; terminal: boolean; bodyEligible: boolean; route: string;
  }
  const entries = new Map<Request, Entry>();
  const ids = new WeakMap<Request, string>();
  const warn = (code: string) => { try { options.onWarning?.(code); } catch { /* diagnostics cannot affect automation */ } };
  const omit = (reason: string) => {
    summary.omittedBodies++;
    summary.bodyOmittedByReason[reason] = (summary.bodyOmittedByReason[reason] ?? 0) + 1;
  };
  output.on('error', () => {
    if (diskFailed) return;
    diskFailed = true;
    summary.ioErrors++;
    warn('CAPTURE_WRITE_FAILED');
  });
  const envelope = () => ({ version: 3, captureId, identity, sequence: ++sequence, timestamp: new Date().toISOString(), elapsedMs: performance.now() - start });
  const omitRecord = (reason: string) => {
    summary.dropped++;
    summary.recordOmittedByReason[reason] = (summary.recordOmittedByReason[reason] ?? 0) + 1;
  };
  interface WriteHooks {
    accepted?(): void;
    written?(): void;
    omitted?(reason: string): void;
  }
  interface PendingWrite {
    size: number;
    reservation: NonNullable<ReturnType<SessionEvidenceBudget['reserve']>>;
    hooks: WriteHooks;
    settled: boolean;
  }
  const unsettledWrites = new Set<PendingWrite>();
  const rejectWrite = (reason: string, hooks: WriteHooks) => {
    omitRecord(reason);
    hooks.omitted?.(reason);
    return false;
  };
  const settleWrite = (pendingWrite: PendingWrite, error?: Error | null) => {
    if (pendingWrite.settled || accountingFinalized) return;
    pendingWrite.settled = true;
    unsettledWrites.delete(pendingWrite);
    queuedBytes -= pendingWrite.size;
    if (error) {
      pendingWrite.reservation.release();
      summary.recordsFailed++;
      summary.ioErrors++;
      diskFailed = true;
      omitRecord('writer');
      pendingWrite.hooks.omitted?.('writer');
      warn('CAPTURE_WRITE_FAILED');
      return;
    }
    pendingWrite.reservation.commit(pendingWrite.size);
    summary.recordsWritten++;
    summary.bytes += pendingWrite.size;
    pendingWrite.hooks.written?.();
  };
  const write = (record: Record<string, unknown>, hooks: WriteHooks = {}) => {
    if (closed || diskFailed) return rejectWrite('writer', hooks);
    try {
      const line = JSON.stringify({ ...envelope(), ...record }) + '\n';
      const size = Buffer.byteLength(line);
      if (summary.bytes + queuedBytes + size > maxFile) {
        return rejectWrite('file', hooks);
      }
      if (queuedBytes + size > 4 * 1024 * 1024) {
        return rejectWrite('queue', hooks);
      }
      const reservation = budget.reserve('network', size);
      if (!reservation) return rejectWrite('session-budget', hooks);
      summary.recordsScheduled++;
      queuedBytes += size;
      const pendingWrite: PendingWrite = { size, reservation, hooks, settled: false };
      unsettledWrites.add(pendingWrite);
      hooks.accepted?.();
      try { output.write(line, error => settleWrite(pendingWrite, error)); }
      catch (error) { settleWrite(pendingWrite, error instanceof Error ? error : new Error('CAPTURE_WRITE_FAILED')); }
      return true;
    } catch {
      summary.recordsFailed++;
      summary.ioErrors++;
      omitRecord('serialization');
      hooks.omitted?.('serialization');
      warn('CAPTURE_SERIALIZE_FAILED');
      return false;
    }
  };
  const cdpDeadline = <T>(promise: Promise<T>) => withinDeadline(promise, 3000);
  const detachTarget = async (session: CDPSession) => {
    try { await cdpDeadline(session.detach()); } catch { warn('CAPTURE_TARGET_DETACH_FAILED'); }
    targetSessions.delete(session);
  };
  const trackWork = (work: Promise<void>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => undefined);
  };
  const safeTargetCategory = (value: unknown, allowed: readonly string[], fallback: string) =>
    typeof value === 'string' && allowed.includes(value) ? value : fallback;
  const allowedTargetUrl = (rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') return false;
    try {
      const url = new URL(rawUrl);
      return /(^|\.)(capcut\.com|capcutapi\.com|byteoversea\.com|ibytedtos\.com)$/.test(url.hostname) ||
        (url.hostname === 'tos-my319-share.tiktokcdn.com' && url.pathname.startsWith('/upload/'));
    } catch { return false; }
  };
  const attachTarget = async (page: Page) => {
    if (!accepting || attachedTargets.has(page) || typeof context.newCDPSession !== 'function') return;
    attachedTargets.add(page);
    const target = targetAliases.get(page) ?? `page-${++targetSequence}`;
    if (!targetAliases.has(page)) targetAliases.set(page, target);
    let session: CDPSession;
    try { session = await cdpDeadline(context.newCDPSession(page)); }
    catch {
      if (!closed) write({ type: 'target-capability', target, capabilities: { pageNetwork: false, serviceWorkerNetwork: false }, gaps: ['page-cdp-attach-failed', 'service-worker-target-unsupported'] });
      return;
    }
    if (!accepting) { await detachTarget(session); return; }
    targetSessions.add(session);
    const requestRefs = new Map<string, { requestRef: string; hop: number }>();
    const frameRefs = new Map<string, string>();
    const socketRefs = new Map<string, string>();
    const pendingExtra = new Map<string, Array<Record<string, unknown>>>();
    let requestSequence = 0;
    let frameSequence = 0;
    const requestState = (rawId: string) => requestRefs.get(rawId);
    const opaqueFrame = (rawId: unknown) => {
      if (typeof rawId !== 'string' || !rawId) return null;
      let alias = frameRefs.get(rawId);
      if (!alias) { alias = `frame-${++frameSequence}`; frameRefs.set(rawId, alias); }
      return alias;
    };
    const opaqueSocket = (rawId: string) => {
      let alias = socketRefs.get(rawId);
      if (!alias) { alias = `socket-${++socketSequence}`; socketRefs.set(rawId, alias); }
      return alias;
    };
    const safeHeaders = (value: unknown) => redact.headers(value && typeof value === 'object' ? value as Record<string, string> : {});
    const onExtra = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      const state = requestState(rawId);
      const record = { headers: safeHeaders(event.headers), associatedCookies: Array.isArray(event.associatedCookies) ? { count: event.associatedCookies.length } : undefined };
      if (state) write({ type: 'cdp-request-extra', target, ...state, ...record });
      else if (pendingExtra.size < 512) pendingExtra.set(rawId, [...(pendingExtra.get(rawId) ?? []), record]);
      else write({ type: 'target-gap', target, gap: 'extra-info-capacity' });
    };
    const onRequest = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      const request = event.request && typeof event.request === 'object' ? event.request as Record<string, unknown> : {};
      if (!rawId || !allowedTargetUrl(request.url)) return;
      const prior = requestState(rawId);
      const state = prior ? { requestRef: prior.requestRef, hop: prior.hop + 1 } : { requestRef: `net-${++requestSequence}`, hop: 0 };
      if (prior) write({ type: 'cdp-redirect', target, requestRef: prior.requestRef, fromHop: prior.hop, toHop: state.hop,
        response: event.redirectResponse && typeof event.redirectResponse === 'object' ? {
          status: Number((event.redirectResponse as Record<string, unknown>).status) || 0,
          headers: safeHeaders((event.redirectResponse as Record<string, unknown>).headers)
        } : undefined });
      requestRefs.set(rawId, state);
      write({
        type: 'cdp-request', target, ...state,
        resourceType: safeTargetCategory(event.type, ['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'TextTrack', 'XHR', 'Fetch', 'Prefetch', 'EventSource', 'WebSocket', 'Manifest', 'SignedExchange', 'Ping', 'CSPViolationReport', 'Preflight', 'Other'], 'Other'),
        frame: opaqueFrame(event.frameId),
        initiator: { type: safeTargetCategory((event.initiator as Record<string, unknown> | undefined)?.type, ['parser', 'script', 'preload', 'SignedExchange', 'preflight', 'other'], 'other') },
        method: safeTargetCategory(request.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], 'OTHER'),
        url: redact.url(typeof request.url === 'string' ? request.url : ''),
        headers: safeHeaders(request.headers)
      });
      for (const extra of pendingExtra.get(rawId) ?? []) write({ type: 'cdp-request-extra', target, ...state, ...extra });
      pendingExtra.delete(rawId);
    };
    const onResponseExtra = (event: Record<string, unknown>) => {
      const state = requestState(typeof event.requestId === 'string' ? event.requestId : '');
      if (state) write({ type: 'cdp-response-extra', target, ...state, status: Number(event.statusCode) || 0, headers: safeHeaders(event.headers) });
    };
    const onResponse = (event: Record<string, unknown>) => {
      const state = requestState(typeof event.requestId === 'string' ? event.requestId : '');
      if (!state) return;
      const response = event.response && typeof event.response === 'object' ? event.response as Record<string, unknown> : {};
      const cache = response.fromServiceWorker === true ? 'service-worker' : response.fromDiskCache === true ? 'disk' : response.fromPrefetchCache === true ? 'prefetch' : 'network';
      write({ type: 'cdp-response', target, ...state, status: Number(response.status) || 0,
        mimeType: typeof response.mimeType === 'string' ? response.mimeType.slice(0, 100) : '', cache,
        headers: safeHeaders(response.headers) });
    };
    const onData = (event: Record<string, unknown>) => {
      const state = requestState(typeof event.requestId === 'string' ? event.requestId : '');
      if (state) write({ type: 'cdp-data', target, ...state, dataLength: Math.max(0, Number(event.dataLength) || 0), encodedDataLength: Math.max(0, Number(event.encodedDataLength) || 0) });
    };
    const onSse = (event: Record<string, unknown>) => {
      const state = requestState(typeof event.requestId === 'string' ? event.requestId : '');
      if (!state) return;
      write({ type: 'sse-message', target, ...state,
        event: typeof event.eventName === 'string' && SAFE_ALIAS.test(event.eventName) ? event.eventName : 'message',
        eventId: redact.value(event.eventId), payload: redact.value(event.data) });
    };
    const onTerminal = (outcome: 'finished' | 'failed') => (event: Record<string, unknown>) => {
      const state = requestState(typeof event.requestId === 'string' ? event.requestId : '');
      if (state) write({ type: 'cdp-terminal', target, ...state, outcome,
        ...(outcome === 'failed' ? { category: event.blockedReason ? 'blocked' : 'network-error' } : {}) });
    };
    const onWebSocketCreated = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      if (!rawId || !allowedTargetUrl(event.url)) return;
      write({ type: 'websocket-created', target, socketRef: opaqueSocket(rawId), url: redact.url(String(event.url)) });
    };
    const onWebSocketHandshake = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      if (!socketRefs.has(rawId)) return;
      const request = event.request && typeof event.request === 'object' ? event.request as Record<string, unknown> : {};
      write({ type: 'websocket-handshake', target, socketRef: opaqueSocket(rawId), direction: 'request', headers: safeHeaders(request.headers) });
    };
    const onWebSocketFrame = (direction: 'sent' | 'received') => (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      if (!socketRefs.has(rawId)) return;
      const response = event.response && typeof event.response === 'object' ? event.response as Record<string, unknown> : {};
      const opcode = Number(response.opcode) || 0;
      const payload = typeof response.payloadData === 'string' ? response.payloadData : '';
      let payloadShape: unknown = opcode === 1 ? '<opaque-text>' : '<binary>';
      if (opcode === 1 && Buffer.byteLength(payload) <= 64 * 1024) {
        try { payloadShape = redact.value(JSON.parse(payload)); } catch { /* textual frames remain opaque */ }
      }
      write({ type: 'websocket-frame', target, socketRef: opaqueSocket(rawId), direction, opcode,
        bytes: Math.min(Buffer.byteLength(payload), 8 * 1024 * 1024), payload: payloadShape });
    };
    const onWebSocketError = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      if (socketRefs.has(rawId)) write({ type: 'websocket-error', target, socketRef: opaqueSocket(rawId), category: 'frame-error' });
    };
    const onWebSocketClosed = (event: Record<string, unknown>) => {
      const rawId = typeof event.requestId === 'string' ? event.requestId : '';
      if (socketRefs.has(rawId)) write({ type: 'websocket-closed', target, socketRef: opaqueSocket(rawId) });
    };
    session.on('Network.requestWillBeSentExtraInfo', onExtra);
    session.on('Network.responseReceivedExtraInfo', onResponseExtra);
    session.on('Network.requestWillBeSent', onRequest);
    session.on('Network.responseReceived', onResponse);
    session.on('Network.dataReceived', onData);
    session.on('Network.eventSourceMessageReceived', onSse);
    session.on('Network.loadingFinished', onTerminal('finished'));
    session.on('Network.loadingFailed', onTerminal('failed'));
    session.on('Network.webSocketCreated', onWebSocketCreated);
    session.on('Network.webSocketWillSendHandshakeRequest', onWebSocketHandshake);
    session.on('Network.webSocketFrameSent', onWebSocketFrame('sent'));
    session.on('Network.webSocketFrameReceived', onWebSocketFrame('received'));
    session.on('Network.webSocketFrameError', onWebSocketError);
    session.on('Network.webSocketClosed', onWebSocketClosed);
    try {
      await cdpDeadline(session.send('Network.enable', { maxPostDataSize: 0, maxResourceBufferSize: 2 * 1024 * 1024, maxTotalBufferSize: 4 * 1024 * 1024 }));
      if (accepting) write({ type: 'target-capability', target, capabilities: {
        pageNetwork: true, frames: true, workers: false, preflight: true, cacheMetadata: true,
        sseMessages: true, webSocketFrames: true, serviceWorkerNetwork: false
      }, gaps: ['worker-target-unsupported', 'service-worker-target-unsupported'] });
    } catch {
      if (accepting) write({ type: 'target-capability', target, capabilities: { pageNetwork: false, serviceWorkerNetwork: false }, gaps: ['network-enable-failed', 'service-worker-target-unsupported'] });
      (session as unknown as EventEmitter).removeAllListeners();
      await detachTarget(session);
    }
  };
  const hookClientPage = (page: Page) => {
    if (typeof page.on !== 'function') return;
    const target = targetAliases.get(page) ?? `page-${++targetSequence}`;
    if (!targetAliases.has(page)) targetAliases.set(page, target);
    const onPageError = (error: Error) => {
      const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Error';
      write({ type: 'client-pageerror', target, category: safeTargetCategory(name, ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'], 'Error') });
    };
    const onConsole = (message: { type(): string }) => {
      let level = 'unknown';
      try { level = message.type(); } catch { /* safe default */ }
      if (level === 'error') write({ type: 'client-console', target, level: 'error' });
    };
    const onDialog = (dialog: { type(): string }) => {
      let dialogType = 'unknown';
      try { dialogType = safeTargetCategory(dialog.type(), ['alert', 'beforeunload', 'confirm', 'prompt'], 'unknown'); } catch { /* safe default */ }
      write({ type: 'client-dialog', target, dialogType });
    };
    const onDownload = (download: { suggestedFilename(): string; failure(): Promise<string | null> }) => {
      const downloadRef = `download-${++downloadSequence}`;
      let extension = '';
      try { extension = path.extname(download.suggestedFilename()).toLowerCase().slice(0, 12).replace(/[^.a-z0-9]/g, ''); } catch { /* optional metadata */ }
      write({ type: 'client-download', target, downloadRef, lifecycle: 'started', extension });
      const work = withinDeadline(download.failure(), 5000).then(failure => {
        if (!closed) write({ type: 'client-download', target, downloadRef, lifecycle: failure ? 'failed' : 'completed' });
      }).catch(() => { if (!closed) write({ type: 'client-download', target, downloadRef, lifecycle: 'unknown' }); });
      trackWork(work);
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    page.on('dialog', onDialog);
    page.on('download', onDownload);
    const dispose = () => {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      page.off('dialog', onDialog);
      page.off('download', onDownload);
      clientDisposers.delete(dispose);
    };
    clientDisposers.add(dispose);
  };
  const onTargetPage = (page: Page) => { hookClientPage(page); trackWork(attachTarget(page)); };
  const mimeOf = (headers: Record<string, string>) => (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const decode = (buffer: Buffer, mime: string, route: string, direction: 'request' | 'response') => {
    if (buffer.byteLength > maxBody) return { state: 'oversize', bytes: buffer.byteLength };
    const text = buffer.toString('utf8');
    if (!buffer.length) return { state: 'empty', bytes: 0 };
    if (mime === 'application/x-www-form-urlencoded') {
      return { state: 'form', bytes: buffer.length, value: Object.fromEntries([...new URLSearchParams(text)].map(([key, value]) => [key, redact.value(value, key)])) };
    }
    try {
      const parsed = JSON.parse(text);
      return { state: 'json', bytes: buffer.length, value: direction === 'response' ? redact.responseValue(parsed, route) : redact.value(parsed) };
    } catch { return { state: 'omitted-non-json', bytes: buffer.length }; }
  };
  const parseRoute = (raw: string) => { try { const parsed = new URL(raw); return parsed.hostname + parsed.pathname; } catch { return ''; } };
  const bodyPolicyEligible = (rawUrl: string, resourceType: string) => {
    try {
      const url = new URL(rawUrl);
      return ['document', 'xhr', 'fetch', 'other'].includes(resourceType) && !TELEMETRY_HOST.test(url.hostname) && !STATIC_PATH.test(url.pathname);
    } catch { return false; }
  };
  const currentContext = () => ({ stage, step });
  const safely = <T>(read: () => T, fallback: T): T => {
    try { return read(); } catch { return fallback; }
  };
  const onRequest = (request: Request) => {
    if (!accepting || diskFailed || ids.has(request)) return;
    summary.seenRequests++;
    if (summary.requests >= maxRequests) { summary.dropped++; return; }
    try {
      const requestId = 'req-' + (summary.requests + 1);
      const rawUrl = safely(() => request.url(), '');
      const resourceType = safely(() => request.resourceType(), 'unknown');
      const eligible = bodyPolicyEligible(rawUrl, resourceType);
      const captured = currentContext();
      const meta: Entry = {
        requestId, stage: captured.stage, step: captured.step, started: performance.now(),
        responseSeen: false, terminal: false, bodyEligible: eligible, route: parseRoute(rawUrl)
      };
      summary.requests++;
      if (eligible) summary.bodyEligible++;
      else summary.bodyIneligible++;
      entries.set(request, meta);
      ids.set(request, requestId);
      const headers = safely(() => request.headers(), {});
      const raw = safely(() => request.postData(), undefined);
      const body = !eligible ? { state: 'policy-omitted' }
        : raw === undefined ? { state: 'unreadable' }
        : raw === null ? { state: 'empty' }
          : decode(Buffer.from(raw), mimeOf(headers), meta.route, 'request');
      const redirectedFrom = safely(() => request.redirectedFrom(), null);
      write({ type: 'request-start', requestId, ...captured, resourceType,
        redirectedFromId: redirectedFrom ? ids.get(redirectedFrom) ?? null : null,
        method: safely(() => request.method(), 'UNKNOWN'), url: redact.url(rawUrl), headers: redact.headers(headers), body });
    } catch { summary.dropped++; warn('CAPTURE_REQUEST_FAILED'); }
  };
  const writeBody = (meta: Entry, body: Record<string, unknown>) => {
    const state = String(body.state);
    const storable = ['json', 'form', 'empty'].includes(state);
    summary.bodyRecordsObserved++;
    if (!storable) omit(state === 'capacity-omitted' ? 'capacity' : state.replace(/^omitted-/, ''));
    write({ type: 'response-body', requestId: meta.requestId, stage: meta.stage, step: meta.step,
      durationMs: performance.now() - meta.started, body }, {
      accepted: () => { summary.bodyRecordsAccepted++; },
      written: () => { if (storable) summary.bodyStored++; },
      omitted: reason => { if (storable) omit(reason); }
    });
  };
  const onResponse = (response: Response) => {
    if (!accepting || diskFailed) return;
    const request = response.request();
    const meta = entries.get(request);
    if (!meta || meta.responseSeen) return;
    meta.responseSeen = true;
    let headers: Record<string, string> = {};
    try { headers = response.headers(); } catch { warn('CAPTURE_RESPONSE_HEADERS_FAILED'); }
    summary.responseHeadersObserved++;
    write({ type: 'response', requestId: meta.requestId, stage: meta.stage, step: meta.step,
      durationMs: performance.now() - meta.started, status: safely(() => response.status(), 0), headers: redact.headers(headers) }, {
      accepted: () => { summary.responseHeadersAccepted++; },
      written: () => { summary.headersRecorded++; summary.responses = summary.headersRecorded; }
    });
    const mime = mimeOf(headers);
    const length = Number(headers['content-length']);
    if (!meta.bodyEligible) { writeBody(meta, { state: 'policy-omitted' }); return; }
    if (mime === 'text/event-stream') { writeBody(meta, { state: 'omitted-stream' }); return; }
    if (!(mime.includes('json') || mime === 'application/x-www-form-urlencoded')) { writeBody(meta, { state: 'omitted-binary' }); return; }
    if (Number.isFinite(length) && length > maxBody) { writeBody(meta, { state: 'oversize', bytes: length }); return; }
    if (activeRawReads >= maxPending) { writeBody(meta, { state: 'capacity-omitted' }); return; }
    activeRawReads++;
    let raw: Promise<Buffer>;
    try { raw = response.body(); }
    catch { activeRawReads--; writeBody(meta, { state: 'unreadable' }); return; }
    raw.finally(() => { activeRawReads--; }).catch(() => undefined);
    const work = (async () => {
      let body: Record<string, unknown>;
      try { body = decode(await withinDeadline(raw, bodyTimeout), mime, meta.route, 'response'); }
      catch (error) { body = { state: error instanceof OperationDeadlineError ? 'timeout' : 'unreadable' }; }
      if (!closed) writeBody(meta, body);
    })().catch(() => { summary.dropped++; warn('CAPTURE_RESPONSE_FAILED'); });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const terminal = (request: Request, outcome: 'finished' | 'failed') => {
    if (!accepting) return;
    const meta = entries.get(request);
    if (!meta || meta.terminal) return;
    meta.terminal = true;
    if (outcome === 'failed') summary.failed++; else summary.finished++;
    write({ type: 'request-terminal', requestId: meta.requestId, stage: meta.stage, step: meta.step,
      durationMs: performance.now() - meta.started, outcome,
      ...(outcome === 'failed' ? { error: 'REQUEST_FAILED' } : {}) });
  };
  const onFailed = (request: Request) => terminal(request, 'failed');
  const onFinished = (request: Request) => terminal(request, 'finished');
  context.on('request', onRequest);
  context.on('response', onResponse);
  context.on('requestfailed', onFailed);
  context.on('requestfinished', onFinished);
  write({ type: 'capture-start', limits: {
    maxRequests, maxBodyBytes: maxBody, maxFileBytes: maxFile, maxQueuedBytes: 4 * 1024 * 1024,
    maxUnsettledBodyReads: maxPending, bodyTimeoutMs: bodyTimeout, closeTimeoutMs: closeTimeout
  }, omitted: ['binary-bodies', 'non-json-bodies', 'service-worker-target-network'] });
  if (typeof context.pages === 'function') {
    for (const page of context.pages()) onTargetPage(page);
    context.on('page', onTargetPage);
  }
  return {
    mark(next) {
      if (!accepting) return;
      stage = VALID_LABEL.test(next) && !next.includes('@') ? next : 'stage-redacted';
      write({ type: 'stage', stage, step });
    },
    markStep(next) {
      if (!accepting) return;
      const validPhase: readonly CaptureStepPhase[] = ['before', 'action', 'client', 'proof', 'snapshot', 'end', 'fail'];
      if (!SAFE_ALIAS.test(next.stepId) || !SAFE_ALIAS.test(next.stepAttemptId) || !validPhase.includes(next.phase)) throw new Error('CAPTURE_INVALID_STEP');
      step = Object.freeze({ ...next });
      write({ type: 'step', stage, step });
    },
    stop() {
      if (stopPromise) return stopPromise;
      accepting = false;
      context.off('request', onRequest);
      context.off('response', onResponse);
      context.off('requestfailed', onFailed);
      context.off('requestfinished', onFinished);
      context.off('page', onTargetPage);
      for (const dispose of [...clientDisposers]) dispose();
      stopPromise = (async () => {
        await Promise.allSettled([...pending]);
        for (const session of targetSessions) (session as unknown as EventEmitter).removeAllListeners();
        await Promise.allSettled([...targetSessions].map(detachTarget));
        for (const meta of entries.values()) {
          if (meta.terminal) continue;
          meta.terminal = true;
          summary.incomplete++;
          write({ type: 'request-terminal', requestId: meta.requestId, stage: meta.stage, step: meta.step, outcome: 'incomplete' });
        }
        summary.pending = summary.incomplete;
        entries.clear();
        write({ type: 'capture-end', closure: 'flush-pending' });
        await new Promise<void>((resolve) => {
          if (output.closed || output.destroyed) { resolve(); return; }
          const timer = setTimeout(() => { summary.stopTimedOut = true; summary.ioErrors++; output.destroy(); resolve(); }, closeTimeout);
          output.once('close', () => { clearTimeout(timer); resolve(); });
          output.end();
        });
        for (const pendingWrite of [...unsettledWrites]) settleWrite(pendingWrite, new Error('CAPTURE_WRITE_UNSETTLED'));
        accountingFinalized = true;
        closed = true;
        const summaryPath = filePath + '.summary.json';
        const persistSummary = () => {
          if (!finalSummaryReservation) throw new Error('CAPTURE_SUMMARY_BUDGET_EXHAUSTED');
          summary.summaryPersisted = true;
          const closure = summary.stopTimedOut ? 'close-timeout' : summary.ioErrors > 0 ? 'closed-with-errors' : 'closed';
          const bytes = Buffer.from(JSON.stringify({ version: 3, captureId, identity, closure, summary }) + '\n');
          if (bytes.byteLength > finalSummaryReservation.reservedBytes) throw new Error('CAPTURE_SUMMARY_TOO_LARGE');
          fs.writeFileSync(summaryPath, bytes, { flag: 'wx', mode: 0o600 });
          finalSummaryReservation.commit(bytes.byteLength);
          finalSummaryReservation = null;
        };
        try {
          persistSummary();
        } catch {
          if (finalSummaryReservation) {
            finalSummaryReservation.release();
            finalSummaryReservation = null;
          }
          summary.summaryPersisted = false;
          summary.summaryPersistenceErrors++;
          summary.ioErrors++;
          warn('CAPTURE_SUMMARY_WRITE_FAILED');
        }
        return {
          ...summary,
          bodyOmittedByReason: { ...summary.bodyOmittedByReason },
          recordOmittedByReason: { ...summary.recordOmittedByReason }
        };
      })();
      return stopPromise;
    }
  };
}
