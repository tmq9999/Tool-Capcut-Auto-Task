import { expect, it, vi } from 'vitest';
import { fetchDraftVersion, pollCreatorEvent, queryGeneration, sendCreatorMessage, submitDraftChanges, updateCanvasCover } from '../creator';

it('uses only captured Creator endpoints and preserves caller-owned payload dependencies', async () => {
  const requestJson = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { ret: 0 } });
  const client = { requestJson } as never;
  const context = { headers: { sign: 'captured' }, query: { web_id: 'captured' } };
  const body = { conversation_info: { conversation_id: 'conversation-live' }, content: { content_type: 'text' } };
  await sendCreatorMessage(client, body, context);
  await pollCreatorEvent(client, { event_id: 'event-live' }, context);
  await queryGeneration(client, { task_ids: ['job-live'] }, context);
  await submitDraftChanges(client, { changeset: { draft_id: 'draft-live' } }, context);
  await fetchDraftVersion(client, { draft_id: 'draft-live' }, context);
  await updateCanvasCover(client, { draft_id: 'draft-live', node_id: 'node-live' }, context);
  expect(requestJson.mock.calls.map(([r]) => r.path)).toEqual([
    '/storyboard_agent/v1/ai_lab/send_msg', '/storyboard_agent/v1/ai_lab/poll_by_event_id',
    '/lv/v1/effect/genai/task/query', '/storyboard/v1/studio_draft/submit_changeset',
    '/storyboard/v1/studio_draft/fetch_latest_version', '/lv/v2/canvas/cover/update'
  ]);
  expect(requestJson.mock.calls[0][0].body).toBe(body);
});
