import { describe, it, expect } from 'vitest';
import {
  Gmail94Connectivity,
  DongVanFBConnectivity,
  KiotProxyConnectivity,
  MultiloginConnectivity
} from '../connectivity';
import { ProviderError } from '../ProviderError';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const clock = { now: () => NOW };

describe('Gmail94Connectivity', () => {
  it('reports OK and carries the balance so Settings can cache it', async () => {
    const probe = new Gmail94Connectivity(
      { readSimpleKey: () => 'GM-KEY' },
      { getProfile: async () => ({ name: 'khainv', email: 'a@b.com', balance: 969500 }) },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('OK');
    expect(result.details?.balance).toBe(969500);
    expect(result.timestamp).toBe('2026-09-01T12:00:00.000Z');
  });

  it('propagates a provider error unchanged', async () => {
    const probe = new Gmail94Connectivity(
      { readSimpleKey: () => 'GM-KEY' },
      { getProfile: async () => { throw new ProviderError('AUTH_ERROR', 'token sai', 'gmail94'); } },
      clock
    );

    await expect(probe.testConnection()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('fails with CONFIG_ERROR when no key is stored', async () => {
    const probe = new Gmail94Connectivity(
      { readSimpleKey: () => { throw new ProviderError('CONFIG_ERROR', 'chưa cấu hình', 'gmail94'); } },
      { getProfile: async () => ({ name: null, email: null, balance: null }) },
      clock
    );

    await expect(probe.testConnection()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('tests explicit draft key when provided', async () => {
    let usedToken = '';
    const probe = new Gmail94Connectivity(
      { readSimpleKey: () => 'STORED-KEY' },
      {
        getProfile: async (t) => {
          usedToken = t;
          return { name: 'user', email: 'u@test.com', balance: 50000 };
        },
      },
      clock
    );

    const res = await probe.testConnection('DRAFT-KEY');
    expect(res.code).toBe('OK');
    expect(usedToken).toBe('DRAFT-KEY');
    expect(res.message).toContain('key vừa nhập');

    const emptyRes = await probe.testConnection('   ');
    expect(emptyRes.code).toBe('CONFIG_ERROR');
    expect(emptyRes.message).toContain('trống');
  });
});

describe('DongVanFBConnectivity', () => {
  it('reports OK with the account balance', async () => {
    const probe = new DongVanFBConnectivity(
      { readSimpleKey: () => 'DV-KEY' },
      { checkBalance: async () => 250000 },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('OK');
    expect(result.details?.balance).toBe(250000);
  });

  it('tests explicit draft key for DongVanFB', async () => {
    let usedKey = '';
    const probe = new DongVanFBConnectivity(
      { readSimpleKey: () => 'STORED-KEY' },
      { checkBalance: async (k) => { usedKey = k; return 12345; } },
      clock
    );

    const result = await probe.testConnection('DRAFT-DV-KEY');
    expect(result.code).toBe('OK');
    expect(usedKey).toBe('DRAFT-DV-KEY');
    expect(result.details?.balance).toBe(12345);
    expect(result.message).toContain('key vừa nhập');
  });
});

describe('KiotProxyConnectivity', () => {
  it('reports OK and includes the key count so the UI can warn about capacity', async () => {
    const probe = new KiotProxyConnectivity(
      { readSimpleKey: () => 'KP-TOKEN' },
      {
        getUserInfo: async () => ({ username: 'acme', balance: 150000 }),
        listKeys: async () => [
          { id: 1, keyValue: 'K1', expiredAt: null },
          { id: 2, keyValue: 'K2', expiredAt: null }
        ]
      },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('OK');
    expect(result.details?.keyCount).toBe(2);
    expect(result.details?.balance).toBe(150000);
  });

  it('tests explicit draft token for KiotProxy', async () => {
    let usedToken = '';
    const probe = new KiotProxyConnectivity(
      { readSimpleKey: () => 'STORED-TOKEN' },
      {
        getUserInfo: async (t) => { usedToken = t; return { username: 'draft-user', balance: 9999 }; },
        listKeys: async () => [{ id: 10, keyValue: 'KEY-1', expiredAt: null }],
      },
      clock
    );

    const result = await probe.testConnection('DRAFT-TOKEN');
    expect(result.code).toBe('OK');
    expect(usedToken).toBe('DRAFT-TOKEN');
    expect(result.details?.keyCount).toBe(1);
    expect(result.message).toContain('token vừa nhập');
  });

  it('reports CONFIG_ERROR when the account owns no proxy key', async () => {
    const probe = new KiotProxyConnectivity(
      { readSimpleKey: () => 'KP-TOKEN' },
      { getUserInfo: async () => ({ username: 'acme', balance: 0 }), listKeys: async () => [] },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('CONFIG_ERROR');
  });
});

describe('MultiloginConnectivity', () => {
  it('reports OK with the launcher version once authentication succeeds', async () => {
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => 'jwt-1' },
      { getLauncherVersion: async () => '1.11.1' },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('OK');
    expect(result.details?.launcherVersion).toBe('1.11.1');
  });

  it('never puts the bearer token into the diagnostic', async () => {
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => 'super-secret-jwt' },
      { getLauncherVersion: async () => '1.11.1' },
      clock
    );

    const result = await probe.testConnection();

    expect(JSON.stringify(result)).not.toContain('super-secret-jwt');
  });

  it('reports the account as reachable but the launcher as down when the agent is offline', async () => {
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => 'jwt-1' },
      { getLauncherVersion: async () => { throw new ProviderError('NETWORK_ERROR', 'agent offline', 'multilogin'); } },
      clock
    );

    const result = await probe.testConnection();

    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.message).toContain('launcher');
    expect(result.details?.accountAuthenticated).toBe(true);
  });

  it('surfaces an authentication failure before probing the launcher', async () => {
    let launcherProbed = false;
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => { throw new ProviderError('AUTH_ERROR', 'sai mật khẩu', 'multilogin'); } },
      { getLauncherVersion: async () => { launcherProbed = true; return '1.0.0'; } },
      clock
    );

    await expect(probe.testConnection()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(launcherProbed).toBe(false);
  });

  it('tests explicit draft credentials for Multilogin', async () => {
    let receivedDraft: unknown = null;
    const probe = new MultiloginConnectivity(
      {
        getAccessToken: async (draft) => {
          receivedDraft = draft;
          return 'jwt-from-draft';
        },
      },
      { getLauncherVersion: async () => '2.0.0' },
      clock
    );

    const result = await probe.testConnection({
      mode: 'credentials',
      email: 'user@test.com',
      password: 'mypassword',
    });

    expect(result.code).toBe('OK');
    expect(result.message).toContain('vừa nhập');
    expect(receivedDraft).toEqual({
      mode: 'credentials',
      email: 'user@test.com',
      password: 'mypassword',
    });
  });

  it('tests explicit draft token for Multilogin', async () => {
    let receivedDraft: unknown = null;
    const probe = new MultiloginConnectivity(
      {
        getAccessToken: async (draft) => {
          receivedDraft = draft;
          return 'automation-token-123';
        },
      },
      { getLauncherVersion: async () => '2.0.0' },
      clock
    );

    const result = await probe.testConnection({
      mode: 'token',
      automationToken: 'automation-token-123',
    });

    expect(result.code).toBe('OK');
    expect(result.message).toContain('vừa nhập');
    expect(receivedDraft).toEqual({
      mode: 'token',
      automationToken: 'automation-token-123',
    });
  });

  it('returns CONFIG_ERROR if draft token is empty', async () => {
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => 'tok' },
      { getLauncherVersion: async () => '2.0.0' },
      clock
    );

    const result = await probe.testConnection({
      mode: 'token',
      automationToken: '   ',
    });

    expect(result.code).toBe('CONFIG_ERROR');
    expect(result.message).toContain('trống');
  });

  it('returns CONFIG_ERROR if draft credentials are empty', async () => {
    const probe = new MultiloginConnectivity(
      { getAccessToken: async () => 'tok' },
      { getLauncherVersion: async () => '2.0.0' },
      clock
    );

    const result = await probe.testConnection({
      mode: 'credentials',
      email: 'user@test.com',
      password: '',
    });

    expect(result.code).toBe('CONFIG_ERROR');
    expect(result.message).toContain('trống');
  });
});
