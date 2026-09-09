import { describe, expect, it, vi } from 'vitest';
import { submitDesignChat } from '../designStudio';

describe('submitDesignChat', () => {
  it('creates a thread then starts the captured SSE operation with account-derived IDs', async () => {
    const requestJson = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { data: { thread_info: { thread_id: 'thread-live' } } } });
    const requestText = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: { 'content-type': 'text/event-stream' }, body: 'data: accepted\n\n' });
    const client = { requestJson, requestText } as never;
    const result = await submitDesignChat(client, { workspaceId: 'workspace-live', resourceId: 'resource-live', source: 1, mode: 1, prompt: 'make it brighter', selectedModels: [{ category: 1, models: [] }], libraParams: { new_agent_panel_type: 1 }, headers: { sign: 'captured' }, query: { msToken: 'captured' } });
    expect(result.threadId).toBe('thread-live');
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({ path: '/lv/v2/intelligence/thread/create', effect: 'mutation', body: expect.objectContaining({ workspace_id: 'workspace-live', resource_id: 'resource-live' }) }));
    expect(requestText).toHaveBeenCalledWith(expect.objectContaining({ path: '/lv/v2/intelligence/thread/run/start', body: expect.objectContaining({ thread_id: 'thread-live', workspace_id: 'workspace-live' }) }));
  });
});
