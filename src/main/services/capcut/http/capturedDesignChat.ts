import { ProxyAgent, fetch } from 'undici';
import type { Dispatcher } from 'undici';
import { inspectDesignReceipt } from './designReceipt';

interface Row {
  sessionId?: number; requestId?: string; type?: string; stage?: string; postData?: string;
  request?: { url: string; method: string; postData?: string; postDataEntries?: Array<{ bytes?: string }>; headers?: Record<string, string> };
  headers?: Record<string, string>;
}
interface Wire { url: string; body: Record<string, unknown>; headers: Record<string, string>; }
const allowedHeaders = new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);

function capturedWire(rows: Row[], pathname: string): Wire {
  const row = rows.find(r => r.request?.method === 'POST' &&
    (r.stage === 'design:chat' || r.stage === 'design:chat-accepted') &&
    new URL(r.request.url).pathname === pathname);
  if (!row?.request) throw new Error('DESIGN_CAPTURE_CONTRACT_MISSING');
  const url = new URL(row.request.url);
  if (url.origin !== 'https://edit-api-sg.capcut.com') throw new Error('DESIGN_ORIGIN_REJECTED');
  const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
  const body = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData
    ?? (row.request.postDataEntries ? Buffer.concat(row.request.postDataEntries.map(p => Buffer.from(p.bytes ?? '', 'base64'))).toString() : undefined);
  if (!body) throw new Error('DESIGN_CAPTURE_BODY_MISSING');
  const headers: Record<string, string> = {};
  for (const source of [row.request.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) {
    for (const [key, value] of Object.entries(source)) if (allowedHeaders.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
  }
  if (!headers.cookie) throw new Error('DESIGN_CAPTURE_COOKIE_MISSING');
  return { url: url.toString(), body: JSON.parse(body), headers };
}

export interface CapturedDesignOptions {
  rows: Row[];
  proxy: { server: string; username?: string; password?: string };
  signal: AbortSignal;
  persist: (stage: string, state: string, data: unknown) => void;
  report: (data: Record<string, unknown>) => void;
  browserSend?: (wire: {url: string; headers: Record<string,string>; body: string}) => Promise<{status:number; mime:string; raw:string; timedOut:boolean}>;
}

/** Same-account diagnostic only; never reuse these captured IDs across accounts. */
export async function runCapturedDesignChat(options: CapturedDesignOptions): Promise<void> {
  const create = capturedWire(options.rows, '/lv/v2/intelligence/thread/create');
  const send = capturedWire(options.rows, '/lv/v2/intelligence/thread/run/start');
  if (create.body.workspace_id !== send.body.workspace_id || create.body.resource_id !== send.body.resource_id) throw new Error('DESIGN_DEPENDENCY_MISMATCH');
  const dispatcher = new ProxyAgent({ uri: options.proxy.server,
    ...(options.proxy.username ? { token: 'Basic ' + Buffer.from(options.proxy.username + ':' + (options.proxy.password ?? '')).toString('base64') } : {}) });
  try {
    const created = await dispatchJson(create, dispatcher, options, 'thread-create');
    const threadId = created?.data?.thread_info?.thread_id;
    if (String(created.ret) !== '0' || typeof threadId !== 'string' || !threadId) throw new Error('DESIGN_THREAD_REJECTED');
    options.report({ stage: 'thread-create', accepted: true, ret: created.ret });
    send.body.thread_id = threadId;
    options.signal.throwIfAborted();
    options.persist('design-chat', 'dispatching', { url: send.url, body: send.body });
    if (options.browserSend) {
      const result = await options.browserSend({ url:send.url, headers:send.headers, body:JSON.stringify(send.body) });
      options.persist('design-chat','browser-response',result);
      const events = result.raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => {
        try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
      }).filter(Boolean);
      let json; try { json = JSON.parse(result.raw); } catch { /* SSE */ }
      options.report({ stage:'design-browser-http', mechanism:'browser-http', status:result.status, mime:result.mime, events:events.length, timedOut:result.timedOut,
        ret: json?.ret, eventKeys:events.slice(0,6).map(e => Object.keys(e)), domClicks:0, taskVerified:false });
      const started = events.find(e => e.type === 'run_start' && e.thread_id === threadId && typeof e.run_id === 'string');
      const ended = started && events.find(e => e.type === 'run_end' && e.run_id === started.run_id);
      const receipt = inspectDesignReceipt(result.raw, threadId);
      const failed = !receipt.accepted;
      options.report({stage:'design-artifact-evidence',mechanism:'browser-http',artifactErrors:receipt.artifactErrors,artifacts:receipt.artifacts});
      if (!result.mime.includes('event-stream') || !started || failed) throw new Error('DESIGN_BROWSER_RESPONSE_NOT_ACCEPTED');
      options.persist('design-chat','run-receipt',{threadId,runId:started.run_id,ended:Boolean(ended),taskVerified:false});
      options.report({stage:'design-chat-operation-receipt',mechanism:'browser-http',accepted:true,runEnded:Boolean(ended),taskVerified:false,domClicks:0});
      return;
    }
    const response = await fetch(send.url, { dispatcher, method: 'POST', headers: send.headers, body: JSON.stringify(send.body), redirect: 'manual', signal: options.signal });
    options.report({ stage: 'design-chat', status: response.status, mime: response.headers.get('content-type') });
    if (!response.ok) { await response.body?.cancel(); throw new Error('DESIGN_SEND_OUTCOME_UNKNOWN'); }
    const decoder = new TextDecoder(); let buffer = ''; let bytes = 0; let events = 0;
    if (response.headers.get('content-type')?.includes('json')) {
      const json = await response.json() as Record<string, unknown>;
      options.persist('design-chat', 'json-response', { status: response.status, data: json });
      options.report({ stage: 'design-chat-json-response', ret: typeof json.ret === 'string' || typeof json.ret === 'number' ? json.ret : undefined,
        errNo: typeof json.err_no === 'number' ? json.err_no : undefined,
        errmsgPresent: typeof json.errmsg === 'string' && json.errmsg.length > 0,
        responseKeys: Object.keys(json) });
      if (json.ret !== '0' && json.ret !== 0 && json.err_no !== 0) throw new Error('DESIGN_SEND_REJECTED');
      return;
    }
    if (!response.body) throw new Error('DESIGN_STREAM_MISSING');
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('DESIGN_STREAM_LIMIT');
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        events++;
        const payload = line.slice(5).trim();
        options.persist('design-chat', 'event', payload);
        let event; try { event = JSON.parse(payload); } catch { continue; }
        options.report({ stage: 'design-chat-event', index: events, keys: Object.keys(event),
          event: typeof event.event === 'string' && /^[a-z_]{1,60}$/i.test(event.event) ? event.event : undefined,
          code: typeof event.code === 'number' ? event.code : undefined,
          dataKeys: event.data && typeof event.data === 'object' ? Object.keys(event.data) : undefined });
      }
    }
    options.persist('design-chat', 'stream-ended', { threadId, events, bytes });
    options.report({ stage: 'design-chat-stream-ended', events, bytes, taskVerified: false });
  } finally { await dispatcher.destroy(); }
}

async function dispatchJson(wire: Wire, dispatcher: Dispatcher, options: CapturedDesignOptions, stage: string) {
  options.signal.throwIfAborted();
  options.persist(stage, 'dispatching', { url: wire.url, body: wire.body });
  const response = await fetch(wire.url, { dispatcher, method: 'POST', headers: wire.headers, body: JSON.stringify(wire.body), redirect: 'manual', signal: options.signal });
  const data = await response.json() as { ret?: unknown; data?: { thread_info?: { thread_id?: unknown } } };
  options.persist(stage, 'response', { status: response.status, data });
  if (!response.ok) throw new Error('DESIGN_CREATE_OUTCOME_UNKNOWN');
  return data;
}
