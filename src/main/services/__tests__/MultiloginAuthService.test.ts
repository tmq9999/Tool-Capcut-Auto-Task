import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import { MultiloginAuthService, type IMultiloginAuthApi } from '../MultiloginAuthService';
import { ProviderError } from '../../providers/ProviderError';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { MultiloginTokens } from '../../providers/MultiloginProvider';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

class StubAuthApi implements IMultiloginAuthApi {
  public signInCalls: Array<{ email: string; password: string }> = [];
  public refreshCalls: Array<{ email: string; refreshToken: string }> = [];
  public refreshShouldFailWith: ProviderError | null = null;
  private counter = 0;

  async signIn(email: string, password: string): Promise<MultiloginTokens> {
    this.signInCalls.push({ email, password });
    this.counter += 1;
    return { token: 'signin-jwt-' + this.counter, refreshToken: 'signin-refresh-' + this.counter };
  }

  async refreshTokens(email: string, refreshToken: string): Promise<MultiloginTokens> {
    this.refreshCalls.push({ email, refreshToken });
    if (this.refreshShouldFailWith) throw this.refreshShouldFailWith;
    this.counter += 1;
    return { token: 'refresh-jwt-' + this.counter, refreshToken: 'refresh-refresh-' + this.counter };
  }
}

let tmpDir: string;
let db: Database.Database;
let credRepo: CredentialRepository;
let vault: PlainVault;
let api: StubAuthApi;
let now: number;

function createService(): MultiloginAuthService {
  return new MultiloginAuthService(credRepo, vault, api, { now: () => now });
}

function storeAuth(payload: unknown): void {
  credRepo.saveCredential('multilogin', vault.encrypt(JSON.stringify(payload)), {
    maskedHint: '••••••••',
    status: 'unknown'
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-mlauth-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  credRepo = new CredentialRepository(db);
  vault = new PlainVault();
  api = new StubAuthApi();
  now = Date.parse('2026-09-01T10:00:00.000Z');
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MultiloginAuthService.getAccessToken', () => {
  it('fails with CONFIG_ERROR when Multilogin has not been configured', async () => {
    const service = createService();
    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('returns the automation token directly without contacting the API', async () => {
    storeAuth({ mode: 'token', automationToken: 'automation-token-1' });
    const service = createService();

    await expect(service.getAccessToken()).resolves.toBe('automation-token-1');
    expect(api.signInCalls).toHaveLength(0);
    expect(api.refreshCalls).toHaveLength(0);
  });

  it('signs in on first use in credentials mode and persists the session', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();

    await expect(service.getAccessToken()).resolves.toBe('signin-jwt-1');
    expect(api.signInCalls).toEqual([{ email: 'user@example.com', password: 'secret' }]);

    const stored = credRepo.getCredential('multilogin');
    const decoded = JSON.parse(vault.decrypt(stored?.encryptedCredentials as Buffer)) as {
      session?: { refreshToken?: string };
    };
    expect(decoded.session?.refreshToken).toBe('signin-refresh-1');
  });

  it('reuses a cached token that has not reached its refresh window', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();

    await service.getAccessToken();
    now += 60_000;
    await expect(service.getAccessToken()).resolves.toBe('signin-jwt-1');
    expect(api.signInCalls).toHaveLength(1);
  });

  it('refreshes the token once it enters the refresh window', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();

    await service.getAccessToken();
    now += 26 * 60_000;

    await expect(service.getAccessToken()).resolves.toBe('refresh-jwt-2');
    expect(api.refreshCalls).toEqual([{ email: 'user@example.com', refreshToken: 'signin-refresh-1' }]);
    expect(api.signInCalls).toHaveLength(1);
  });

  it('falls back to a fresh sign-in when the refresh token is rejected', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();
    await service.getAccessToken();
    now += 26 * 60_000;
    api.refreshShouldFailWith = new ProviderError('AUTH_ERROR', 'refresh expired', 'multilogin');

    await expect(service.getAccessToken()).resolves.toBe('signin-jwt-2');
    expect(api.signInCalls).toHaveLength(2);
  });

  it('falls back to a fresh sign-in when refresh fails with a 400 style error', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();
    await service.getAccessToken();
    now += 26 * 60_000;
    // Multilogin answers HTTP 400 for a stale refresh token, which normalizes to
    // CONFIG_ERROR rather than AUTH_ERROR.
    api.refreshShouldFailWith = new ProviderError(
      'CONFIG_ERROR',
      'Multilogin làm mới token thất bại (HTTP 400).',
      'multilogin'
    );

    await expect(service.getAccessToken()).resolves.toBe('signin-jwt-2');
    expect(api.signInCalls).toHaveLength(2);
  });

  it('falls back to a fresh sign-in when refresh fails with a transport error', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();
    await service.getAccessToken();
    now += 26 * 60_000;
    api.refreshShouldFailWith = new ProviderError('NETWORK_ERROR', 'mạng lỗi', 'multilogin');

    await expect(service.getAccessToken()).resolves.toBe('signin-jwt-2');
  });

  it('surfaces the refresh failure when there is no password to fall back on', async () => {
    storeAuth({
      mode: 'credentials',
      email: 'user@example.com',
      session: { jwtToken: 'old-jwt', refreshToken: 'stale-refresh', issuedAt: 0 }
    });
    const service = createService();
    api.refreshShouldFailWith = new ProviderError('CONFIG_ERROR', 'refresh hỏng', 'multilogin');

    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(api.signInCalls).toHaveLength(0);
  });

  it('signs in only once when several callers ask for a token concurrently', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    const service = createService();

    const tokens = await Promise.all([
      service.getAccessToken(),
      service.getAccessToken(),
      service.getAccessToken()
    ]);

    expect(new Set(tokens).size).toBe(1);
    expect(api.signInCalls).toHaveLength(1);
  });

  it('reuses a session persisted by an earlier service instance', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com', password: 'secret' });
    await createService().getAccessToken();

    const secondInstance = createService();
    await expect(secondInstance.getAccessToken()).resolves.toBe('signin-jwt-1');
    expect(api.signInCalls).toHaveLength(1);
  });

  it('rejects a credentials payload with no password', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.com' });
    const service = createService();
    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });
});
