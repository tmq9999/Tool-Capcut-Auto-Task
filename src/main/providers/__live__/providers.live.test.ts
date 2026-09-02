import { describe, it, expect } from 'vitest';
import { FetchHttpClient } from '../HttpClient';
import { MultiloginProvider } from '../MultiloginProvider';
import { KiotProxyProvider } from '../KiotProxyProvider';
import { Gmail94Provider } from '../Gmail94Provider';
import { DongVanFBProvider } from '../DongVanFBProvider';
import { isFlagOn, mask, readEnv, report, skipNotice } from './liveEnv';

/**
 * Live provider verification. Run with: npm run verify:providers
 * Excluded from the default test run, so the normal suite never touches the
 * network. Each vendor skips itself when its credential is absent, and every
 * paid or side-effecting call sits behind its own VERIFY_* flag.
 */
const http = new FetchHttpClient();

describe('Multilogin (live)', () => {
  const email = readEnv('MULTILOGIN_EMAIL');
  const password = readEnv('MULTILOGIN_PASSWORD');
  const accessToken = readEnv('MULTILOGIN_ACCESS_TOKEN');
  const refreshToken = readEnv('MULTILOGIN_REFRESH_TOKEN');
  const automationToken = readEnv('MULTILOGIN_AUTOMATION_TOKEN');

  const hasCredentials =
    Boolean(email && password) ||
    Boolean(accessToken) ||
    Boolean(email && refreshToken) ||
    Boolean(automationToken);

  /**
   * Resolves a bearer token from whichever credential path is filled in, and
   * exercises that path so the run actually proves those credentials work.
   */
  async function resolveToken(provider: MultiloginProvider): Promise<string> {
    if (email && password) {
      const tokens = await provider.signIn(email, password);
      expect(tokens.token.length).toBeGreaterThan(0);
      expect(tokens.refreshToken.length).toBeGreaterThan(0);
      report('Multilogin auth', 'signin OK, jwt ' + mask(tokens.token) + ', refresh ' + mask(tokens.refreshToken));
      return tokens.token;
    }

    if (email && refreshToken) {
      const rotated = await provider.refreshTokens(email, refreshToken);
      expect(rotated.token.length).toBeGreaterThan(0);
      report('Multilogin auth', 'refresh OK, jwt mới ' + mask(rotated.token) + ', refresh mới ' + mask(rotated.refreshToken));
      return rotated.token;
    }

    if (accessToken) {
      report('Multilogin auth', 'dùng access token có sẵn ' + mask(accessToken));
      return accessToken;
    }

    report('Multilogin auth', 'dùng automation token ' + mask(automationToken as string));
    return automationToken as string;
  }

  it.skipIf(!hasCredentials)('authenticates and reads the workspace', async () => {
    const provider = new MultiloginProvider(http);

    const token = await resolveToken(provider);

    const folders = await provider.listWorkspaceFolders(token);
    report('Multilogin folders', String(folders.length));
    expect(Array.isArray(folders)).toBe(true);
  }, 60_000);

  it.skipIf(!hasCredentials)('reports whether the local launcher agent is reachable', async () => {
    const provider = new MultiloginProvider(http);
    try {
      const version = await provider.getLauncherVersion();
      report('Multilogin launcher', 'v' + version);
      expect(version.length).toBeGreaterThan(0);
    } catch {
      report('Multilogin launcher', 'KHÔNG kết nối được cổng 45001 (hãy mở app Multilogin nếu muốn chạy browser)');
    }
  }, 60_000);

  it.skipIf(!hasCredentials || !isFlagOn('VERIFY_MULTILOGIN_LAUNCH'))(
    'starts a quick profile and stops it again',
    async () => {
      const provider = new MultiloginProvider(http);
      const token = await resolveToken(provider);

      const profile = await provider.startQuickProfile(token, { isHeadless: true });
      report('Multilogin quick profile', profile.profileId + ' port ' + profile.port);
      expect(profile.profileId.length).toBeGreaterThan(0);

      await provider.stopProfile(token, profile.profileId);
      report('Multilogin quick profile', 'đã dừng');
    },
    120_000
  );

  it.runIf(!hasCredentials)('is skipped without credentials', () => {
    skipNotice(
      'Multilogin',
      'MULTILOGIN_EMAIL + MULTILOGIN_PASSWORD, hoặc MULTILOGIN_EMAIL + MULTILOGIN_REFRESH_TOKEN, hoặc MULTILOGIN_AUTOMATION_TOKEN'
    );
    expect(hasCredentials).toBe(false);
  });
});

describe('KiotProxy (live)', () => {
  const apiToken = readEnv('KIOTPROXY_API_TOKEN');

  it.skipIf(!apiToken)('reads the account and its proxy keys', async () => {
    const provider = new KiotProxyProvider(http);

    const info = await provider.getUserInfo(apiToken as string);
    report('KiotProxy account', (info.username ?? 'n/a') + ', balance ' + (info.balance ?? 'n/a'));

    const keys = await provider.listKeys(apiToken as string);
    report('KiotProxy keys', String(keys.length) + ' key (giới hạn số luồng song song)');
    expect(Array.isArray(keys)).toBe(true);
  }, 60_000);

  it.skipIf(!apiToken)('reads the current IP of the first key without rotating it', async () => {
    const provider = new KiotProxyProvider(http);
    const keys = await provider.listKeys(apiToken as string);

    if (keys.length === 0) {
      report('KiotProxy current', 'tài khoản chưa có key nào');
      return;
    }

    try {
      const current = await provider.getCurrentProxy(keys[0].keyValue);
      report('KiotProxy current', current.host + ':' + current.port + ' (' + current.protocol + ')');
      expect(current.ip.length).toBeGreaterThan(0);
    } catch (err: unknown) {
      report('KiotProxy current', 'key chưa được gán IP: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }, 60_000);

  it.skipIf(!apiToken || !isFlagOn('VERIFY_KIOTPROXY_ROTATE'))(
    'rotates the first key to a different IP',
    async () => {
      const provider = new KiotProxyProvider(http);
      const keys = await provider.listKeys(apiToken as string);
      expect(keys.length).toBeGreaterThan(0);

      let previousIp: string | null = null;
      try {
        previousIp = (await provider.getCurrentProxy(keys[0].keyValue)).ip;
      } catch {
        previousIp = null;
      }

      const rotated = await provider.getNewProxy(keys[0].keyValue);
      report('KiotProxy rotate', (previousIp ?? 'n/a') + ' -> ' + rotated.ip);
      expect(rotated.ip.length).toBeGreaterThan(0);
      if (previousIp) {
        expect(rotated.ip).not.toBe(previousIp);
      }
    },
    120_000
  );

  it.runIf(!apiToken)('is skipped without an api token', () => {
    skipNotice('KiotProxy', 'KIOTPROXY_API_TOKEN');
    expect(apiToken).toBeNull();
  });
});

describe('Gmail94 (live)', () => {
  const apiKey = readEnv('GMAIL94_API_KEY');
  const service = readEnv('GMAIL94_SERVICE') ?? 'facebook';

  it.skipIf(!apiKey)('reads the profile and the service catalogue', async () => {
    const provider = new Gmail94Provider(http);

    const profile = await provider.getProfile(apiKey as string);
    report('Gmail94 account', (profile.name ?? 'n/a') + ', balance ' + (profile.balance ?? 'n/a'));

    const services = await provider.listServices();
    report('Gmail94 services', services.map((entry) => entry.slug).join(', ') || '(trống)');
    expect(Array.isArray(services)).toBe(true);
  }, 60_000);

  it.skipIf(!apiKey || !isFlagOn('VERIFY_GMAIL94_BUY'))(
    'buys one mailbox and polls its OTP',
    async () => {
      const provider = new Gmail94Provider(http);

      const order = await provider.createOtpOrder(apiKey as string, service);
      report('Gmail94 buy', order.email + ' (order ' + order.orderId + ')');
      expect(order.email).toContain('@');

      const otp = await provider.readOtp(apiKey as string, order.orderId, service);
      report('Gmail94 otp', otp ?? 'chưa có mã (bình thường nếu chưa gửi mail tới hộp thư này)');
    },
    120_000
  );

  it.runIf(!apiKey)('is skipped without an api key', () => {
    skipNotice('Gmail94', 'GMAIL94_API_KEY');
    expect(apiKey).toBeNull();
  });
});

describe('DongVanFB (live)', () => {
  const apiKey = readEnv('DONGVANFB_API_KEY');
  const accountType = readEnv('DONGVANFB_ACCOUNT_TYPE') ?? '1';
  const quality = readEnv('DONGVANFB_QUALITY') ?? '3';

  it.skipIf(!apiKey)('reads the balance and the account types', async () => {
    const provider = new DongVanFBProvider(http);

    const balance = await provider.checkBalance(apiKey as string);
    report('DongVanFB balance', String(balance));
    expect(typeof balance).toBe('number');

    const types = await provider.listAccountTypes(apiKey as string);
    report('DongVanFB types', types.map((entry) => entry.id + ':' + entry.name).join(' | ') || '(trống)');
    expect(Array.isArray(types)).toBe(true);
  }, 60_000);

  it.skipIf(!apiKey || !isFlagOn('VERIFY_DONGVANFB_BUY'))(
    'buys one mailbox, resolves its OAuth2 pair and reads a code',
    async () => {
      const provider = new DongVanFBProvider(http);

      const mails = await provider.buyMail(apiKey as string, { accountType, quality, type: 'full' });
      const mail = mails[0];
      report('DongVanFB buy', mail.email + ' (pass ' + (mail.password ? 'có' : 'không') +
        ', refresh ' + (mail.refreshToken ? 'có' : 'không') +
        ', client ' + (mail.clientId ? 'có' : 'không') + ')');
      expect(mail.email).toContain('@');

      let refreshToken = mail.refreshToken;
      let clientId = mail.clientId;
      if ((!refreshToken || !clientId) && mail.password) {
        const pair = await provider.getOauth2(apiKey as string, mail.email, mail.password);
        refreshToken = pair.refreshToken;
        clientId = pair.clientId;
        report('DongVanFB oauth2', 'refresh ' + mask(refreshToken) + ', client ' + mask(clientId));
      }

      if (refreshToken && clientId) {
        const viaOauth2 = await provider.readCode('oauth2', {
          email: mail.email,
          refreshToken,
          clientId,
          type: 'all'
        });
        report('DongVanFB code', viaOauth2?.code ?? 'chưa có mã trong hộp thư (bình thường với hộp thư mới)');
      }
    },
    180_000
  );

  it.runIf(!apiKey)('is skipped without an api key', () => {
    skipNotice('DongVanFB', 'DONGVANFB_API_KEY');
    expect(apiKey).toBeNull();
  });
});
