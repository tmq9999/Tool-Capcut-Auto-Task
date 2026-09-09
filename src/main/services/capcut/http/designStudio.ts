import type { HttpOnlyClient } from './httpTypes';

export interface DesignChatInput {
  workspaceId: string;
  resourceId: string;
  source: number;
  mode: number;
  prompt: string;
  selectedModels: Array<{ category: number; models: unknown[] }>;
  libraParams: Record<string, unknown>;
  headers: Record<string, string>;
  query: Record<string, string | number | boolean>;
}

export interface DesignChatReceipt {
  threadId: string;
  status: number;
  streamBody: string;
}

export async function submitDesignChat(client: HttpOnlyClient, input: DesignChatInput, signal?: AbortSignal): Promise<DesignChatReceipt> {
  const created = await client.requestJson<{ data?: { thread_info?: { thread_id?: string } } }>({
    path: '/lv/v2/intelligence/thread/create', method: 'POST', effect: 'mutation', signal,
    headers: input.headers, query: input.query,
    body: { resource_id: input.resourceId, workspace_id: input.workspaceId, source: input.source, is_local_resource: false }
  });
  const threadId = String(created.data?.data?.thread_info?.thread_id ?? '');
  if (!threadId) throw new Error('CAPCUT_HTTP_THREAD_ID_MISSING');
  const stream = await client.requestText({
    path: '/lv/v2/intelligence/thread/run/start', method: 'POST', effect: 'mutation', signal,
    headers: input.headers, query: input.query,
    body: { source: input.source, mode: input.mode, contents: [{ type: 'text', text: input.prompt }],
      thread_id: threadId, workspace_id: input.workspaceId, resource_id: input.resourceId,
      selected_models: input.selectedModels, libra_params: JSON.stringify(input.libraParams) }
  });
  if (!stream.ok) throw new Error('CAPCUT_HTTP_DESIGN_CHAT_' + stream.status);
  return { threadId, status: stream.status, streamBody: stream.body };
}
