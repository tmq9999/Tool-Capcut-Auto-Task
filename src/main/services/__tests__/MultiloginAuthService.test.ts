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
import type { ObservationIdentity, ObservationScope } from '../../providers/ObservedHttpClient';
import { ObservedHttpClient, type HttpObservationEvent } from '../../providers/ObservedHttpClient';
import type { HttpClient } from '../../providers/HttpClient';

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

function createService(observation?: ObservationScope): MultiloginAuthService {
  return new MultiloginAuthService(credRepo, vault, api, { now: () => now }, observation);
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
  it('clears inherited account ownership through the real AsyncLocalStorage scope', async () => {
    storeAuth({
      mode: 'credentials', email: 'user@example.com', password: 'secret',
      session: { jwtToken: 'old', refreshToken: 'refresh', issuedAt: now - 30 * 60_000 }
    });
    const events: HttpObservationEvent[] = [];
    const raw: HttpClient = {
      send: async () => ({ status: 200, ok: true, body: null, rawText: '' })
    };
    const observed = new ObservedHttpClient(raw, (event) => { events.push(event); });
    const scopedApi: IMultiloginAuthApi = {
      signIn: async () => ({ token: 'signed', refreshToken: 'signed-refresh' }),
      refreshTokens: async () => {
        await observed.send({ method: 'POST', url: 'https://api.multilogin.com/user/refresh_token' });
        return { token: 'refreshed', refreshToken: 'rotated' };
      }
    };
    const service = new MultiloginAuthService(
      credRepo, vault, scopedApi, { now: () => now }, observed
    );

    await observed.withObservationScope({
      runId: 'run-shared', workerAlias: 'worker-9', accountAlias: 'account-9',
      sessionAlias: 'session-9'
    }, () => service.getAccessToken());

    expect(events[0].identity).toEqual({
      scope: 'scoped', runId: 'run-shared', provider: 'multilogin', operation: 'token-refresh'
    });
  });

  it('clears worker/account ownership for a shared token refresh', async () => {
    storeAuth({
      mode: 'credentials', email: 'user@example.com', password: 'secret',
      session: { jwtToken: 'old', refreshToken: 'refresh', issuedAt: now - 30 * 60_000 }
    });
    const identities: Readonly<ObservationIdentity>[] = [];
    const service = createService({
      withObservationScope: async (identity, operation) => {
        identities.push(identity);
        return operation();
      }
    });

    await service.getAccessToken();

    expect(identities).toEqual([{
      provider: 'multilogin',
      operation: 'token-refresh',
      workerAlias: null,
      acquisitionAlias: null,
      accountAlias: null,
      sessionAlias: null
    }]);
  });

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

  it.each(['replace', 'delete'] as const)('T06 ignores stale sign-in after %s', async change => {
    storeAuth({ mode: 'credentials', email: 'old@example.test', password: 'old-demo' });
    let resolve!: (value: MultiloginTokens) => void;
    api.signIn = () => new Promise(done => { resolve = done; });
    const service = createService();
    const pending = service.getAccessToken();
    let pendingError: unknown;
    const pendingPromise = pending.catch(err => { pendingError = err; });
    if (change === 'replace') {
      storeAuth({ mode: 'token', automationToken: 'new-demo' });
      await expect(service.getAccessToken()).resolves.toBe('new-demo');
    } else {
      credRepo.delete('multilogin');
    }
    resolve({ token: 'old-jwt', refreshToken: 'old-refresh' });
    await pendingPromise;
    expect(pendingError).toMatchObject({ code: 'CONFIG_ERROR' });
    const current = credRepo.getCredential('multilogin');
    if (change === 'delete') {
      expect(current).toBeNull();
    } else {
      expect(JSON.parse(vault.decrypt(current!.encryptedCredentials))).toEqual({
        mode: 'token', automationToken: 'new-demo'
      });
    }
  });

  it.each(['replace', 'delete'] as const)('T06 rejects deferred refresh and skips fallback signIn after %s', async change => {
    storeAuth({
      mode: 'credentials',
      email: 'old@example.test',
      password: 'old-password',
      session: { jwtToken: 'old-jwt', refreshToken: 'old-refresh', issuedAt: 0 }
    });
    let rejectRefresh!: (err: Error) => void;
    api.refreshTokens = () => new Promise((_, reject) => { rejectRefresh = reject; });
    const service = createService();
    const pending = service.getAccessToken();
    let pendingError: unknown;
    const pendingPromise = pending.catch(err => { pendingError = err; });
    if (change === 'replace') {
      storeAuth({ mode: 'token', automationToken: 'new-demo' });
      await expect(service.getAccessToken()).resolves.toBe('new-demo');
    } else {
      credRepo.delete('multilogin');
    }
    rejectRefresh(new ProviderError('NETWORK_ERROR', 'mạng lỗi', 'multilogin'));
    await pendingPromise;
    expect(pendingError).toMatchObject({ code: 'CONFIG_ERROR' });
    expect(api.signInCalls).toHaveLength(0);
  });

  it('CAS (§F14.5): invalidateSession while flight is pending creates new flight, old finally does not clear new inFlight, and old resolved session cannot overwrite new flight', async () => {
    storeAuth({ mode: 'credentials', email: 'user@example.test', password: 'password-1' });

    let resolveFlight1!: (tokens: MultiloginTokens) => void;
    let resolveFlight2!: (tokens: MultiloginTokens) => void;

    let signInCallCount = 0;
    api.signIn = async () => {
      signInCallCount += 1;
      if (signInCallCount === 1) {
        return new Promise<MultiloginTokens>((done) => { resolveFlight1 = done; });
      }
      return new Promise<MultiloginTokens>((done) => { resolveFlight2 = done; });
    };

    const service = createService();

    // Flight 1 starts
    const flight1Promise = service.getAccessToken();
    expect(signInCallCount).toBe(1);

    // Invalidate while flight 1 is pending
    service.invalidateSession();

    // Flight 2 starts
    const flight2Promise = service.getAccessToken();
    expect(signInCallCount).toBe(2);

    // Calling getAccessToken again while flight 2 is pending shares flight 2
    const flight2SharedPromise = service.getAccessToken();
    expect(signInCallCount).toBe(2);

    // Flight 1 now completes late
    resolveFlight1({ token: 'jwt-flight-1', refreshToken: 'refresh-flight-1' });

    // Flight 1 should reject because its snapshot generation was invalidated by CAS
    await expect(flight1Promise).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('thay đổi trong khi xử lý')
    });

    // Old flight 1's finally must NOT have cleared the newer flight 2 inFlight
    // Calling getAccessToken again should STILL reuse flight 2
    const flight2StillSharedPromise = service.getAccessToken();
    expect(signInCallCount).toBe(2);

    // Resolve flight 2
    resolveFlight2({ token: 'jwt-flight-2', refreshToken: 'refresh-flight-2' });

    await expect(flight2Promise).resolves.toBe('jwt-flight-2');
    await expect(flight2SharedPromise).resolves.toBe('jwt-flight-2');
    await expect(flight2StillSharedPromise).resolves.toBe('jwt-flight-2');

    // Verify stored session in DB came from flight 2, NOT flight 1
    const stored = credRepo.getCredential('multilogin');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(vault.decrypt(stored!.encryptedCredentials));
    expect(parsed.session).toMatchObject({
      jwtToken: 'jwt-flight-2',
      refreshToken: 'refresh-flight-2'
    });
  });
});
