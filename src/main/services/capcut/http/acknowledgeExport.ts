import type { APIRequestContext } from 'playwright-core';
import { observedTaskRequest } from './observedTaskRequest';

interface Row {
  sessionId?: number; requestId?: string; type?: string; postData?: string;
  request?: { url: string; method: string; postData?: string; headers?: Record<string,string> };
  headers?: Record<string,string>;
}
interface Intent {
  accountId: string; stage: string; state: string;
  data?: { roundId?: string; conversationId?: string; resourceId?: string; bytes?: number; mime?: string };
}
const EXPORT = 'capcut_web_video_studio_export';
const API = 'https://edit-api-sg.capcut.com';
const PATH = '/luckycat/i18n/capcut/task/v1/do_action';

/** Acknowledgement is permitted only for the real generated/exported artifact in this journal. */
export async function acknowledgeExport(input: {
  accountId: string; rows: Row[]; intents: Intent[]; context: APIRequestContext; signal: AbortSignal;
  persist: (stage: string, state: string, data: unknown) => void;
  report: (data: Record<string,unknown>) => void;
  sendAcknowledgement?: (request: { url: string; headers: Record<string,string>; body: string }) => Promise<{ status: number; ok: boolean; json: { err_no?: number } }>;
}): Promise<void> {
  const { intents, rows, context, signal, persist, report } = input;
  if (!intents.length || intents.some(r => r.accountId !== input.accountId)) throw new Error('EXPORT_ACK_ACCOUNT_MISMATCH');
  const generated = intents.find(r => r.stage === 'creator-generate' && r.state === 'accepted');
  const downloaded = [...intents].reverse().find(r => r.stage === 'creator-export' && r.state === 'downloaded' &&
    r.data?.roundId === generated?.data?.roundId && r.data?.conversationId === generated?.data?.conversationId);
  if (!generated || !downloaded?.data?.resourceId || !(Number(downloaded.data.bytes) > 100) || downloaded.data.mime !== 'image/png') throw new Error('EXPORT_ACK_RECEIPT_MISSING');
  if (intents.some(r => r.stage === 'creator-export-ack' && r.state === 'dispatching')) throw new Error('EXPORT_ACK_ALREADY_DISPATCHED');
  const task = observedTaskRequest(rows);
  const readSnapshot = async () => {
    const res = await context.fetch(task.origin + task.request.path, { method: 'POST', headers: task.request.headers, data: task.request.body, signal, timeout: 15000, maxRedirects: 0, maxRetries: 0 });
    try {
      const json = await res.json();
      if (!res.ok() || json?.err_no !== 0 || !Array.isArray(json?.data?.task_list)) throw new Error('EXPORT_ACK_SNAPSHOT_INVALID');
      return json.data.task_list as Array<{ task_key: string; task_status: number; task_reward_view?: { reward_amount?: number } }>;
    } finally { await res.dispose(); }
  };
  const before = await readSnapshot();
  const target = before.find(t => t.task_key === EXPORT);
  if (!target) throw new Error('EXPORT_TASK_UNAVAILABLE');
  if (target.task_status === 4) { report({ stage: 'creator-export-ack', alreadyComplete: true }); return; }
  // The observed op_id contract is task_key + account user ID + UTC day. Keep the
  // captured account/day suffix, and refuse stale-day acknowledgement.
  const suffixes = new Set<string>();
  let template: Row | undefined;
  for (const row of rows) {
    if (row.request?.method !== 'POST') continue;
    const url = new URL(row.request.url);
    if (url.origin !== API || url.pathname !== PATH) continue;
    const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
    const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
    if (!raw) continue;
    let body; try { body = JSON.parse(raw); } catch { continue; }
    if (typeof body.action_key !== 'string' || !/^capcut_web_/.test(body.action_key) || typeof body.op_id !== 'string') continue;
    if (!body.op_id.startsWith(body.action_key + '_')) throw new Error('EXPORT_ACK_OP_ID_CONTRACT_CHANGED');
    const suffix = body.op_id.slice(body.action_key.length);
    if (!/^_\d+_\d{4}-\d{2}-\d{2}$/.test(suffix)) throw new Error('EXPORT_ACK_OP_ID_CONTRACT_CHANGED');
    suffixes.add(suffix); template = row;
  }
  if (!template || suffixes.size !== 1) throw new Error('EXPORT_ACK_IDENTITY_UNPROVEN');
  const suffix = [...suffixes][0];
  if (!suffix.endsWith(new Date().toISOString().slice(0,10))) throw new Error('EXPORT_ACK_STALE_TASK_PERIOD');
  const headers: Record<string,string> = {};
  const allowed = new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
  const related = rows.filter(r => r.sessionId === template.sessionId && r.requestId === template.requestId);
  for (const source of [template.request?.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) {
    for (const [k,v] of Object.entries(source)) if (allowed.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  }
  if (!headers.cookie) throw new Error('EXPORT_ACK_AUTH_MISSING');
  const body = { action_key: EXPORT, op_id: EXPORT + suffix };
  if (!input.sendAcknowledgement) throw new Error('EXPORT_ACK_FRESH_REQUEST_REQUIRED');
  const targetUrl = new URL(API + PATH);
  const capturedUrl = new URL(template.request!.url);
  for (const key of ['aid', 'device_platform']) {
    const value = capturedUrl.searchParams.get(key);
    if (value !== null) targetUrl.searchParams.set(key, value);
  }
  signal.throwIfAborted();
  persist('creator-export-ack', 'dispatching', { body, receipt: downloaded.data });
  const response = await input.sendAcknowledgement({ url: targetUrl.toString(), headers, body: JSON.stringify(body) });
  persist('creator-export-ack', 'response', { status: response.status, json: response.json });
  report({ stage: 'creator-export-ack', status: response.status, errNo: response.json?.err_no });
  if (!response.ok || response.json?.err_no !== 0) throw new Error('EXPORT_ACK_REJECTED');
  const after = await readSnapshot();
  persist('creator-export-ack', 'snapshot', after);
  const confirmed = after.find(t => t.task_key === EXPORT)?.task_status === 4;
  report({ stage: 'creator-export-task-proof', confirmed, done: after.filter(t => t.task_status === 4).length, total: after.length,
    exportReward: after.find(t => t.task_key === EXPORT)?.task_reward_view?.reward_amount });
  if (!confirmed) throw new Error('EXPORT_ACK_SNAPSHOT_PENDING');
}
