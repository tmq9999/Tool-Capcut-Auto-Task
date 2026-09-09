import { describe, expect, it } from 'vitest';
import { parseTrialOffers } from '../trialOffers';

const VIP_KEY = '/commerce/v1/subscription/cc_price_list_vip';
const ULTRA_KEY = '/commerce/v1/subscription/cc_price_list_ultra';

describe('parseTrialOffers', () => {
  it('parses the old data-null serialized response and finds two eligible offers', () => {
    const snapshot = parseTrialOffers({
      ret: '0',
      data: null,
      response: JSON.stringify([
        {
          key: VIP_KEY,
          response: {
            ret: 0,
            data: {
              all_price_list: [
                {
                  product_id: 'must-not-leak',
                  can_trial: true,
                  trial_cycle: 7,
                  trial_cycle_unit: 'DAY',
                  trial_info: { trial_period: 7, trial_cycle_unit: 'DAY', trial_price: 0 }
                },
                {
                  sku_id: 'must-not-leak',
                  can_trial: true,
                  trial_info: { trial_cycle: 7, trial_cycle_unit: 'DAY', trial_price: 0 }
                }
              ]
            }
          }
        }
      ])
    });

    expect(snapshot).toEqual({
      responseSource: 'response',
      entries: [
        {
          key: VIP_KEY,
          scene: 'vip',
          status: 'available',
          code: null,
          eligibility: 'eligible',
          offers: [
            { canTrial: true, trialDays: 7, trialPrice: 0, trialCycleUnit: 'DAY' },
            { canTrial: true, trialDays: 7, trialPrice: 0, trialCycleUnit: 'DAY' }
          ]
        }
      ],
      hasEligibleSevenDayFree: true,
      overallEligibility: 'eligible'
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
  });

  it('matches current Ultra and VIP entries by key instead of response order', () => {
    const snapshot = parseTrialOffers({
      ret: 0,
      is_free_trial: false,
      data: [
        {
          key: ULTRA_KEY,
          response: {
            ret: '0',
            data: {
              all_price_list: [
                { can_trial: false },
                { can_trial: false }
              ]
            }
          }
        },
        {
          key: VIP_KEY,
          response: {
            ret: 0,
            data: {
              all_price_list: [
                { can_trial: false },
                { can_trial: false },
                { can_trial: false },
                { can_trial: false }
              ]
            }
          }
        }
      ]
    });

    expect(snapshot.responseSource).toBe('data');
    expect(snapshot.entries.map(entry => [entry.scene, entry.offers.length])).toEqual([
      ['vip', 4],
      ['ultra', 2]
    ]);
    expect(snapshot.entries[0]?.offers[0]).toEqual({
      canTrial: false,
      trialDays: null,
      trialPrice: null,
      trialCycleUnit: null
    });
    expect(snapshot.entries.map(entry => entry.eligibility)).toEqual(['ineligible', 'ineligible']);
    expect(snapshot.hasEligibleSevenDayFree).toBe(false);
    expect(snapshot.overallEligibility).toBe('ineligible');
  });

  it('retains a nested nonzero response as a safe entry error', () => {
    const snapshot = parseTrialOffers({
      ret: '0',
      data: [
        {
          key: ULTRA_KEY,
          response: {
            ret: 34010101,
            message: 'private upstream details',
            data: { account_id: 'must-not-leak' }
          }
        }
      ]
    });

    expect(snapshot).toEqual({
      responseSource: 'data',
      entries: [
        {
          key: ULTRA_KEY,
          scene: 'ultra',
          status: 'error',
          code: 'TRIAL_ENTRY_RET_34010101',
          eligibility: 'unknown',
          offers: []
        }
      ],
      hasEligibleSevenDayFree: false,
      overallEligibility: 'unknown'
    });
    expect(JSON.stringify(snapshot)).not.toContain('private upstream details');
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
  });

  it('fails closed on malformed serialized response JSON', () => {
    expect(() => parseTrialOffers({ ret: 0, data: null, response: '[{' }))
      .toThrowError('TRIAL_RESPONSE_INVALID_JSON');
  });

  it('fails closed when null data has no serialized response', () => {
    expect(() => parseTrialOffers({ ret: 0, data: null }))
      .toThrowError('TRIAL_RESPONSE_SCHEMA_UNRECOGNIZED');
  });

  it('does not let current trial state override an eligible offer', () => {
    const snapshot = parseTrialOffers({
      ret: 0,
      is_free_trial: false,
      can_free_trial: false,
      can_free_trial_days: 0,
      data: [
        {
          key: VIP_KEY,
          response: {
            ret: 0,
            data: {
              all_price_list: [
                {
                  can_trial: true,
                  trial_info: { trial_period: 7, trial_cycle_unit: 'DAY', trial_price: 0 }
                }
              ]
            }
          }
        }
      ]
    });

    expect(snapshot.hasEligibleSevenDayFree).toBe(true);
    expect(snapshot.overallEligibility).toBe('eligible');
  });

  it.each([0, '0'])('accepts numeric or string zero outer ret: %s', ret => {
    const snapshot = parseTrialOffers({
      ret,
      data: [
        {
          key: VIP_KEY,
          response: { ret: 0, data: { all_price_list: [] } }
        }
      ]
    });

    expect(snapshot).toEqual({
      responseSource: 'data',
      entries: [
        {
          key: VIP_KEY,
          scene: 'vip',
          status: 'available',
          code: null,
          eligibility: 'unknown',
          offers: []
        }
      ],
      hasEligibleSevenDayFree: false,
      overallEligibility: 'unknown'
    });
  });

  it('rejects a nonzero outer ret before considering offer data', () => {
    expect(() => parseTrialOffers({ ret: '1001', data: [] }))
      .toThrowError('TRIAL_OUTER_RET_NONZERO');
  });

  it('rejects malformed outer and nested ret values as schema errors', () => {
    expect(() => parseTrialOffers({ ret: false, data: [] })).toThrowError('TRIAL_OUTER_RET_INVALID');
    expect(() => parseTrialOffers({ ret: {}, data: [] })).toThrowError('TRIAL_OUTER_RET_INVALID');
    expect(() => parseTrialOffers({ ret: 0, data: [{ key: VIP_KEY, response: { ret: true, data: { all_price_list: [] } } }] })).toThrowError('TRIAL_ENTRY_RET_INVALID');
  });

  it('reports unknown when offer evidence is incomplete', () => {
    const snapshot = parseTrialOffers({ ret: 0, data: [{ key: VIP_KEY, response: { ret: 0, data: { all_price_list: [{ can_trial: false }, { trial_info: { trial_period: 7, trial_cycle_unit: 'DAY', trial_price: 0 } }] } } }] });
    expect(snapshot.entries[0]?.eligibility).toBe('unknown');
    expect(snapshot.hasEligibleSevenDayFree).toBe(false);
    expect(snapshot.overallEligibility).toBe('unknown');
  });

  it('normalizes negative trial numbers to unknown', () => {
    const snapshot = parseTrialOffers({ ret: 0, data: [{ key: VIP_KEY, response: { ret: 0, data: { all_price_list: [{ can_trial: true, trial_info: { trial_period: -7, trial_cycle_unit: 'DAY', trial_price: -1 } }] } } }] });
    expect(snapshot.entries[0]?.offers[0]).toEqual({ canTrial: true, trialDays: null, trialPrice: null, trialCycleUnit: 'DAY' });
    expect(snapshot.entries[0]?.eligibility).toBe('unknown');
  });

  it('returns recognized entries in canonical scene order', () => {
    const available = (key: string, canTrial: boolean) => ({
      key,
      response: { ret: 0, data: { all_price_list: [{ can_trial: canTrial }] } }
    });
    const teamsKey = '/commerce/v1/subscription/cc_price_list_teams';
    const snapshot = parseTrialOffers({
      ret: 0,
      data: [available(teamsKey, false), available(ULTRA_KEY, false), available(VIP_KEY, false)]
    });

    expect(snapshot.entries.map(entry => entry.scene)).toEqual(['vip', 'ultra', 'teams']);
  });

  it('deep-freezes the snapshot and all nested arrays and objects', () => {
    const snapshot = parseTrialOffers({
      ret: 0,
      data: [{ key: VIP_KEY, response: { ret: 0, data: { all_price_list: [{ can_trial: false }] } } }]
    });
    const original = JSON.stringify(snapshot);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0]?.offers)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0]?.offers[0])).toBe(true);
    expect(() => (snapshot.entries as unknown[]).push({})).toThrow();
    expect(() => Object.assign(snapshot.entries[0]!, { scene: 'teams' })).toThrow();
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('fails closed on duplicate recognized entry keys', () => {
    const entry = {
      key: VIP_KEY,
      response: { ret: 0, data: { all_price_list: [] } }
    };

    expect(() => parseTrialOffers({ ret: 0, data: [entry, entry] }))
      .toThrowError('TRIAL_ENTRY_DUPLICATE');
  });

  it('fails closed when the response has no recognized entries', () => {
    expect(() => parseTrialOffers({ ret: 0, data: [] }))
      .toThrowError('TRIAL_ENTRY_NONE');

    expect(() => parseTrialOffers({
      ret: 0,
      data: [
        {
          key: '/commerce/v1/subscription/private-account-value',
          response: { ret: 0, data: { all_price_list: [] } }
        }
      ]
    })).toThrowError('TRIAL_ENTRY_KEY_UNRECOGNIZED');

    expect(() => parseTrialOffers({
      ret: 0,
      data: [
        {
          key: 'constructor',
          response: { ret: 0, data: { all_price_list: [] } }
        }
      ]
    })).toThrowError('TRIAL_ENTRY_KEY_UNRECOGNIZED');
  });

  it('fails closed on malformed entry and offer schemas', () => {
    expect(() => parseTrialOffers({
      ret: 0,
      data: [{ key: VIP_KEY, response: { ret: 0, data: { all_price_list: null } } }]
    })).toThrowError('TRIAL_ENTRY_SCHEMA_INVALID');

    expect(() => parseTrialOffers({
      ret: 0,
      data: [{ key: VIP_KEY, response: { ret: 0, data: { all_price_list: ['bad'] } } }]
    })).toThrowError('TRIAL_OFFER_SCHEMA_INVALID');
  });

  it('fails closed on malformed root JSON without echoing its contents', () => {
    let error: unknown;
    try {
      parseTrialOffers('{"token":"must-not-leak"');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('TRIAL_ROOT_INVALID_JSON');
    expect((error as Error).message).not.toContain('must-not-leak');
  });
});
