import type { AuthRequestContext } from './authHttp';

export interface PassportClientProfile {
  readonly userAgent: string;
  readonly timezoneName: string;
  readonly browserLanguage: string;
  readonly browserPlatform: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

export interface PassportContextInput {
  readonly webId: string;
  /** Caller-supplied session identifier; this builder does not attest device trust. */
  readonly verifyFp: string;
  readonly profile: PassportClientProfile;
  readonly csrfToken?: string;
  /** Preserve an observed current-session token. No random replacement is generated. */
  readonly msToken?: string;
  readonly region?: { readonly code: string; readonly source: 'cdn' | 'uid' };
}

function requireText(value: unknown, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 8192 || /[\r\n\0]/.test(value)) {
    throw new Error('PASSPORT_CONTEXT_INVALID');
  }
}

/** Assembles one captured Passport profile. It does not generate SDK signatures or launch a client. */
export function createPassportRequestContext(input: PassportContextInput): AuthRequestContext {
  requireText(input.webId);
  requireText(input.verifyFp);
  const profile = input.profile;
  if (!profile) throw new Error('PASSPORT_CONTEXT_INVALID');
  for (const value of [profile.userAgent, profile.timezoneName, profile.browserLanguage, profile.browserPlatform]) requireText(value);
  if (!profile.userAgent.startsWith('Mozilla/') || profile.userAgent.length <= 'Mozilla/'.length ||
      ![profile.screenWidth, profile.screenHeight].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('PASSPORT_CONTEXT_INVALID');
  }
  if (input.csrfToken !== undefined) requireText(input.csrfToken, true);
  if (input.msToken !== undefined) requireText(input.msToken);
  if (input.region) {
    if (!/^[a-zA-Z]{2}$/.test(input.region.code) || !['cdn', 'uid'].includes(input.region.source)) {
      throw new Error('PASSPORT_CONTEXT_INVALID');
    }
  }
  const query: AuthRequestContext['query'] = {
    aid: '348188',
    account_sdk_source: 'web',
    sdk_version: '2.1.10-tiktok',
    language: 'en',
    verifyFp: input.verifyFp,
    timezone_name: profile.timezoneName,
    webid: input.webId,
    browser_language: profile.browserLanguage,
    browser_name: 'Mozilla',
    browser_platform: profile.browserPlatform,
    browser_version: profile.userAgent.slice('Mozilla/'.length),
    cookie_enabled: true,
    screen_height: profile.screenHeight,
    screen_width: profile.screenWidth,
    ...(input.msToken === undefined ? {} : { msToken: input.msToken })
  };
  const headers: AuthRequestContext['headers'] = {
    accept: 'application/json, text/javascript',
    'content-type': 'application/x-www-form-urlencoded',
    appid: '348188',
    did: input.webId,
    origin: 'https://www.capcut.com',
    referer: 'https://www.capcut.com/',
    'user-agent': profile.userAgent,
    'x-tt-passport-csrf-token': input.csrfToken ?? '',
    ...(input.region ? { 'store-country-code': input.region.code, 'store-country-code-src': input.region.source } : {})
  };
  return Object.freeze({ headers: Object.freeze(headers), query: Object.freeze(query) });
}
