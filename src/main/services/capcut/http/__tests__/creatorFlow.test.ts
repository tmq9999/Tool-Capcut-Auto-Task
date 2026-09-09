import { describe, expect, it, vi } from 'vitest';
import { runCreatorHttpFlow, type CreatorFlowContract } from '../creatorFlow';

function sse(events: unknown[]) {
  const body = async function* () {
    yield Buffer.from(events.map(event => `data:${JSON.stringify(event)}\n`).join(''));
  };
  return { status: 200, ok: true, headers: { 'content-type': 'text/event-stream' }, body: body(), dispose: vi.fn() };
}

function contract(overrides: Partial<CreatorFlowContract> = {}): CreatorFlowContract {
  return {
    projectBody: { draft_content: '{}' },
    sendBody: {
      id: 'message-1', round_id: 'message-1', conversation_info: { conversation_id: 'conversation-1' },
      option: { __project_id: 'prepared-placeholder' }
    },
    pollBody: { session_id: 'prepared-placeholder', event_id: 'prepared-event' },
    confirmBody: {
      id: 'confirm-1', round_id: 'confirm-1', conversation_info: { conversation_id: 'conversation-1' },
      option: { __project_id: 'prepared-placeholder' }, content: { data: '{"credits_confirm":true}' }
    },
    context: { headers: { appid: 'captured' }, query: { aid: 'captured' } },
    maxCredits: 60,
    ...overrides
  };
}

const estimate = {
  round_id: 'message-1', conversation_info: { conversation_id: 'conversation-1' },
  content: { content_type: 'strong_commercial_card', data: JSON.stringify({ card_type: 'confirm', need_used_credits: 53, remain_credits: 442 }) }
};

const generated = {
  round_id: 'message-1', conversation_info: { conversation_id: 'conversation-1' }, author: { role: 'tool' },
  content: { tool_call_name: 'generate_image', content_type: 'media_list', data: JSON.stringify({ items: [{ type: 'image', status: 'succeed', resource_id: 'asset-1', resource_type: 'tos_key' }] }) }
};

function client(options: { estimate?: unknown[]; generated?: unknown[]; json?: unknown[] } = {}) {
  const json = options.json ?? [
    { status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } },
    { status: 200, ok: true, data: { ret: 0 } },
    { status: 200, ok: true, data: { ret: 0 } }
  ];
  return {
    requestJson: vi.fn().mockImplementation(async () => json.shift()),
    requestStream: vi.fn().mockResolvedValueOnce(sse(options.estimate ?? [estimate])).mockResolvedValueOnce(sse(options.generated ?? [generated]))
  };
}

describe('HTTP-only Creator flow', () => {
  it('creates, sends, gates cost, confirms, then obtains a conversation-bound image from SSE', async () => {
    const http = client();
    const result = await runCreatorHttpFlow(http as never, contract(), new AbortController().signal);
    expect(result).toEqual({ draftId: 'draft-live', conversationId: 'conversation-1', messageRoundId: 'message-1', confirmationRoundId: 'confirm-1', credits: 53, remainingCredits: 442, resourceId: 'asset-1', resourceType: 'tos_key' });
    expect(http.requestJson.mock.calls.map(([request]) => request.path)).toEqual(['/storyboard/v1/studio_draft/create_project', '/storyboard_agent/v1/ai_lab/send_msg', '/storyboard_agent/v1/ai_lab/send_msg']);
    expect(http.requestJson.mock.calls[1][0].body).toMatchObject({ option: { __project_id: 'draft-live' } });
    expect(http.requestJson.mock.calls[2][0].body).toMatchObject({ option: { __project_id: 'draft-live' } });
    expect(http.requestStream.mock.calls).toHaveLength(2);
    expect(http.requestStream.mock.calls[0][0]).toMatchObject({ path: '/storyboard_agent/v1/ai_lab/poll_by_event_id', method: 'POST', effect: 'read', body: { session_id: 'conversation-1', event_id: '' } });
  });

  it('defaults to a zero-credit budget when no paid budget is supplied', async () => {
    const http = client();
    await expect(runCreatorHttpFlow(http as never, contract({ maxCredits: undefined }), new AbortController().signal)).rejects.toThrow('CREATOR_COST_NOT_AUTHORIZED');
    expect(http.requestJson).toHaveBeenCalledTimes(2);
    expect(http.requestStream).toHaveBeenCalledTimes(1);
  });

  it('permits a zero-credit confirmation without a paid budget', async () => {
    const free = { ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: 0, remain_credits: 0 }) } };
    const http = client({ estimate: [free] });
    await expect(runCreatorHttpFlow(http as never, contract({ maxCredits: undefined }), new AbortController().signal)).resolves.toMatchObject({ credits: 0 });
  });

  it.each([
    ['project rejection', [{ status: 200, ok: true, data: { ret: 1 } }], 'CREATOR_PROJECT_REJECTED', 1],
    ['missing draft id', [{ status: 200, ok: true, data: { ret: 0, data: {} } }], 'CREATOR_DRAFT_ID_MISSING', 1],
    ['message rejection', [{ status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }, { status: 200, ok: true, data: { ret: 1 } }], 'CREATOR_MESSAGE_REJECTED', 2]
  ])('stops writes after %s', async (_name, json, error, calls) => {
    const http = client({ json });
    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow(error);
    expect(http.requestJson).toHaveBeenCalledTimes(calls);
    expect(http.requestStream).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign conversation', [{ ...estimate, conversation_info: { conversation_id: 'foreign' } }]],
    ['foreign round', [{ ...estimate, round_id: 'foreign' }]],
    ['malformed cost', [{ ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: 'unknown', remain_credits: 442 }) } }]],
    ['insufficient remaining credits', [{ ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: 53, remain_credits: 10 }) } }]]
  ])('does not confirm after %s estimate evidence', async (_name, events) => {
    const http = client({ estimate: events });
    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow();
    expect(http.requestJson).toHaveBeenCalledTimes(2);
    expect(http.requestStream).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', '   ', false, [], {}])('rejects coercion-prone cost value %j before confirmation', async (value) => {
    const bad = { ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: value, remain_credits: 442 }) } };
    const http = client({ estimate: [bad] });

    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow('CREATOR_COST_INVALID');

    expect(http.requestJson).toHaveBeenCalledTimes(2);
  });

  it.each([null, '', '   ', false, [], {}])('rejects coercion-prone remaining-credit value %j before confirmation', async (value) => {
    const bad = { ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: 0, remain_credits: value }) } };
    const http = client({ estimate: [bad] });

    await expect(runCreatorHttpFlow(http as never, contract({ maxCredits: undefined }), new AbortController().signal)).rejects.toThrow('CREATOR_COST_INVALID');

    expect(http.requestJson).toHaveBeenCalledTimes(2);
  });

  it('accepts a nonempty numeric string cost shape', async () => {
    const stringCost = { ...estimate, content: { ...estimate.content, data: JSON.stringify({ card_type: 'confirm', need_used_credits: '53', remain_credits: '442' }) } };
    const http = client({ estimate: [stringCost] });

    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).resolves.toMatchObject({ credits: 53, remainingCredits: 442 });
  });

  it('rejects reuse of the message mutation id for confirmation before dispatch', async () => {
    const input = contract();
    input.confirmBody = { ...(input.confirmBody as object), id: 'message-1', round_id: 'message-1' };
    const http = client();

    await expect(runCreatorHttpFlow(http as never, input, new AbortController().signal)).rejects.toThrow('CREATOR_CONFIRMATION_IDENTITY_INVALID');

    expect(http.requestJson).not.toHaveBeenCalled();
  });

  it.each([
    ['project HTTP failure', [{ status: 502, ok: false, data: { ret: 0 } }], 'CREATOR_PROJECT_OUTCOME_UNKNOWN', 1],
    ['project malformed ret', [{ status: 200, ok: true, data: {} }], 'CREATOR_PROJECT_OUTCOME_UNKNOWN', 1],
    ['message HTTP failure', [{ status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }, { status: 502, ok: false, data: { ret: 0 } }], 'CREATOR_MESSAGE_OUTCOME_UNKNOWN', 2],
    ['message malformed ret', [{ status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }, { status: 200, ok: true, data: {} }], 'CREATOR_MESSAGE_OUTCOME_UNKNOWN', 2]
  ])('classifies %s without continuing', async (_name, json, error, calls) => {
    const http = client({ json });

    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow(error);

    expect(http.requestJson).toHaveBeenCalledTimes(calls);
  });

  it('does not poll generation after confirmation rejection', async () => {
    const http = client({ json: [{ status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }, { status: 200, ok: true, data: { ret: 0 } }, { status: 200, ok: true, data: { ret: 1 } }] });
    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow('CREATOR_CONFIRM_REJECTED');
    expect(http.requestStream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['confirmation HTTP failure', { status: 502, ok: false, data: { ret: 0 } }],
    ['confirmation malformed ret', { status: 200, ok: true, data: {} }]
  ])('classifies %s as outcome unknown and does not poll generation', async (_name, confirmation) => {
    const http = client({ json: [{ status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }, { status: 200, ok: true, data: { ret: 0 } }, confirmation] });

    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow('CREATOR_CONFIRM_OUTCOME_UNKNOWN');

    expect(http.requestStream).toHaveBeenCalledTimes(1);
  });

  it('rejects a generated image from another conversation', async () => {
    const http = client({ generated: [{ ...generated, conversation_info: { conversation_id: 'foreign' } }] });
    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow('CREATOR_GENERATION_EVENT_MISSING');
  });

  it('rejects a same-conversation generated image from a stale round', async () => {
    const http = client({ generated: [{ ...generated, round_id: 'stale-message' }] });

    await expect(runCreatorHttpFlow(http as never, contract(), new AbortController().signal)).rejects.toThrow('CREATOR_GENERATION_EVENT_MISSING');
  });

  it('aborts before the next write', async () => {
    const controller = new AbortController();
    const http = client();
    http.requestJson.mockImplementationOnce(async () => { controller.abort(new Error('stopped')); return { status: 200, ok: true, data: { ret: 0, data: { draft_id: 'draft-live' } } }; });
    await expect(runCreatorHttpFlow(http as never, contract(), controller.signal)).rejects.toThrow('stopped');
    expect(http.requestJson).toHaveBeenCalledTimes(1);
  });
});
