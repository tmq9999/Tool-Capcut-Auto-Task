import { describe, expect, it, vi } from 'vitest';
import { readTrialOffers } from '../trialApi';
import type { HttpJsonClient } from '../httpTypes';

const envelope = {
  ret: '0', data: null, response: JSON.stringify([
    { key: '/commerce/v1/subscription/cc_price_list_ultra', response: { ret: '0', data: { all_price_list: [{ can_trial: false }] } } },
    { key: '/commerce/v1/subscription/cc_price_list_vip', response: { ret: '0', data: { all_price_list: [
      { can_trial: true, trial_info: { trial_period: 7, trial_cycle_unit: 'DAY', trial_price: 0 } }
    ] } } }
  ])
};

describe('read-only CapCut offer API', () => {
  it('snapshots caller headers and query before awaiting the client and freezes only owned output', async () => {
    let releaseRequest!: () => void;
    const pendingRequest = new Promise<void>(resolve => { releaseRequest = resolve; });
    let capturedRequest: Parameters<HttpJsonClient['requestJson']>[0] | undefined;
    const client = {
      async requestJson(request: Parameters<HttpJsonClient['requestJson']>[0]) {
        capturedRequest = request;
        await pendingRequest;
        return { status: 200, ok: true, data: envelope };
      }
    } as HttpJsonClient;
    const headers = { appid: '348188', locale: 'en-US' };
    const query = { msToken: 'original-token', workspace: 7, enabled: true };

    const resultPromise = readTrialOffers(client, { region: 'VN', headers, query });
    headers.appid = 'mutated';
    headers.locale = 'th-TH';
    query.msToken = 'mutated-token';
    query.workspace = 9;
    query.enabled = false;

    expect(capturedRequest?.headers).toEqual({ appid: '348188', locale: 'en-US' });
    expect(capturedRequest?.query).toEqual({ msToken: 'original-token', workspace: 7, enabled: true });
    expect(capturedRequest?.headers).not.toBe(headers);
    expect(capturedRequest?.query).not.toBe(query);
    expect(Object.isFrozen(capturedRequest?.headers)).toBe(true);
    expect(Object.isFrozen(capturedRequest?.query)).toBe(true);
    expect(Object.isFrozen(headers)).toBe(false);
    expect(Object.isFrozen(query)).toBe(false);

    releaseRequest();
    const result = await resultPromise;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(result.vipEligibility).toBe('eligible');
  });

  it('sends the captured batch body and reads VIP by key, not return order', async () => {
    const requestJson = vi.fn(async (_request: Parameters<HttpJsonClient['requestJson']>[0]) => ({ status: 200, ok: true, data: envelope }));
    const signal = new AbortController().signal;
    const result = await readTrialOffers({requestJson} as HttpJsonClient, {
      region: 'VN', headers: { appid: '348188' }, query: { msToken: 'current-session-token' }
    }, signal);
    expect(requestJson).toHaveBeenCalledExactlyOnceWith({
      origin: 'https://commerce-api-sg.capcut.com', path: '/commerce/v1/subscription/batch_get', method: 'POST', effect: 'read',
      headers: { appid: '348188' }, query: { msToken: 'current-session-token' }, signal,
      body: { data_optimize: true, request_param_list: [
        { path: '/commerce/v1/subscription/cc_price_list', key: '/commerce/v1/subscription/cc_price_list_vip', body: { aid: 348188, region: 'VN', scene: 'vip' } },
        { path: '/commerce/v1/subscription/cc_price_list', key: '/commerce/v1/subscription/cc_price_list_ultra', body: { aid: 348188, region: 'VN', scene: 'ultra' } }
      ] }
    });
    expect(result.vipEligibility).toBe('eligible');
    expect(result.snapshot.responseSource).toBe('response');
  });

  it('includes teams only when a current workspace ID was supplied', async () => {
    const requestJson = vi.fn(async (_request: Parameters<HttpJsonClient['requestJson']>[0]) => ({ status: 200, ok: true, data: envelope }));
    await readTrialOffers({requestJson} as HttpJsonClient, {region:'vn',workspaceId:'current-workspace'});
    expect(requestJson.mock.calls[0]?.[0]).toMatchObject({body:{request_param_list:[
      {body:{scene:'vip',region:'VN'}},{body:{scene:'ultra',region:'VN'}},
      {key:'/commerce/v1/subscription/cc_price_list_teams',body:{scene:'teams',workspace_id:'current-workspace'}}
    ]}});
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('reports unknown instead of no-trial when the VIP response is missing or rejected', async () => {
    for (const entries of [
      [{key:'/commerce/v1/subscription/cc_price_list_ultra',response:{ret:'0',data:{all_price_list:[]}}}],
      [{key:'/commerce/v1/subscription/cc_price_list_vip',response:{ret:'34010101'}}]
    ]) {
      const client = {requestJson:async()=>({status:200,ok:true,data:{ret:0,data:entries}})} as HttpJsonClient;
      expect((await readTrialOffers(client,{region:'VN'})).vipEligibility).toBe('unknown');
    }
  });

  it('does not retry HTTP failure or dispatch when input/cancellation is invalid', async () => {
    const requestJson=vi.fn(async()=>({status:503,ok:false,data:{}}));
    await expect(readTrialOffers({requestJson} as HttpJsonClient,{region:'VN'})).rejects.toThrow('TRIAL_HTTP_REJECTED');
    expect(requestJson).toHaveBeenCalledTimes(1);
    requestJson.mockClear();
    await expect(readTrialOffers({requestJson} as HttpJsonClient,{region:'VN\r'})).rejects.toThrow('TRIAL_REQUEST_INVALID');
    await expect(readTrialOffers({requestJson} as HttpJsonClient,{region:'VN',workspaceId:''})).rejects.toThrow('TRIAL_REQUEST_INVALID');
    await expect(readTrialOffers({requestJson} as HttpJsonClient,{region:'VN'},AbortSignal.abort())).rejects.toThrow();
    expect(requestJson).not.toHaveBeenCalled();
  });
});
