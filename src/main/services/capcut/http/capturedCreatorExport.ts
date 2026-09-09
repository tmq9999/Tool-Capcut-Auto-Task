import { createHash } from 'node:crypto';
import type { APIRequestContext } from 'playwright-core';

interface Row {
  sessionId?: number; requestId?: string; type?: string; stage?: string; body?: string; base64Encoded?: boolean; postData?: string;
  request?: { url: string; method: string; postData?: string; headers?: Record<string, string> };
  headers?: Record<string, string>;
}
interface Options {
  rows: Row[];
  context: APIRequestContext;
  signal: AbortSignal;
  report: (data: Record<string, unknown>) => void;
  persist: (stage: string, state: string, data: unknown) => void;
}

/** Export an already-generated asset from this same capture/account, never a new job. */
export async function exportCapturedCreatorAsset(options: Options): Promise<void> {
  const { rows, context, signal, report, persist } = options;
  const row = rows.find(r => r.request?.method === 'POST' && r.stage === 'creator:export' &&
    new URL(r.request.url).pathname === '/storyboard_agent/v1/ai_lab/batch_query_assets');
  if (!row?.request) throw new Error('CREATOR_EXPORT_CONTRACT_MISSING');
  const apiUrl = new URL(row.request.url);
  if (apiUrl.origin !== 'https://edit-api-sg.capcut.com') throw new Error('CREATOR_EXPORT_ORIGIN_REJECTED');
  const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
  const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
  if (!raw) throw new Error('CREATOR_EXPORT_BODY_MISSING');
  const body = JSON.parse(raw) as { items?: Array<{ resource?: string }> };
  if (body.items?.length !== 1 || !body.items[0].resource) throw new Error('CREATOR_EXPORT_ASSET_MISSING');
  const headers: Record<string, string> = {};
  const allowed = new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
  for (const source of [row.request.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) {
    for (const [name, value] of Object.entries(source)) if (allowed.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  }
  if (!headers.cookie) throw new Error('CREATOR_EXPORT_AUTH_MISSING');
  // Pin artifact origin to an origin actually returned for this asset in capture.
  const captured = related.find(r => r.type === 'response-body');
  if (!captured?.body) throw new Error('CREATOR_EXPORT_RESPONSE_MISSING');
  const old = JSON.parse(captured.base64Encoded ? Buffer.from(captured.body, 'base64').toString() : captured.body);
  const oldItem = old?.data?.items?.find((item: { resource: string }) => item.resource === body.items![0].resource);
  if (!oldItem?.url) throw new Error('CREATOR_EXPORT_URL_MISSING');
  const artifactOrigin = new URL(oldItem.url).origin;

  signal.throwIfAborted();
  const response = await context.fetch(apiUrl.toString(), { method: 'POST', headers, data: raw, signal, timeout: 20000, maxRedirects: 0, maxRetries: 0 });
  let result;
  try {
    result = await response.json();
    report({ stage: 'creator-export-query', status: response.status(), ret: result?.ret });
    if (!response.ok() || String(result?.ret) !== '0') throw new Error('CREATOR_EXPORT_QUERY_REJECTED');
  } finally { await response.dispose(); }
  const item = result?.data?.items?.find((value: { resource: string }) => value.resource === body.items![0].resource);
  if (!item || (item.err_code !== undefined && String(item.err_code) !== '0') || !item.url) throw new Error('CREATOR_EXPORT_NOT_READY');
  const downloadUrl = new URL(item.url);
  if (downloadUrl.origin !== artifactOrigin || downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password) throw new Error('CREATOR_EXPORT_DOWNLOAD_ORIGIN_REJECTED');
  persist('creator-export', 'download-started', { asset: item.resource, url: item.url });
  signal.throwIfAborted();
  // No API headers/cookies are copied to the artifact host; the URL has scoped authorization.
  const artifact = await context.get(downloadUrl.toString(), { signal, timeout: 30000, maxRedirects: 0, maxRetries: 0 });
  try {
    const bytes = await artifact.body();
    const mime = artifact.headers()['content-type'] ?? '';
    const image = (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP');
    if (!artifact.ok() || bytes.length < 100 || bytes.length > 30 * 1024 * 1024 || !image) throw new Error('CREATOR_EXPORT_INVALID_ARTIFACT');
    const receipt = { asset: item.resource, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime };
    persist('creator-export', 'artifact-downloaded', receipt);
    report({ stage: 'creator-export-artifact', status: artifact.status(), bytes: bytes.length, mime, imageVerified: true, taskRewardVerified: false });
  } finally { await artifact.dispose(); }
}
