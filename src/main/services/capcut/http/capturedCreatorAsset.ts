import type { APIRequestContext } from 'playwright-core';

interface Row { sessionId?: number; requestId?: string; type?: string; stage?: string; request?: { url: string; method: string; postData?: string; headers?: Record<string,string> }; postData?: string; headers?: Record<string,string>; }
interface AssetResponse { ret?: string | number; data?: { items?: Array<{ url?: string }> } }
const ALLOWED = new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);

export async function queryAndDownloadCreatorAsset(rows: Row[], resourceId: string, context: APIRequestContext, signal: AbortSignal, report: (x: Record<string,unknown>) => void): Promise<{ bytes: number; mime: string }> {
  const row = rows.find(r => r.stage === 'creator:export' && r.request?.method === 'POST' && new URL(r.request.url).pathname === '/storyboard_agent/v1/ai_lab/batch_query_assets');
  if (!row?.request) throw new Error('CREATOR_ASSET_CONTRACT_MISSING');
  const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
  const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
  if (!raw) throw new Error('CREATOR_ASSET_BODY_MISSING');
  const body = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
  if (!body.items?.length) throw new Error('CREATOR_ASSET_ITEM_MISSING');
  body.items = [{ ...body.items[0], resource: resourceId }];
  const headers: Record<string,string> = {};
  for (const source of [row.request.headers ?? {}, ...related.filter(r => r.type === 'request-extra').map(r => r.headers ?? {})]) for (const [k,v] of Object.entries(source)) if (ALLOWED.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  if (!headers.cookie) throw new Error('CREATOR_ASSET_AUTH_MISSING');
  const response = await context.fetch(row.request.url, { method: 'POST', headers, data: JSON.stringify(body), signal, timeout: 30000, maxRedirects: 0, maxRetries: 0 });
  let json: AssetResponse; try { json = await response.json() as AssetResponse; } finally { await response.dispose(); }
  report({ stage: 'creator-asset-query-http', status: response.status(), ret: json?.ret });
  const item = json?.data?.items?.[0];
  if (!response.ok() || String(json?.ret) !== '0' || !item?.url) throw new Error('CREATOR_ASSET_QUERY_REJECTED');
  const asset = new URL(item.url); if (asset.protocol !== 'https:' || !/(^|\.)ibyteimg\.com$/.test(asset.hostname) || asset.username || asset.password) throw new Error('CREATOR_ASSET_ORIGIN_REJECTED');
  const download = await context.get(asset.toString(), { signal, timeout: 30000, maxRedirects: 0, maxRetries: 0 });
  try { const bytes = await download.body(); const mime = download.headers()['content-type'] ?? ''; const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); if (!download.ok() || bytes.length < 100 || bytes.length > 30*1024*1024 || !png) throw new Error('CREATOR_ASSET_DOWNLOAD_FAILED'); report({ stage: 'creator-asset-download-http', status: download.status(), bytes: bytes.length, mime, pngVerified: true }); return { bytes: bytes.length, mime }; }
  finally { await download.dispose(); }
}
