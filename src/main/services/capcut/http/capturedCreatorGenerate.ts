import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from 'playwright-core';
import { ProxyAgent, fetch } from 'undici';

interface Row { sessionId?: number; requestId?: string; type?: string; stage?: string; body?: string; base64Encoded?: boolean; postData?: string; request?: { url: string; method: string; postData?: string; headers?: Record<string,string> }; headers?: Record<string,string>; }
interface Options { rows: Row[]; context: APIRequestContext; signal: AbortSignal; report: (x: Record<string, unknown>) => void; persist: (s: string, st: string, d: unknown) => void; }
interface CreatorResponse { ret?: string | number; data?: { draft_id?: string } }
interface PostResult { status: number; ok: boolean; json: CreatorResponse }
const ALLOWED = new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
function wire(rows: Row[], path: string, stage = 'creator:generate') {
  const row = rows.find(r => r.stage === stage && r.request?.method === 'POST' && new URL(r.request.url).pathname === path);
  if (!row?.request) throw new Error('CREATOR_HTTP_CONTRACT_MISSING');
  const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
  const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
  if (!raw) throw new Error('CREATOR_HTTP_BODY_MISSING');
  const headers: Record<string,string> = {};
  for (const source of [row.request.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) for (const [k,v] of Object.entries(source)) if (ALLOWED.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  if (!headers.cookie) {
    const sameOriginIds = new Set(rows.filter(r => r.sessionId === row.sessionId && r.request?.url && new URL(r.request.url).origin === new URL(row.request!.url).origin).map(r => r.requestId));
    for (const extra of rows.filter(r => r.sessionId === row.sessionId && r.type === 'request-extra' && sameOriginIds.has(r.requestId))) {
      const cookie = Object.entries(extra.headers ?? {}).find(([k]) => k.toLowerCase() === 'cookie')?.[1];
      if (cookie) { headers.cookie = cookie; break; }
    }
  }
  if (!headers.cookie) throw new Error('CREATOR_HTTP_AUTH_MISSING');
  const url = new URL(row.request.url); if (url.origin !== 'https://edit-api-sg.capcut.com') throw new Error('CREATOR_HTTP_ORIGIN_REJECTED');
  return { url: url.toString(), body: JSON.parse(raw) as Record<string,unknown>, raw, headers };
}
function replaceStrings(value: unknown, replacements: Map<string,string>): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map(v => replaceStrings(v, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, replaceStrings(v, replacements)]));
  return value;
}
async function postJson(context: APIRequestContext, item: ReturnType<typeof wire>, body: unknown, signal: AbortSignal): Promise<PostResult> {
  const response = await context.fetch(item.url, { method: 'POST', headers: item.headers, data: JSON.stringify(body), signal, timeout: 30000, maxRedirects: 0, maxRetries: 0 });
  let json: CreatorResponse; try { json = await response.json() as CreatorResponse; } finally { await response.dispose(); }
  return { status: response.status(), ok: response.ok(), json };
}
/** Starts a fresh Creator project and sends the captured generation message over HTTP. */
export async function runCapturedCreatorGenerate(options: Options): Promise<void> {
  const project = wire(options.rows, '/storyboard/v1/studio_draft/create_project');
  const message = wire(options.rows, '/storyboard_agent/v1/ai_lab/send_msg');
  const conversationId = randomUUID(); const roundId = randomUUID();
  const replacements = new Map<string,string>();
  const projectBody = replaceStrings(project.body, replacements) as Record<string,unknown>;
  const draftContent = (typeof projectBody.draft_content === 'string' ? JSON.parse(projectBody.draft_content) : projectBody.draft_content) as Record<string,unknown>;
  if (!draftContent || !Array.isArray(draftContent.children) || draftContent.children.length || !Array.isArray(draftContent.materials) || draftContent.materials.length) throw new Error('CREATOR_EMPTY_PROJECT_REQUIRED');
  options.signal.throwIfAborted();
  options.persist('creator-project', 'dispatching', { url: project.url, body: projectBody });
  const created = await postJson(options.context, project, projectBody, options.signal);
  options.persist('creator-project', 'response', created);
  options.report({ stage: 'creator-project-http', status: created.status, ret: created.json?.ret });
  const createdDraft = String(created.json?.data?.draft_id ?? '');
  if (!created.ok || String(created.json?.ret) !== '0' || !createdDraft) throw new Error('CREATOR_PROJECT_REJECTED');
  const msgBody = replaceStrings(message.body, replacements) as Record<string,unknown>;
  const info = msgBody.conversation_info as Record<string,unknown>;
  if (info) info.conversation_id = conversationId;
  msgBody.id = roundId; msgBody.round_id = roundId;
  const option = msgBody.option as Record<string,unknown>;
  if (option) option.__project_id = createdDraft;
  options.signal.throwIfAborted();
  options.persist('creator-generate', 'dispatching', { url: message.url, body: msgBody, draftId: createdDraft, conversationId, roundId });
  const sent = await postJson(options.context, message, msgBody, options.signal);
  options.persist('creator-generate', 'response', sent);
  options.report({ stage: 'creator-generate-http', status: sent.status, ret: sent.json?.ret, responseKeys: sent.json ? Object.keys(sent.json) : [] });
  if (!sent.ok || (sent.json?.ret !== undefined && String(sent.json.ret) !== '0')) throw new Error('CREATOR_GENERATE_REJECTED');
  options.persist('creator-generate', 'accepted', { draftId: createdDraft, conversationId, roundId });
}

export async function observeCreatorConversation(options: Options & {
  conversationId: string; proxy: { server: string; username?: string; password?: string };
}): Promise<void> {
  const poll = wire(options.rows, '/storyboard_agent/v1/ai_lab/poll_by_event_id', 'creator:open');
  const body = { ...poll.body, session_id: options.conversationId, event_id: '' };
  const dispatcher = new ProxyAgent({ uri: options.proxy.server,
    ...(options.proxy.username ? { token: 'Basic ' + Buffer.from(options.proxy.username + ':' + (options.proxy.password ?? '')).toString('base64') } : {}) });
  let events = 0; let bytes = 0;
  try {
    const response = await fetch(poll.url, { dispatcher, method: 'POST', headers: poll.headers, body: JSON.stringify(body), signal: options.signal, redirect: 'manual' });
    options.report({ stage: 'creator-poll', status: response.status, mime: response.headers.get('content-type') });
    if (!response.ok || !response.body) throw new Error('CREATOR_POLL_REJECTED');
    const decoder = new TextDecoder(); let buffer = '';
    for await (const chunk of response.body) {
      bytes += chunk.byteLength; if (bytes > 4 * 1024 * 1024) throw new Error('CREATOR_POLL_LIMIT');
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end+1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim(); let event;
        try { event = JSON.parse(raw); } catch { continue; }
        events++;
        options.persist('creator-poll', 'event', event);
        options.report({ stage: 'creator-poll-event', index: events, keys: Object.keys(event),
          eventType: typeof event.event === 'string' && /^[a-z_]{1,60}$/i.test(event.event) ? event.event : undefined,
          dataKeys: event.data && typeof event.data === 'object' ? Object.keys(event.data) : undefined });
      }
    }
  } catch (error) {
    if (!options.signal.aborted) throw error;
    options.report({ stage: 'creator-poll-deadline', events, bytes });
  } finally { await dispatcher.destroy(); }
}

export async function confirmCapturedCreator(options: Options & { conversationId: string; draftId: string; roundId: string }): Promise<void> {
  const contract = wire(options.rows, '/storyboard_agent/v1/ai_lab/send_msg', 'creator:confirm');
  const body = JSON.parse(JSON.stringify(contract.body)) as Record<string, unknown>;
  const info = body.conversation_info as Record<string, unknown>; if (info) info.conversation_id = options.conversationId;
  body.id = options.roundId; body.round_id = options.roundId;
  const option = body.option as Record<string, unknown>; if (option) option.__project_id = options.draftId;
  const content = body.content as Record<string, unknown>; if (content) content.data = JSON.stringify({ credits_confirm: true });
  options.persist('creator-confirm', 'dispatching', { url: contract.url, body });
  const result = await postJson(options.context, contract, body, options.signal);
  options.persist('creator-confirm', 'response', result);
  options.report({ stage: 'creator-confirm-http', status: result.status, ret: result.json?.ret });
  if (!result.ok || String(result.json?.ret) !== '0') throw new Error('CREATOR_CONFIRM_REJECTED');
}
