import type { HttpStreamClient } from './httpTypes';
import { inspectDesignReceipt } from './designReceipt';

export interface CanvasEditInput {
  workspaceId: string;
  resourceId: string;
  threadId: string;
  contents: unknown[];
  source: number;
  mode: number;
  selectedModels?: unknown[];
  libraParams?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
}

export interface CanvasEditReceipt { status: number; accepted: boolean; threadId: string; runId: string; artifacts: number; }

/** Sends the canvas edit mutation directly through the account HTTP client. */
export async function submitCanvasEdit(client: Pick<HttpStreamClient, 'requestStream'>, input: CanvasEditInput, signal?: AbortSignal): Promise<CanvasEditReceipt> {
  const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const hasImage = Array.isArray(input.contents) && input.contents.some(item => item && typeof item === 'object' &&
    (item as { type?: unknown }).type === 'image' && nonempty((item as { image_id?: unknown }).image_id));
  if (!nonempty(input.workspaceId) || !nonempty(input.resourceId) || !nonempty(input.threadId) || !hasImage ||
    !Number.isInteger(input.source) || !Number.isInteger(input.mode)) throw new Error('CANVAS_INPUT_INVALID');
  signal?.throwIfAborted();
  const response = await client.requestStream({
    path: '/lv/v2/intelligence/thread/run/start', method: 'POST', effect: 'mutation', signal,
    headers: input.headers, query: input.query,
    deadlineMs: 240_000, maxBytes: 8 * 1024 * 1024,
    body: { source: input.source, mode: input.mode, contents: input.contents, thread_id: input.threadId, workspace_id: input.workspaceId, resource_id: input.resourceId,
      ...(input.selectedModels === undefined ? {} : { selected_models: input.selectedModels }),
      ...(input.libraParams === undefined ? {} : { libra_params: input.libraParams }) }
  });
  try {
    if (!response.ok || !response.headers['content-type']?.includes('text/event-stream')) throw new Error('CANVAS_HTTP_OUTCOME_UNKNOWN');
    const decoder = new TextDecoder();
    let raw = '';
    let bytes = 0;
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      bytes += chunk.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('CANVAS_HTTP_OUTCOME_UNKNOWN');
      raw += decoder.decode(chunk, { stream: true });
    }
    raw += decoder.decode();
    signal?.throwIfAborted();
    const receipt = inspectDesignReceipt(raw, input.threadId);
    if (receipt.started && receipt.artifactErrors.length > 0) throw new Error('CANVAS_GENERATION_FAILED');
    if (!receipt.accepted || !receipt.ended || !receipt.runId || receipt.artifacts === 0) throw new Error('CANVAS_HTTP_OUTCOME_UNKNOWN');
    return { status: response.status, accepted: true, threadId: input.threadId, runId: receipt.runId, artifacts: receipt.artifacts };
  } finally { await response.dispose(); }
}
