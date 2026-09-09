import type { HttpJsonClient } from './httpTypes';
import { parseTrialOffers, type TrialOfferSnapshot } from './trialOffers';

export interface TrialOfferReadInput {
  readonly region: string;
  readonly workspaceId?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
}

export interface TrialOfferReadResult {
  readonly snapshot: TrialOfferSnapshot;
  readonly vipEligibility: 'eligible' | 'ineligible' | 'unknown';
}

/** Read-only pricing batch. Neither an absent offer nor a rejected subrequest means account flagging. */
export async function readTrialOffers(
  client: HttpJsonClient,
  input: TrialOfferReadInput,
  signal?: AbortSignal
): Promise<TrialOfferReadResult> {
  signal?.throwIfAborted();
  if (!/^[a-zA-Z]{2}$/.test(input.region) ||
      (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || !input.workspaceId.trim() || /[\r\n\0]/.test(input.workspaceId)))) {
    throw new Error('TRIAL_REQUEST_INVALID');
  }
  const region = input.region.toUpperCase();
  const headers = input.headers === undefined ? undefined : Object.freeze({...input.headers});
  const query = input.query === undefined ? undefined : Object.freeze({...input.query});
  const requestParamList: Array<{path: string; key: string; body: Record<string, string | number>}> = ['vip', 'ultra'].map(scene => ({
    path: '/commerce/v1/subscription/cc_price_list',
    key: `/commerce/v1/subscription/cc_price_list_${scene}`,
    body: { aid: 348188, region, scene }
  }));
  if (input.workspaceId !== undefined) requestParamList.push({
    path: '/commerce/v1/subscription/cc_price_list',
    key: '/commerce/v1/subscription/cc_price_list_teams',
    body: { aid: 348188, region, scene: 'teams', workspace_id: input.workspaceId }
  });
  const response = await client.requestJson<unknown>({
    origin: 'https://commerce-api-sg.capcut.com',
    path: '/commerce/v1/subscription/batch_get',
    method: 'POST',
    effect: 'read',
    headers,
    query,
    body: { data_optimize: true, request_param_list: requestParamList },
    signal
  });
  signal?.throwIfAborted();
  if (!response.ok) throw new Error('TRIAL_HTTP_REJECTED');
  const snapshot = parseTrialOffers(response.data);
  const vip = snapshot.entries.find(entry => entry.scene === 'vip');
  return Object.freeze({ snapshot, vipEligibility: vip?.eligibility ?? 'unknown' });
}
