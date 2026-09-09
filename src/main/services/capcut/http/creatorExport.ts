import { createHash } from 'node:crypto';
import type { AccountHttpSession } from './accountSession';
import { assertAccountHttpSessionUsable } from './accountSession';
import type { HttpOnlyClient } from './httpTypes';

export interface CreatorExportContract {
  path: string;
  body: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  assetResource: string;
  downloadOrigin: string;
}

export interface CreatorExportReceipt { resource: string; bytes: number; sha256: string; mime: string; }

/** Queries and downloads one ready Creator asset through the account HTTP session. */
export async function exportCreatorAsset(client: HttpOnlyClient, session: AccountHttpSession, contract: CreatorExportContract, signal?: AbortSignal): Promise<CreatorExportReceipt> {
  assertAccountHttpSessionUsable(session);
  if (contract.path !== '/storyboard_agent/v1/ai_lab/batch_query_assets' || !contract.assetResource || !/^https:\/\/[^\s]+$/.test(contract.downloadOrigin)) throw new Error('CREATOR_EXPORT_CONTRACT_INVALID');
  const query = await client.requestJson<Record<string, unknown>>({ path: contract.path, method: 'POST', effect: 'read', body: contract.body, headers: contract.headers, query: contract.query, signal });
  if (!query.ok || String(query.data.ret ?? '') !== '0') throw new Error('CREATOR_EXPORT_QUERY_REJECTED');
  const item = (query.data.data as { items?: Array<{ resource?: string; url?: string; err_code?: number | string }> } | undefined)?.items?.find(value => value.resource === contract.assetResource);
  if (!item?.url || (item.err_code !== undefined && String(item.err_code) !== '0')) throw new Error('CREATOR_EXPORT_NOT_READY');
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.origin !== contract.downloadOrigin || url.username || url.password) throw new Error('CREATOR_EXPORT_DOWNLOAD_ORIGIN_REJECTED');
  const response = await session.context.get(url.toString(), { signal, timeout: 30_000, maxRedirects: 0, maxRetries: 0 });
  try {
    const bytes = await response.body();
    const image = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
    if (!response.ok() || bytes.length < 100 || bytes.length > 30 * 1024 * 1024 || !image) throw new Error('CREATOR_EXPORT_INVALID_ARTIFACT');
    return { resource: contract.assetResource, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime: response.headers()['content-type'] ?? '' };
  } finally { await response.dispose(); }
}
