import fs from 'node:fs';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import { withinDeadline } from '../cancellation';
import { SessionEvidenceBudget } from '../evidenceBudget';

export interface PrivateCaptureOptions {
  budget?: SessionEvidenceBudget;
  maxFileBytes?: number;
  maxQueuedBytes?: number;
  commandTimeoutMs?: number;
  stopTimeoutMs?: number;
  onWarning?: (code: string) => void;
}

export interface PrivateCaptureSummary {
  bytes: number;
  dropped: number;
  policyLimit: number;
  encryptionErrors: number;
  writeErrors: number;
  capabilityGaps: number;
}

/** Private diagnostic trace. Encryption is mandatory; never pass a plaintext encoder. */
export async function attachPrivateCapture(
  context: BrowserContext,
  file: string,
  encrypt: (text: string) => Buffer,
  options: PrivateCaptureOptions = {}
) {
  const maxFileBytes = Math.min(128 * 1024 * 1024, options.maxFileBytes ?? 128 * 1024 * 1024);
  const maxQueuedBytes = Math.min(4 * 1024 * 1024, options.maxQueuedBytes ?? 4 * 1024 * 1024);
  const commandTimeoutMs = Math.min(3000, options.commandTimeoutMs ?? 3000);
  const stopTimeoutMs = Math.min(5000, options.stopTimeoutMs ?? 5000);
  const budget = options.budget ?? new SessionEvidenceBudget();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o600);
  const output = fs.createWriteStream(file, { fd, autoClose: true });
  let stage = 'signup';
  let closed = false;
  let stopping = false;
  let queuedBytes = 0;
  let activeRawBodyCommands = 0;
  let index = 0;
  const summary: PrivateCaptureSummary = { bytes: 0, dropped: 0, policyLimit: 0, encryptionErrors: 0, writeErrors: 0, capabilityGaps: 0 };
  const sessions = new Set<CDPSession>();
  const commands = new Set<Promise<void>>();
  const writes = new Set<Promise<void>>();
  const warn = (code: string) => { try { options.onWarning?.(code); } catch { /* diagnostics cannot affect automation */ } };
  output.on('error', () => { summary.writeErrors++; warn('PRIVATE_CAPTURE_WRITE_FAILED'); });

  const write = (record: Record<string, unknown>) => {
    if (closed) return false;
    let line: Buffer;
    try {
      const raw = JSON.stringify({ at: Date.now(), ...record });
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024) { summary.dropped++; summary.policyLimit++; return false; }
      line = Buffer.from(encrypt(raw).toString('base64') + '\n');
    } catch {
      summary.dropped++; summary.encryptionErrors++; warn('PRIVATE_CAPTURE_ENCRYPTION_FAILED'); return false;
    }
    if (summary.bytes + queuedBytes + line.byteLength > maxFileBytes || queuedBytes + line.byteLength > maxQueuedBytes) {
      summary.dropped++; summary.policyLimit++; warn('PRIVATE_CAPTURE_POLICY_LIMIT'); return false;
    }
    const reservation = budget.reserve('network', line.byteLength);
    if (!reservation) { summary.dropped++; summary.policyLimit++; warn('PRIVATE_CAPTURE_SESSION_BUDGET'); return false; }
    queuedBytes += line.byteLength;
    let settle!: () => void;
    const pendingWrite = new Promise<void>(resolve => { settle = resolve; });
    writes.add(pendingWrite);
    const done = (error?: Error | null) => {
      queuedBytes -= line.byteLength;
      writes.delete(pendingWrite);
      if (error) { reservation.release(); summary.dropped++; summary.writeErrors++; warn('PRIVATE_CAPTURE_WRITE_FAILED'); }
      else { reservation.commit(line.byteLength); summary.bytes += line.byteLength; }
      settle();
    };
    try { output.write(line, done); }
    catch (error) { done(error instanceof Error ? error : new Error('PRIVATE_CAPTURE_WRITE_FAILED')); }
    return true;
  };
  const track = (promise: Promise<void>) => { commands.add(promise); void promise.finally(() => commands.delete(promise)).catch(() => undefined); };
  const boundedCommand = <T>(promise: Promise<T>) => withinDeadline(promise, commandTimeoutMs);
  const boundedDetach = async (session: CDPSession) => {
    try { await boundedCommand(session.detach()); } catch { summary.capabilityGaps++; warn('PRIVATE_CAPTURE_DETACH_FAILED'); }
    sessions.delete(session);
  };

  async function attach(page: Page) {
    if (stopping) return;
    let cdp: CDPSession;
    try { cdp = await boundedCommand(context.newCDPSession(page)); }
    catch { summary.capabilityGaps++; write({ type: 'target-capability', pageNetwork: false, reason: 'attach-failed' }); return; }
    if (stopping) { await boundedDetach(cdp); return; }
    sessions.add(cdp);
    const sessionId = ++index;
    const requests = new Map<string, { stage: string; hop: number; streamBytes: number; prefix?: string }>();
    const earlyExtra = new Map<string, Record<string, unknown>[] >();
    const save = (type: string, event: { requestId: string } & Record<string, unknown>) => {
      if (closed) return;
      const info = requests.get(event.requestId);
      if (info) write({ ...event, resourceType: event.type, type, sessionId, stage: info.stage, hop: info.hop });
    };
    const bodyCommand = (method: 'Network.getRequestPostData' | 'Network.getResponseBody', requestId: string, type: string) => {
      if (activeRawBodyCommands >= 2) { summary.policyLimit++; save(type + '-missing', { requestId, reason: 'capacity' }); return; }
      activeRawBodyCommands++;
      let original: Promise<Record<string, unknown>>;
      try { original = cdp.send(method, { requestId }) as Promise<Record<string, unknown>>; }
      catch { activeRawBodyCommands--; save(type + '-missing', { requestId, reason: 'command-error' }); return; }
      void original.finally(() => { activeRawBodyCommands--; }).catch(() => undefined);
      track(boundedCommand(original).then(body => { save(type, { requestId, ...body }); })
        .catch(() => { save(type + '-missing', { requestId, reason: 'unavailable' }); }));
    };
    cdp.on('Network.requestWillBeSent', event => {
      let url: URL; try { url = new URL(event.request.url); } catch { return; }
      if (!/(^|\.)(capcut\.com|capcutapi\.com|byteoversea\.com|ibytedtos\.com)$/.test(url.hostname) &&
          !(url.hostname === 'tos-my319-share.tiktokcdn.com' && url.pathname.startsWith('/upload/'))) return;
      if (!/\/((lv|luckycat|storyboard|storyboard_agent|passport|commerce|cc|upload)\/|ttuploader_proxy)/.test(url.pathname)) return;
      const prior = requests.get(event.requestId);
      if (!prior && requests.size >= 10000) { summary.dropped++; summary.policyLimit++; return; }
      const next = { stage, hop: prior ? prior.hop + 1 : 0, streamBytes: 0 };
      if (prior) write({ type: 'redirect', requestId: event.requestId, sessionId, stage: prior.stage, fromHop: prior.hop, toHop: next.hop, response: event.redirectResponse });
      requests.set(event.requestId, next);
      save('request', event);
      for (const extra of earlyExtra.get(event.requestId) ?? []) save('request-extra', { requestId: event.requestId, ...extra });
      earlyExtra.delete(event.requestId);
      if (event.request.hasPostData && !event.request.postData) bodyCommand('Network.getRequestPostData', event.requestId, 'request-body');
    });
    cdp.on('Network.requestWillBeSentExtraInfo', event => {
      if (requests.has(event.requestId)) save('request-extra', event);
      else if (earlyExtra.size < 512) earlyExtra.set(event.requestId, [...(earlyExtra.get(event.requestId) ?? []), event]);
      else { summary.policyLimit++; summary.capabilityGaps++; }
    });
    cdp.on('Network.responseReceivedExtraInfo', event => save('response-extra', event));
    cdp.on('Network.responseReceived', event => {
      save('response', event);
      const info = requests.get(event.requestId);
      if (!info || !event.response.mimeType.includes('event-stream')) return;
      track(boundedCommand(cdp.send('Network.streamResourceContent', { requestId: event.requestId }) as Promise<Record<string, unknown>>)
        .then(body => { if (typeof body.bufferedData === 'string') info.prefix = body.bufferedData; save('stream', { requestId: event.requestId, ...body }); })
        .catch(() => save('stream-unavailable', { requestId: event.requestId })));
    });
    cdp.on('Network.dataReceived', event => {
      const info = requests.get(event.requestId);
      if (!info || !event.data || event.data === info.prefix) return;
      info.streamBytes += event.data.length;
      if (info.streamBytes <= 8 * 1024 * 1024) save('stream', event);
      else { summary.dropped++; summary.policyLimit++; }
    });
    cdp.on('Network.eventSourceMessageReceived', event => save('sse', event));
    cdp.on('Network.loadingFailed', event => save('failed', event));
    cdp.on('Network.loadingFinished', event => {
      if (!requests.has(event.requestId)) return;
      save('finished', event);
      if (event.encodedDataLength > 8 * 1024 * 1024) { summary.dropped++; summary.policyLimit++; return; }
      bodyCommand('Network.getResponseBody', event.requestId, 'response-body');
    });
    try {
      await boundedCommand(cdp.send('Network.enable', { maxPostDataSize: 8 * 1024 * 1024, maxResourceBufferSize: 8 * 1024 * 1024, maxTotalBufferSize: 64 * 1024 * 1024 }));
      write({ type: 'target-capability', sessionId, pageNetwork: true, serviceWorkerNetwork: false, reason: 'service-worker-target-unsupported' });
      summary.capabilityGaps++;
    } catch {
      (cdp as unknown as EventEmitter).removeAllListeners(); summary.capabilityGaps++;
      write({ type: 'target-capability', sessionId, pageNetwork: false, serviceWorkerNetwork: false, reason: 'network-enable-failed' });
      await boundedDetach(cdp);
    }
  }

  const onPage = (page: Page) => { track(attach(page).catch(() => { summary.capabilityGaps++; write({ type: 'page-attach-failed' }); })); };
  context.on('page', onPage);
  try {
    await Promise.all(context.pages().map(attach));
    if (!write({ type: 'capture-start', encryption: 'injected-os-vault', limits: { maxFileBytes, maxQueuedBytes, maxRawBodyCommands: 2, commandTimeoutMs, stopTimeoutMs }, omitted: ['oversize-bodies', 'unmatched-hosts', 'service-worker-target-network'] }) && summary.encryptionErrors > 0) {
      throw new Error('PRIVATE_CAPTURE_ENCRYPTION_FAILED');
    }
  } catch (error) {
    stopping = true; context.off('page', onPage);
    for (const session of sessions) (session as unknown as EventEmitter).removeAllListeners();
    await Promise.allSettled([...sessions].map(boundedDetach));
    closed = true; output.destroy(); throw error;
  }

  let stopPromise: Promise<PrivateCaptureSummary> | undefined;
  return {
    mark(next: string) { if (!stopping) { stage = next; write({ type: 'stage', stage }); } },
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true; context.off('page', onPage);
      stopPromise = (async () => {
        for (const session of sessions) (session as unknown as EventEmitter).removeAllListeners();
        await Promise.race([Promise.allSettled([...commands]), new Promise(resolve => setTimeout(resolve, stopTimeoutMs))]);
        await Promise.allSettled([...sessions].map(boundedDetach));
        write({ type: 'capture-end', ...summary });
        await Promise.race([
          new Promise<void>(resolve => { if (output.closed || output.destroyed) { resolve(); return; } output.once('close', resolve); output.end(); }),
          new Promise<void>(resolve => setTimeout(() => { output.destroy(); resolve(); }, stopTimeoutMs))
        ]);
        await Promise.allSettled([...writes]);
        closed = true;
        return { ...summary };
      })();
      return stopPromise;
    }
  };
}
