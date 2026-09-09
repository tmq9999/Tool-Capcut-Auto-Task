import type { HttpStreamClient } from './httpTypes';

export interface CreatorFlowContract {
  projectBody: unknown;
  sendBody: unknown;
  pollBody: unknown;
  confirmBody: unknown;
  context: { headers: Record<string, string>; query: Record<string, string | number | boolean> };
  /** Omit to authorize only a zero-credit generation. */
  maxCredits?: number;
}

export interface CreatorFlowReceipt {
  draftId: string;
  conversationId: string;
  messageRoundId: string;
  confirmationRoundId: string;
  credits: number;
  remainingCredits: number;
  resourceId: string;
  resourceType: string;
}

interface CreatorBody {
  id?: unknown;
  round_id?: unknown;
  conversation_info?: { conversation_id?: unknown };
  option?: Record<string, unknown>;
  [key: string]: unknown;
}

function cloneBody(value: unknown): CreatorBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CREATOR_CONTRACT_INVALID');
  return structuredClone(value) as CreatorBody;
}

function preparedIdentity(body: CreatorBody, kind: 'message' | 'confirmation'): { conversationId: string; roundId: string } {
  const conversationId = body.conversation_info?.conversation_id;
  const roundId = body.round_id;
  if (typeof conversationId !== 'string' || !conversationId || typeof roundId !== 'string' || !roundId || body.id !== roundId) {
    throw new Error('CREATOR_' + kind.toUpperCase() + '_IDENTITY_INVALID');
  }
  return { conversationId, roundId };
}

function assertMutationAccepted(response: { ok: boolean; data: unknown }, operation: string): asserts response is { ok: true; data: { ret: string | number; data?: unknown } } {
  if (!response.ok || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    throw new Error(`CREATOR_${operation}_OUTCOME_UNKNOWN`);
  }
  const ret = (response.data as { ret?: unknown }).ret;
  if (ret === 0 || ret === '0') return;
  if ((typeof ret === 'number' && Number.isFinite(ret)) || (typeof ret === 'string' && /^-?\d+$/.test(ret))) {
    throw new Error(`CREATOR_${operation}_REJECTED`);
  }
  throw new Error(`CREATOR_${operation}_OUTCOME_UNKNOWN`);
}

function parseCreditAmount(value: unknown): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) return value;
    throw new Error('CREATOR_COST_INVALID');
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  throw new Error('CREATOR_COST_INVALID');
}

async function readSseMatch<T>(
  client: HttpStreamClient,
  contract: CreatorFlowContract,
  conversationId: string,
  signal: AbortSignal,
  match: (event: Record<string, unknown>) => T | undefined,
  missingCode: string
): Promise<T> {
  const pollBody = cloneBody(contract.pollBody);
  pollBody.session_id = conversationId;
  pollBody.event_id = '';
  const response = await client.requestStream({
    path: '/storyboard_agent/v1/ai_lab/poll_by_event_id', method: 'POST', effect: 'read', body: pollBody,
    headers: contract.context.headers, query: contract.context.query, signal, deadlineMs: 240_000, maxBytes: 8 * 1024 * 1024
  });
  try {
    if (!response.ok || !response.headers['content-type']?.includes('text/event-stream')) throw new Error('CREATOR_STREAM_REJECTED');
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        let event: unknown;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        const found = match(event as Record<string, unknown>);
        if (found !== undefined) return found;
      }
    }
    throw new Error(missingCode);
  } finally {
    await response.dispose();
  }
}

function eventConversation(event: Record<string, unknown>): unknown {
  return (event.conversation_info as { conversation_id?: unknown } | undefined)?.conversation_id;
}

/** Runs the captured Creator request sequence over HTTP only. */
export async function runCreatorHttpFlow(client: HttpStreamClient, contract: CreatorFlowContract, signal: AbortSignal): Promise<CreatorFlowReceipt> {
  const projectBody = cloneBody(contract.projectBody);
  const sendBody = cloneBody(contract.sendBody);
  const confirmBody = cloneBody(contract.confirmBody);
  cloneBody(contract.pollBody);
  const message = preparedIdentity(sendBody, 'message');
  const confirmation = preparedIdentity(confirmBody, 'confirmation');
  if (confirmation.conversationId !== message.conversationId || confirmation.roundId === message.roundId) throw new Error('CREATOR_CONFIRMATION_IDENTITY_INVALID');
  const maxCredits = contract.maxCredits ?? 0;
  if (!Number.isFinite(maxCredits) || maxCredits < 0) throw new Error('CREATOR_COST_BUDGET_INVALID');

  signal.throwIfAborted();
  const project = await client.requestJson<Record<string, unknown>>({
    path: '/storyboard/v1/studio_draft/create_project', method: 'POST', effect: 'mutation', body: projectBody,
    headers: contract.context.headers, query: contract.context.query, signal
  });
  assertMutationAccepted(project, 'PROJECT');
  const draftId = (project.data.data as { draft_id?: unknown } | undefined)?.draft_id;
  if (typeof draftId !== 'string' || !draftId) throw new Error('CREATOR_DRAFT_ID_MISSING');

  sendBody.option = { ...(sendBody.option ?? {}), __project_id: draftId };
  signal.throwIfAborted();
  const sent = await client.requestJson<Record<string, unknown>>({
    path: '/storyboard_agent/v1/ai_lab/send_msg', method: 'POST', effect: 'mutation', body: sendBody,
    headers: contract.context.headers, query: contract.context.query, signal
  });
  assertMutationAccepted(sent, 'MESSAGE');

  const cost = await readSseMatch(client, contract, message.conversationId, signal, event => {
    if (eventConversation(event) !== message.conversationId || event.round_id !== message.roundId) return undefined;
    const content = event.content as { content_type?: unknown; data?: unknown } | undefined;
    if (content?.content_type !== 'strong_commercial_card' || typeof content.data !== 'string') return undefined;
    let card: unknown;
    try { card = JSON.parse(content.data); } catch { throw new Error('CREATOR_COST_INVALID'); }
    if (!card || typeof card !== 'object' || Array.isArray(card) || (card as { card_type?: unknown }).card_type !== 'confirm') return undefined;
    const credits = parseCreditAmount((card as { need_used_credits?: unknown }).need_used_credits);
    const remainingCredits = parseCreditAmount((card as { remain_credits?: unknown }).remain_credits);
    if (remainingCredits < credits) throw new Error('CREATOR_COST_INVALID');
    return { credits, remainingCredits };
  }, 'CREATOR_COST_EVENT_MISSING');
  if (cost.credits > maxCredits) throw new Error('CREATOR_COST_NOT_AUTHORIZED');

  confirmBody.option = { ...(confirmBody.option ?? {}), __project_id: draftId };
  signal.throwIfAborted();
  const confirmed = await client.requestJson<Record<string, unknown>>({
    path: '/storyboard_agent/v1/ai_lab/send_msg', method: 'POST', effect: 'mutation', body: confirmBody,
    headers: contract.context.headers, query: contract.context.query, signal
  });
  assertMutationAccepted(confirmed, 'CONFIRM');

  const asset = await readSseMatch(client, contract, message.conversationId, signal, event => {
    // Existing export reconciliation binds generated media to the original
    // message round as well as the conversation; event_id cursor semantics are
    // not established and are not used here.
    if (eventConversation(event) !== message.conversationId || event.round_id !== message.roundId ||
      (event.author as { role?: unknown } | undefined)?.role !== 'tool') return undefined;
    const content = event.content as { tool_call_name?: unknown; content_type?: unknown; data?: unknown } | undefined;
    if (content?.tool_call_name !== 'generate_image' || content.content_type !== 'media_list' || typeof content.data !== 'string') return undefined;
    let media: unknown;
    try { media = JSON.parse(content.data); } catch { return undefined; }
    if (!media || typeof media !== 'object' || !Array.isArray((media as { items?: unknown }).items)) return undefined;
    const item = ((media as { items: unknown[] }).items).find(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const candidate = value as { type?: unknown; status?: unknown; resource_id?: unknown; resource_type?: unknown };
      return candidate.type === 'image' && candidate.status === 'succeed' && typeof candidate.resource_id === 'string' &&
        Boolean(candidate.resource_id) && candidate.resource_type === 'tos_key';
    }) as { resource_id: string; resource_type: string } | undefined;
    return item ? { resourceId: item.resource_id, resourceType: item.resource_type } : undefined;
  }, 'CREATOR_GENERATION_EVENT_MISSING');

  return {
    draftId, conversationId: message.conversationId, messageRoundId: message.roundId,
    confirmationRoundId: confirmation.roundId, credits: cost.credits, remainingCredits: cost.remainingCredits,
    resourceId: asset.resourceId, resourceType: asset.resourceType
  };
}
