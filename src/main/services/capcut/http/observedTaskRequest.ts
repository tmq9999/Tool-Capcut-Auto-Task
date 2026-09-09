import type { CapcutHttpRequest } from './CapcutHttpClient';

interface CaptureRow {
  sessionId?: number; requestId?: string; type?: string; postData?: string;
  request?: { url: string; method: string; postData?: string; headers?: Record<string, string> };
  headers?: Record<string, string>;
}
const HEADERS = new Set(['appid', 'appvr', 'device-time', 'sign', 'sign-ver', 'did', 'tdid', 'lan', 'pf',
  'store-country-code', 'store-country-code-src', 'user-agent', 'accept', 'content-type', 'referer', 'origin', 'cookie']);
const ORIGIN = 'https://edit-api-sg.capcut.com';
const PATH = '/luckycat/i18n/capcut/task/v1/task_list';

/** Diagnostic read replay only. Returned secrets remain in the caller's memory. */
export function observedTaskRequest(rows: CaptureRow[]): { origin: string; request: CapcutHttpRequest } {
  for (const row of [...rows].reverse()) {
    const wire = row.request;
    if (!wire || wire.method !== 'POST') continue;
    let url: URL; try { url = new URL(wire.url); } catch { continue; }
    if (url.origin !== ORIGIN || url.pathname !== PATH || url.username || url.password) continue;
    const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
    const body = wire.postData ?? related.find(r => r.type === 'request-body')?.postData;
    if (typeof body !== 'string') continue;
    try { if (typeof JSON.parse(body).scene !== 'string' || !JSON.parse(body).scene) continue; } catch { continue; }
    const headers: Record<string, string> = {};
    for (const raw of [wire.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) {
      for (const [name, value] of Object.entries(raw)) if (HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    }
    if (!headers.cookie || !headers.sign || !headers['content-type']?.includes('application/json')) continue;
    return { origin: url.origin, request: { path: url.pathname + url.search, method: 'POST', body, headers, effect: 'read' } };
  }
  throw new Error('CAPCUT_HTTP_READ_CONTRACT_UNAVAILABLE');
}
