import { describe, expect, it, vi } from 'vitest';
import { submitInspirationHttp, type InspirationContract } from '../inspiration';

const allowanceBody = {
  item_list: [{ resource_id: 'resource-1', resource_type: 7, benefit_type: 3 }]
};

function contract(overrides: Partial<InspirationContract> = {}): InspirationContract {
  return {
    path: '/lv/v1/common_task/new',
    headers: { 'content-type': 'application/json' },
    query: { aid: 'captured-aid' },
    body: JSON.stringify({
      bind_id: 'captured-bind-id',
      tasks: [{ payload: { template_id: '7611886117142531329' } }]
    }),
    allowance: {
      origin: 'https://commerce-api-sg.capcut.com',
      path: '/commerce/v3/benefits/batch_check_withhold_deduct',
      headers: { 'content-type': 'application/json' },
      query: { aid: 'captured-aid' },
      body: JSON.stringify(allowanceBody)
    },
    ...overrides
  };
}

const freeAllowance = {
  status: 200,
  ok: true,
  data: {
    ret: 0,
    data: {
      status: 1,
      item_list: [{ ...allowanceBody.item_list[0], status: 1, credits_amount: 0, consume_types: ['LimitFree'] }]
    }
  }
};

const acceptedGeneration = {
  status: 200,
  ok: true,
  data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 'queueing' }], failed_tasks: [] } }
};

describe('HTTP Inspiration', () => {
  it('checks the exact free allowance before dispatching one observed generation request', async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce(freeAllowance)
      .mockResolvedValueOnce(acceptedGeneration);

    const result = await submitInspirationHttp({ requestJson }, contract());

    expect(result).toEqual({ status: 200, accepted: true, bodyKeys: ['ret', 'data'], taskId: 'job-1' });
    expect(requestJson.mock.calls).toEqual([
      [{
        origin: 'https://commerce-api-sg.capcut.com',
        path: '/commerce/v3/benefits/batch_check_withhold_deduct',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        query: { aid: 'captured-aid' },
        body: allowanceBody,
        effect: 'read',
        signal: undefined
      }],
      [{
        path: '/lv/v1/common_task/new',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        query: { aid: 'captured-aid' },
        body: { bind_id: 'captured-bind-id', tasks: [{ payload: { template_id: '7611886117142531329' } }] },
        effect: 'mutation',
        signal: undefined
      }]
    ]);
  });

  it.each([
    ['paid', { ...freeAllowance, data: { ret: 0, data: { ...freeAllowance.data.data, item_list: [{ ...freeAllowance.data.data.item_list[0], credits_amount: 1 }] } } }],
    ['malformed', { ...freeAllowance, data: { ret: 0, data: { status: 1, item_list: [] } } }],
    ['foreign', { ...freeAllowance, data: { ret: 0, data: { ...freeAllowance.data.data, item_list: [{ ...freeAllowance.data.data.item_list[0], resource_id: 'foreign' }] } } }],
    ['duplicate', { ...freeAllowance, data: { ret: 0, data: { ...freeAllowance.data.data, item_list: [freeAllowance.data.data.item_list[0], freeAllowance.data.data.item_list[0]] } } }]
  ])('rejects a %s allowance before generation dispatch', async (_name, allowance) => {
    const requestJson = vi.fn().mockResolvedValue(allowance);

    await expect(submitInspirationHttp({ requestJson }, contract())).rejects.toThrow('INSPIRATION_FREE_ALLOWANCE_UNAVAILABLE');

    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('stops after allowance when cancellation occurs before generation', async () => {
    const controller = new AbortController();
    const requestJson = vi.fn().mockImplementation(async () => {
      controller.abort(new Error('stopped'));
      return freeAllowance;
    });

    await expect(submitInspirationHttp({ requestJson }, contract(), controller.signal)).rejects.toThrow('stopped');

    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['bad generation path', contract({ path: '/lv/v1/common_task/new/extra' })],
    ['missing generation template', contract({ body: JSON.stringify({ bind_id: 'x', tasks: [{ payload: {} }] }) })],
    ['wrong generation template', contract({ body: JSON.stringify({ bind_id: 'x', tasks: [{ payload: { template_id: 'other-template' } }] }) })],
    ['multiple generation tasks', contract({ body: JSON.stringify({ bind_id: 'x', tasks: [{ payload: { template_id: 'one' } }, { payload: { template_id: 'two' } }] }) })],
    ['bad allowance origin', contract({ allowance: { ...contract().allowance, origin: 'https://edit-api-sg.capcut.com' } })],
    ['bad allowance path', contract({ allowance: { ...contract().allowance, path: '/commerce/v3/benefits/other' } })],
    ['duplicate requested allowance identity', contract({ allowance: { ...contract().allowance, body: JSON.stringify({ item_list: [allowanceBody.item_list[0], allowanceBody.item_list[0]] }) } })]
  ])('rejects %s without dispatching any request', async (_name, input) => {
    const requestJson = vi.fn();

    await expect(submitInspirationHttp({ requestJson }, input)).rejects.toThrow('INSPIRATION_CONTRACT_INVALID');

    expect(requestJson).not.toHaveBeenCalled();
  });

  it.each(['queueing', 'processing', 'success', 'succeed'])('accepts the captured generation status %s', async (status) => {
    const requestJson = vi.fn().mockResolvedValueOnce(freeAllowance).mockResolvedValueOnce({
      ...acceptedGeneration,
      data: { ret: 0, data: { tasks: [{ id: 'job-1', status }], failed_tasks: [] } }
    });

    await expect(submitInspirationHttp({ requestJson }, contract())).resolves.toMatchObject({ accepted: true, taskId: 'job-1' });
  });

  it.each([
    ['numeric status 1', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 1 }], failed_tasks: [] } } }],
    ['unknown string status', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 'ready' }], failed_tasks: [] } } }],
    ['multiple jobs', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 'queueing' }, { id: 'job-2', status: 'queueing' }], failed_tasks: [] } } }],
    ['missing failed_tasks', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 'queueing' }] } } }],
    ['HTTP 502', { ...acceptedGeneration, status: 502, ok: false }],
    ['mixed accepted and failed tasks', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [{ id: 'job-1', status: 'queueing' }], failed_tasks: [{ id: 'failed' }] } } }]
  ])('marks malformed generation response with %s as outcome unknown', async (_name, generation) => {
    const requestJson = vi.fn().mockResolvedValueOnce(freeAllowance).mockResolvedValueOnce(generation);

    await expect(submitInspirationHttp({ requestJson }, contract())).rejects.toThrow('INSPIRATION_HTTP_OUTCOME_UNKNOWN');
  });

  it.each([
    ['nonzero ret without an accepted task', { ...acceptedGeneration, data: { ret: 1, data: { tasks: [], failed_tasks: [{ id: 'failed' }] } } }],
    ['failed task without an accepted task', { ...acceptedGeneration, data: { ret: 0, data: { tasks: [], failed_tasks: [{ id: 'failed' }] } } }]
  ])('definitively rejects generation response with %s', async (_name, generation) => {
    const requestJson = vi.fn().mockResolvedValueOnce(freeAllowance).mockResolvedValueOnce(generation);

    await expect(submitInspirationHttp({ requestJson }, contract())).rejects.toThrow('INSPIRATION_HTTP_REJECTED');
  });

  it('does not retry an unknown mutation outcome', async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce(freeAllowance)
      .mockRejectedValueOnce(new Error('CAPCUT_HTTP_OUTCOME_UNKNOWN'));

    await expect(submitInspirationHttp({ requestJson }, contract())).rejects.toThrow('CAPCUT_HTTP_OUTCOME_UNKNOWN');

    expect(requestJson).toHaveBeenCalledTimes(2);
  });
});
