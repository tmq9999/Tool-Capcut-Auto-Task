import { describe, expect, it } from 'vitest';
import { createPassportRequestContext } from '../passportContext';

const profile = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  timezoneName: 'Asia/Bangkok',
  browserLanguage: 'en-US',
  browserPlatform: 'Win32',
  screenWidth: 1920,
  screenHeight: 1080
};

describe('passport request context contract', () => {
  it('builds captured metadata from one profile without confusing appVersion with User-Agent', () => {
    const context = createPassportRequestContext({
      webId: 'fresh-web-id', verifyFp: 'verify_test-session', csrfToken: 'fresh-csrf', profile
    });
    expect(context.query).toEqual({
      aid: '348188', account_sdk_source: 'web', sdk_version: '2.1.10-tiktok', language: 'en',
      verifyFp: 'verify_test-session', timezone_name: 'Asia/Bangkok', webid: 'fresh-web-id',
      browser_language: 'en-US', browser_name: 'Mozilla', browser_platform: 'Win32',
      browser_version: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      cookie_enabled: true, screen_height: 1080, screen_width: 1920
    });
    expect(context.headers.did).toBe('fresh-web-id');
    expect(context.headers['user-agent']).toBe(profile.userAgent);
    expect(context.headers['x-tt-passport-csrf-token']).toBe('fresh-csrf');
    expect(context.headers.cookie).toBeUndefined();
  });

  it('preserves supplied current-session values byte-for-byte without fabricating signatures', () => {
    const context = createPassportRequestContext({
      webId: 'fresh-web-id', verifyFp: 'verify_test-session', csrfToken: 'fresh-csrf', profile,
      msToken: 'server-token+/==', region: { code: 'vn', source: 'uid' }
    });
    expect(context.query.msToken).toBe('server-token+/==');
    expect(context.query['X-Bogus']).toBeUndefined();
    expect(context.query['X-Gnarly']).toBeUndefined();
    expect(context.headers.sign).toBeUndefined();
    expect(context.headers['store-country-code']).toBe('vn');
    expect(context.headers['store-country-code-src']).toBe('uid');
    const encoded = new URLSearchParams(Object.entries(context.query).map(([k, v]) => [k, String(v)]));
    expect(new URLSearchParams(encoded.toString()).get('msToken')).toBe('server-token+/==');
  });

  it('omits absent optional tokens instead of using random defaults', () => {
    const context = createPassportRequestContext({webId: 'fresh-web-id', verifyFp: 'verify_test-session', profile});
    expect(context.query).not.toHaveProperty('msToken');
    expect(context.headers['x-tt-passport-csrf-token']).toBe('');
    expect(context.query).not.toHaveProperty('mix_mode');
    expect(context.headers).not.toHaveProperty('store-country-code');
  });

  it('takes an immutable snapshot of profile and region without cross-account sharing', () => {
    const mutable = {...profile};
    const first = createPassportRequestContext({webId: 'a', verifyFp: 'verify_a', profile: mutable});
    mutable.browserLanguage = 'vi-VN';
    const second = createPassportRequestContext({webId: 'b', verifyFp: 'verify_b', profile: mutable});
    expect(first.query.webid).toBe('a');
    expect(first.query.browser_language).toBe('en-US');
    expect(second.query.webid).toBe('b');
    expect(second.query.browser_language).toBe('vi-VN');
    expect(Object.isFrozen(first.headers)).toBe(true);
    expect(Object.isFrozen(first.query)).toBe(true);
  });

  it.each([
    {webId: ''}, {verifyFp: ''}, {csrfToken: 'token\r\ninjected: true'},
    {msToken: 'token\n'}, {profile: {...profile, screenWidth: 0}},
    {profile: {...profile, screenHeight: Number.NaN}},
    {profile: {...profile, userAgent: 'AutoManager/2.4.1'}},
    {profile: {...profile, browserLanguage: 'en\n'}},
    {region: {code: 'vn\r', source: 'uid' as const}}
  ])('rejects incomplete or unsafe profile input without exposing its values %#', overrides => {
    expect(() => createPassportRequestContext({webId: 'a', verifyFp: 'verify_a', profile, ...overrides}))
      .toThrow('PASSPORT_CONTEXT_INVALID');
  });
});
