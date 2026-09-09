import type { HttpOnlyClient } from './httpTypes';

export interface CreatorRequestContext { headers: Record<string, string>; query: Record<string, string | number | boolean>; signal?: AbortSignal; }

export async function sendCreatorMessage(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/storyboard_agent/v1/ai_lab/send_msg', method: 'POST', effect: 'mutation', body, ...context });
}

export async function pollCreatorEvent(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/storyboard_agent/v1/ai_lab/poll_by_event_id', method: 'POST', effect: 'read', body, ...context });
}

export async function queryGeneration(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/lv/v1/effect/genai/task/query', method: 'POST', effect: 'read', body, ...context });
}

export async function submitDraftChanges(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/storyboard/v1/studio_draft/submit_changeset', method: 'POST', effect: 'mutation', body, ...context });
}

export async function fetchDraftVersion(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/storyboard/v1/studio_draft/fetch_latest_version', method: 'POST', effect: 'read', body, ...context });
}

export async function updateCanvasCover(client: HttpOnlyClient, body: unknown, context: CreatorRequestContext) {
  return client.requestJson({ path: '/lv/v2/canvas/cover/update', method: 'POST', effect: 'mutation', body, ...context });
}
