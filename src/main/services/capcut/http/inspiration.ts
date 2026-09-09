import type { HttpJsonClient } from './httpTypes';

interface InspirationHttpRequest {
  origin?: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  effect?: 'read' | 'mutation';
}

interface InspirationHttpClient extends HttpJsonClient {
  requestJson<T>(request: InspirationHttpRequest): Promise<{ status: number; ok: boolean; data: T }>;
}

export interface InspirationAllowanceContract {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  query?: Record<string, string | number | boolean>;
}

export interface InspirationContract {
  path: string;
  headers: Record<string, string>;
  body: string;
  query?: Record<string, string | number | boolean>;
  allowance: InspirationAllowanceContract;
}
export interface InspirationReceipt { status: number; accepted: boolean; bodyKeys: string[]; taskId?: string; }

interface AllowanceIdentity { resource_id: string | number; resource_type: string | number; benefit_type: string | number; }

function parseJsonObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('INSPIRATION_CONTRACT_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INSPIRATION_CONTRACT_INVALID');
  return value as Record<string, unknown>;
}

function identity(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INSPIRATION_CONTRACT_INVALID');
  const item = value as Partial<AllowanceIdentity>;
  if (!['string', 'number'].includes(typeof item.resource_id) || !['string', 'number'].includes(typeof item.resource_type) ||
    !['string', 'number'].includes(typeof item.benefit_type)) throw new Error('INSPIRATION_CONTRACT_INVALID');
  return JSON.stringify([
    [typeof item.resource_id, item.resource_id],
    [typeof item.resource_type, item.resource_type],
    [typeof item.benefit_type, item.benefit_type]
  ]);
}

function requestedAllowanceIdentities(body: Record<string, unknown>): Set<string> {
  if (!Array.isArray(body.item_list) || body.item_list.length === 0) throw new Error('INSPIRATION_CONTRACT_INVALID');
  const identities = new Set(body.item_list.map(identity));
  if (identities.size !== body.item_list.length) throw new Error('INSPIRATION_CONTRACT_INVALID');
  return identities;
}

function assertOneTemplate(body: Record<string, unknown>): void {
  if (!Array.isArray(body.tasks) || body.tasks.length !== 1) throw new Error('INSPIRATION_CONTRACT_INVALID');
  const task = body.tasks[0];
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('INSPIRATION_CONTRACT_INVALID');
  let payload = (task as { payload?: unknown }).payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw new Error('INSPIRATION_CONTRACT_INVALID'); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    !['string', 'number'].includes(typeof (payload as { template_id?: unknown }).template_id) ||
    String((payload as { template_id?: unknown }).template_id) !== '7611886117142531329') throw new Error('INSPIRATION_CONTRACT_INVALID');
}

function assertFreeAllowance(response: { status: number; ok: boolean; data: unknown }, expected: Set<string>): void {
  const envelope = response.data as { ret?: unknown; data?: { status?: unknown; item_list?: unknown[] } } | undefined;
  const items = envelope?.data?.item_list;
  if (!response.ok || String(envelope?.ret) !== '0' || envelope?.data?.status !== 1 || !Array.isArray(items) || items.length !== expected.size) {
    throw new Error('INSPIRATION_FREE_ALLOWANCE_UNAVAILABLE');
  }
  const seen = new Set<string>();
  for (const value of items) {
    let key: string;
    try { key = identity(value); } catch { throw new Error('INSPIRATION_FREE_ALLOWANCE_UNAVAILABLE'); }
    const item = value as { status?: unknown; credits_amount?: unknown; consume_types?: unknown };
    if (!expected.has(key) || seen.has(key) || item.status !== 1 || item.credits_amount !== 0 ||
      !Array.isArray(item.consume_types) || item.consume_types.length !== 1 || item.consume_types[0] !== 'LimitFree') {
      throw new Error('INSPIRATION_FREE_ALLOWANCE_UNAVAILABLE');
    }
    seen.add(key);
  }
}

/** Dispatches an observed Inspiration mutation through the account HTTP client. */
export async function submitInspirationHttp(client: InspirationHttpClient, request: InspirationContract, signal?: AbortSignal): Promise<InspirationReceipt> {
  if (request.path !== '/lv/v1/common_task/new' || request.allowance?.origin !== 'https://commerce-api-sg.capcut.com' ||
    request.allowance.path !== '/commerce/v3/benefits/batch_check_withhold_deduct') throw new Error('INSPIRATION_CONTRACT_INVALID');
  const body = parseJsonObject(request.body);
  assertOneTemplate(body);
  const allowanceBody = parseJsonObject(request.allowance.body);
  const expected = requestedAllowanceIdentities(allowanceBody);
  signal?.throwIfAborted();
  const allowance = await client.requestJson<unknown>({
    origin: request.allowance.origin, path: request.allowance.path, method: 'POST', headers: request.allowance.headers,
    query: request.allowance.query, body: allowanceBody, effect: 'read', signal
  });
  assertFreeAllowance(allowance, expected);
  signal?.throwIfAborted();
  const result = await client.requestJson<Record<string, unknown>>({ path: request.path, method: 'POST', headers: request.headers, query: request.query, body, effect: 'mutation', signal });
  if (!result.ok) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  const ret = result.data.ret;
  const responseData = result.data.data as { tasks?: unknown[]; failed_tasks?: unknown[] } | undefined;
  const responseTasks = Array.isArray(responseData?.tasks) ? responseData.tasks : [];
  if ((typeof ret === 'string' || typeof ret === 'number') && String(ret) !== '0') {
    if (responseTasks.length > 0) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
    throw new Error('INSPIRATION_HTTP_REJECTED');
  }
  if (String(ret) !== '0') throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  const data = responseData;
  if (Array.isArray(data?.failed_tasks) && data.failed_tasks.length > 0) {
    if (responseTasks.length > 0) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
    throw new Error('INSPIRATION_HTTP_REJECTED');
  }
  if (!Array.isArray(data?.failed_tasks) || !Array.isArray(data.tasks) || data.tasks.length !== 1) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  const rawTask = data.tasks[0];
  if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  const task = rawTask as { id?: unknown; status?: unknown };
  const taskId = typeof task.id === 'string' && task.id ? task.id : undefined;
  const acceptedStatuses = new Set(['queueing', 'processing', 'success', 'succeed']);
  if (!taskId || typeof task.status !== 'string' || !acceptedStatuses.has(task.status)) throw new Error('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  const accepted = true;
  return { status: result.status, accepted, bodyKeys: Object.keys(result.data), ...(taskId ? { taskId } : {}) };
}
