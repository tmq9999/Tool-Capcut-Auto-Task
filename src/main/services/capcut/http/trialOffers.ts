export type TrialScene = 'vip' | 'ultra' | 'teams';
export type TrialResponseSource = 'response' | 'data';
export type TrialEligibility = 'eligible' | 'ineligible' | 'unknown';
export type TrialOfferKey =
  | '/commerce/v1/subscription/cc_price_list_vip'
  | '/commerce/v1/subscription/cc_price_list_ultra'
  | '/commerce/v1/subscription/cc_price_list_teams';

export interface TrialOffer {
  readonly canTrial: boolean | 'unknown';
  readonly trialDays: number | null;
  readonly trialPrice: number | null;
  readonly trialCycleUnit: string | null;
}

export type TrialOfferEntry =
  | {
      readonly key: TrialOfferKey;
      readonly scene: TrialScene;
      readonly status: 'available';
      readonly code: null;
      readonly eligibility: TrialEligibility;
      readonly offers: readonly TrialOffer[];
    }
  | {
      readonly key: TrialOfferKey;
      readonly scene: TrialScene;
      readonly status: 'error';
      readonly code: `TRIAL_ENTRY_RET_${number}` | 'TRIAL_ENTRY_RET_NONZERO';
      readonly eligibility: 'unknown';
      readonly offers: readonly [];
    };

export interface TrialOfferSnapshot {
  readonly responseSource: TrialResponseSource;
  readonly entries: readonly TrialOfferEntry[];
  readonly hasEligibleSevenDayFree: boolean;
  readonly overallEligibility: TrialEligibility;
}

const SCENE_BY_KEY = {
  '/commerce/v1/subscription/cc_price_list_vip': 'vip',
  '/commerce/v1/subscription/cc_price_list_ultra': 'ultra',
  '/commerce/v1/subscription/cc_price_list_teams': 'teams'
} as const satisfies Record<TrialOfferKey, TrialScene>;
const SCENE_ORDER: Readonly<Record<TrialScene, number>> = Object.freeze({ vip: 0, ultra: 1, teams: 2 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRet(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isInteger(value)) ||
    (typeof value === 'string' && /^-?\d+$/.test(value));
}

function isZeroRet(value: unknown): boolean {
  return isRet(value) && Number(value) === 0;
}

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function safeEntryRetCode(value: number | string): `TRIAL_ENTRY_RET_${number}` | 'TRIAL_ENTRY_RET_NONZERO' {
  const text = String(value);
  return /^\d{1,10}$/.test(text)
    ? `TRIAL_ENTRY_RET_${Number(text)}`
    : 'TRIAL_ENTRY_RET_NONZERO';
}

function parseOffer(value: unknown): TrialOffer {
  if (!isRecord(value)) throw new Error('TRIAL_OFFER_SCHEMA_INVALID');

  const trialInfoValue = value.trial_info;
  if (trialInfoValue !== undefined && trialInfoValue !== null && !isRecord(trialInfoValue)) {
    throw new Error('TRIAL_OFFER_SCHEMA_INVALID');
  }
  const trialInfo = isRecord(trialInfoValue) ? trialInfoValue : undefined;
  const trialDays = optionalNumber(
    trialInfo?.trial_period ?? trialInfo?.trial_cycle ?? value.trial_cycle
  );
  const trialCycleUnit = optionalString(
    trialInfo?.trial_cycle_unit ?? value.trial_cycle_unit
  );

  return Object.freeze({
    canTrial: typeof value.can_trial === 'boolean' ? value.can_trial : 'unknown',
    trialDays,
    trialPrice: optionalNumber(trialInfo?.trial_price),
    trialCycleUnit
  });
}

function parseEntry(value: unknown): TrialOfferEntry {
  if (!isRecord(value) || typeof value.key !== 'string' || !isRecord(value.response)) {
    throw new Error('TRIAL_ENTRY_SCHEMA_INVALID');
  }

  if (!Object.hasOwn(SCENE_BY_KEY, value.key)) throw new Error('TRIAL_ENTRY_KEY_UNRECOGNIZED');
  const key = value.key as TrialOfferKey;
  const scene = SCENE_BY_KEY[key];
  if (!Object.hasOwn(value.response, 'ret') || !isRet(value.response.ret)) throw new Error('TRIAL_ENTRY_RET_INVALID');

  if (!isZeroRet(value.response.ret)) {
    return Object.freeze({
      key,
      scene,
      status: 'error',
      code: safeEntryRetCode(value.response.ret),
      eligibility: 'unknown',
      offers: Object.freeze([] as const)
    });
  }

  if (!isRecord(value.response.data) || !Array.isArray(value.response.data.all_price_list)) {
    throw new Error('TRIAL_ENTRY_SCHEMA_INVALID');
  }

  const offers = Object.freeze(value.response.data.all_price_list.map(parseOffer));
  const eligible = offers.some(offer =>
    offer.canTrial === true && offer.trialDays !== null && offer.trialDays >= 7 &&
    offer.trialCycleUnit === 'DAY' && offer.trialPrice === 0
  );
  const ineligible = offers.length > 0 && offers.every(offer => offer.canTrial === false);
  return Object.freeze({
    key,
    scene,
    status: 'available',
    code: null,
    eligibility: eligible ? 'eligible' : ineligible ? 'ineligible' : 'unknown',
    offers
  });
}

export function parseTrialOffers(input: unknown): TrialOfferSnapshot {
  const root = typeof input === 'string'
    ? parseJson(input, 'TRIAL_ROOT_INVALID_JSON')
    : input;
  if (!isRecord(root)) throw new Error('TRIAL_ROOT_SCHEMA_INVALID');
  if (!isRet(root.ret)) throw new Error('TRIAL_OUTER_RET_INVALID');
  if (!isZeroRet(root.ret)) throw new Error('TRIAL_OUTER_RET_NONZERO');

  let responseSource: TrialResponseSource;
  let entryValues: unknown;
  if (typeof root.response === 'string') {
    responseSource = 'response';
    entryValues = parseJson(root.response, 'TRIAL_RESPONSE_INVALID_JSON');
  } else if (Array.isArray(root.data)) {
    responseSource = 'data';
    entryValues = root.data;
  } else {
    throw new Error('TRIAL_RESPONSE_SCHEMA_UNRECOGNIZED');
  }

  if (!Array.isArray(entryValues)) throw new Error('TRIAL_RESPONSE_SCHEMA_UNRECOGNIZED');
  if (entryValues.length === 0) throw new Error('TRIAL_ENTRY_NONE');

  const entries: TrialOfferEntry[] = [];
  const seen = new Set<string>();
  for (const entryValue of entryValues) {
    if (!isRecord(entryValue) || typeof entryValue.key !== 'string') {
      throw new Error('TRIAL_ENTRY_SCHEMA_INVALID');
    }
    if (seen.has(entryValue.key)) throw new Error('TRIAL_ENTRY_DUPLICATE');
    seen.add(entryValue.key);
    entries.push(parseEntry(entryValue));
  }

  entries.sort((a, b) => SCENE_ORDER[a.scene] - SCENE_ORDER[b.scene]);
  const frozenEntries = Object.freeze(entries);
  const hasEligibleSevenDayFree = entries.some(entry => entry.eligibility === 'eligible');
  const overallEligibility: TrialEligibility = hasEligibleSevenDayFree
    ? 'eligible'
    : entries.some(entry => entry.eligibility === 'unknown')
      ? 'unknown'
      : 'ineligible';

  return Object.freeze({
    responseSource,
    entries: frozenEntries,
    hasEligibleSevenDayFree,
    overallEligibility
  });
}
