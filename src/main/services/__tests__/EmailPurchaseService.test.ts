import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import { PurchasedEmailRepository } from '../../repositories/PurchasedEmailRepository';
import { AccountMutationRepository } from '../../repositories/AccountMutationRepository';
import {
  EmailPurchaseService,
  type BillablePurchaseEvent,
  type IGmail94EmailApi,
  type IDongVanFBEmailApi,
  type PurchaseOptions,
  type ReservedEmail
} from '../EmailPurchaseService';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { DongVanPurchasedMail, DongVanCodeResult } from '../../providers/DongVanFBProvider';
import type { ICustomDomainMailApi } from '../EmailPurchaseService';
import { ProviderError, ConfirmedOutOfStockError } from '../../providers/ProviderError';
import { DongVanFBProvider } from '../../providers/DongVanFBProvider';
import { CAPCUT_OTP_SERVICE } from '../../../shared/schemas/provider.schema';
import type { HttpClient, HttpResponse } from '../../providers/HttpClient';
import { AutomationTerminalError } from '../AutomationTerminalError';
import type { Gmail94Profile, Gmail94Service } from '../../providers/Gmail94Provider';
import type { ObservationIdentity, ObservationScope } from '../../providers/ObservedHttpClient';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

class StubGmail94 implements IGmail94EmailApi {
  public createCalls: Array<{ token: string; service: string }> = [];
  public otpByOrder = new Map<string, string>();
  public profile: Gmail94Profile = {
    name: null,
    email: null,
    balance: 0
  };
  public services: Gmail94Service[] = [];
  public orderFailures: Error[] = [];
  public createGate: Promise<void> | null = null;
  public profileCalls = 0;
  public failAfter = Number.POSITIVE_INFINITY;
  private counter = 0;

  async getProfile(): Promise<Gmail94Profile> {
    this.profileCalls += 1;
    return this.profile;
  }

  async listServices(): Promise<Gmail94Service[]> {
    return this.services;
  }

  async createOtpOrder(
    token: string,
    service: string
  ): Promise<{ email: string; orderId: string }> {
    this.createCalls.push({ token, service });
    if (this.createGate) await this.createGate;
    const failure = this.orderFailures.shift();
    if (failure) throw failure;
    this.counter += 1;
    if (this.counter > this.failAfter) throw new Error('quota exhausted');
    return {
      email: 'mail' + this.counter + '@gmail.com',
      orderId: 'order-' + this.counter
    };
  }

  async readOtp(
    _token: string,
    orderId: string,
    _service: string
  ): Promise<string | null> {
    return this.otpByOrder.get(orderId) ?? null;
  }
}

class StubDongVanFB implements IDongVanFBEmailApi {
  public buyCalls = 0;
  public oauthCalls: string[] = [];
  public codeCalls: Array<{ mode: string; email: string }> = [];
  public rows: DongVanPurchasedMail[][] = [];
  public graphOnlyCode: string | null = null;
  public oauth2Code: string | null = null;

  async buyMail(): Promise<DongVanPurchasedMail[]> {
    const next = this.rows[this.buyCalls];
    this.buyCalls += 1;
    if (!next) throw new Error('out of stock');
    return next;
  }

  async getOauth2(_apiKey: string, email: string): Promise<{ refreshToken: string; clientId: string }> {
    this.oauthCalls.push(email);
    return { refreshToken: 'fetched-refresh', clientId: 'fetched-client' };
  }

  async readCode(mode: 'oauth2' | 'graph', params: { email: string }): Promise<DongVanCodeResult | null> {
    this.codeCalls.push({ mode, email: params.email });
    const code = mode === 'graph' ? this.graphOnlyCode : this.oauth2Code;
    return code ? { code, content: null } : null;
  }
}

class StubCustomDomain implements ICustomDomainMailApi {
  public listedAddresses: string[] = [];
  public otpCalls: Array<{ baseUrl: string; address: string; sender?: string }> = [];
  public otpByAddress = new Map<string, string>();

  async readOtp(
    baseUrl: string,
    address: string,
    options?: { senderContains?: string }
  ): Promise<string | null> {
    this.otpCalls.push({ baseUrl, address, sender: options?.senderContains });
    return this.otpByAddress.get(address) ?? null;
  }
}

let tmpDir: string;
let db: Database.Database;
let credRepo: CredentialRepository;
let purchasedRepo: PurchasedEmailRepository;
let vault: PlainVault;
let gmail: StubGmail94;
let dongvan: StubDongVanFB;
let customDomain: StubCustomDomain;
let idCounter: number;

function createService(observation?: ObservationScope): EmailPurchaseService {
  return new EmailPurchaseService(
    credRepo,
    purchasedRepo,
    vault,
    { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
    {
      nextId: () => 'pe-' + ++idCounter,
      customEmail: () => ({
        domain: 'oldevlk.com',
        apiBaseUrl: 'http://103.116.38.76:3000',
        senderFilter: 'capcut'
      }),
      observation
    }
  );
}

function createFencedService(): EmailPurchaseService {
  const mutationRepo = new AccountMutationRepository(db);
  mutationRepo.registerApproval({
    authorityRef: 'auth-test',
    budgetOwnerRef: 'budget-test',
    provider: 'gmail94',
    approvedUnits: 2
  });
  return new EmailPurchaseService(
    credRepo,
    purchasedRepo,
    vault,
    { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
    {
      nextId: () => 'pe-' + ++idCounter,
      mutationContext: {
        repository: mutationRepo,
        authorityRef: 'auth-test',
        budgetOwnerRef: 'budget-test'
      }
    }
  );
}

function storeKey(serviceName: string, apiKey: string): void {
  credRepo.saveCredential(serviceName, vault.encrypt(apiKey), {
    maskedHint: '••••••••',
    status: 'unknown'
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-emailbuy-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  credRepo = new CredentialRepository(db);
  purchasedRepo = new PurchasedEmailRepository(db);
  vault = new PlainVault();
  gmail = new StubGmail94();
  gmail.profile = { name: 'operator', email: 'owner@gmail.com', balance: 10_000 };
  gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
  dongvan = new StubDongVanFB();
  customDomain = new StubCustomDomain();
  idCounter = 0;
});

afterEach(() => {
  vi.useRealTimers();
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EmailPurchaseService acquisition with Gmail94', () => {
  it('records the durable guard before dispatch and refuses provider calls without approval', async () => {
    storeKey('gmail94', 'GM-KEY');
    const mutationRepo = new AccountMutationRepository(db);
    const service = new EmailPurchaseService(
      credRepo,
      purchasedRepo,
      vault,
      { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
      {
        nextId: () => 'pe-' + ++idCounter,
        mutationContext: {
          repository: mutationRepo,
          authorityRef: 'missing-approval',
          budgetOwnerRef: 'budget-test'
        }
      }
    );
    const session = await service.openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 1 }, new AbortController().signal);

    await expect(session.acquireOne('worker-1', new AbortController().signal, {
      ownerRef: 'owner-1', runId: 'run-1', stepAttemptId: 'attempt-1'
    })).rejects.toThrow();
    expect(gmail.createCalls).toHaveLength(0);
  });

  it('keeps UNKNOWN after reservation persistence failure and blocks replacement purchases after reopen', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createFencedService();
    const session = await service.openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 2 }, new AbortController().signal);
    vi.spyOn(purchasedRepo, 'insertReserved').mockImplementation(() => {
      throw new Error('reservation persistence failed');
    });

    await expect(session.acquireOne('worker-1', new AbortController().signal, {
      ownerRef: 'owner-1', runId: 'run-1', stepAttemptId: 'attempt-1'
    })).rejects.toThrow();
    expect(gmail.createCalls).toHaveLength(1);

    db.close();
    db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
    runMigrations(db);
    credRepo = new CredentialRepository(db);
    purchasedRepo = new PurchasedEmailRepository(db);
    const reopenedMutationRepo = new AccountMutationRepository(db);
    expect(reopenedMutationRepo.listBlocking({
      authorityRef: 'auth-test', budgetOwnerRef: 'budget-test', ownerRef: 'owner-2', operation: 'purchase'
    })).toHaveLength(1);
    const reopenedService = new EmailPurchaseService(
      credRepo,
      purchasedRepo,
      vault,
      { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
      {
        nextId: () => 'pe-' + ++idCounter,
        mutationContext: { repository: reopenedMutationRepo, authorityRef: 'auth-test', budgetOwnerRef: 'budget-test' }
      }
    );
    const reopenedSession = await reopenedService.openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 2 }, new AbortController().signal);
    await expect(reopenedSession.acquireOne('worker-2', new AbortController().signal, {
      ownerRef: 'owner-2', runId: 'run-2', stepAttemptId: 'attempt-2'
    })).rejects.toThrow();
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('refuses a duplicate attempt without dispatching or consuming a second unit', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createFencedService();
    const signal = new AbortController().signal;
    const session = await service.openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 2 }, signal);
    const identity = {
      ownerRef: 'owner-duplicate', runId: 'run-1', stepAttemptId: 'attempt-duplicate'
    };

    await session.acquireOne('worker-1', signal, identity);
    await expect(session.acquireOne('worker-1', signal, identity)).rejects.toThrow();

    expect(gmail.createCalls).toHaveLength(1);
    expect(new AccountMutationRepository(db).getApproval('auth-test')?.consumedUnits).toBe(1);
  });

  it('settles three independent purchased mailboxes without cross-binding peers', async () => {
    storeKey('gmail94', 'GM-KEY');
    const mutationRepo = new AccountMutationRepository(db);
    mutationRepo.registerApproval({
      authorityRef: 'auth-three', budgetOwnerRef: 'budget-three', provider: 'gmail94', approvedUnits: 3
    });
    const service = new EmailPurchaseService(
      credRepo, purchasedRepo, vault,
      { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
      {
        nextId: () => 'pe-' + ++idCounter,
        mutationContext: { repository: mutationRepo, authorityRef: 'auth-three', budgetOwnerRef: 'budget-three' }
      }
    );
    const signal = new AbortController().signal;
    const session = await service.openAcquisitionSession('gmail94', 3, { maxBillablePurchases: 3 }, signal);

    const results = [];
    for (let index = 1; index <= 3; index += 1) {
      const result = await session.acquireOne(`worker-${index}`, signal, {
        ownerRef: `owner-${index}`, runId: 'run-three', stepAttemptId: `attempt-${index}`
      });
      results.push(result);
    }

    expect(mutationRepo.getApproval('auth-three')?.consumedUnits).toBe(3);
    results.forEach((result, index) => {
      const ownerRef = `owner-${index + 1}`;
      expect(mutationRepo.getBinding(ownerRef)?.mailboxRef).toBe(result.purchasedEmail.id);
      expect(mutationRepo.getIntent('auth-three', `purchase:${ownerRef}:attempt-${index + 1}`)?.state)
        .toBe('effect-confirmed');
    });
    expect(new Set(results.map((result) => mutationRepo.getBinding(result.ownerRef!)?.mailboxRef)).size).toBe(3);
  });

  it('classifies preflight and purchase provider calls without exposing credentials', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 100 };
    gmail.services = [{ id: 1, name: 'CapCut', slug: 'capcut', price: 10 }];
    const identities: Readonly<ObservationIdentity>[] = [];
    const service = createService({
      withObservationScope: async (identity, operation) => {
        identities.push(identity);
        return operation();
      }
    });
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'gmail94', 1, { maxBillablePurchases: 1 }, signal
    );
    await session.acquireOne('worker-1', signal);

    expect(identities).toEqual([
      { provider: 'gmail94', operation: 'profile' },
      { provider: 'gmail94', operation: 'service-list' },
      { provider: 'gmail94', operation: 'mailbox-purchase' }
    ]);
    expect(JSON.stringify(identities)).not.toContain('GM-KEY');
  });

  it('rents one mailbox per thread and stores every order id', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'gmail94',
      3,
      { service: 'facebook', maxBillablePurchases: 3 },
      signal
    );
    const item1 = await session.acquireOne('worker-1', signal);
    const item2 = await session.acquireOne('worker-2', signal);
    const item3 = await session.acquireOne('worker-3', signal);

    expect([item1.purchasedEmail.email, item2.purchasedEmail.email, item3.purchasedEmail.email]).toEqual([
      'mail1@gmail.com', 'mail2@gmail.com', 'mail3@gmail.com'
    ]);
    expect([item1.purchasedEmail.orderId, item2.purchasedEmail.orderId, item3.purchasedEmail.orderId]).toEqual(['order-1', 'order-2', 'order-3']);
    expect(gmail.createCalls.every((call) => call.token === 'GM-KEY')).toBe(true);
    expect(purchasedRepo.listRecent(10).filter((r) => r.provider === 'gmail94')).toHaveLength(3);
  });

  it('refuses to purchase when the provider has no api key configured', async () => {
    const service = createService();
    const signal = new AbortController().signal;
    await expect(service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    )).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  /**
   * Slug mặc định phải là `capcut`, không phải `facebook`: gmail94 thuê hộp thư
   * THEO dịch vụ, và `otp/read` lọc mã theo đúng slug đã thuê. Thuê hộp
   * `facebook` rồi chờ mã CapCut là chờ mãi mãi.
   */
  it('defaults the service slug to capcut when none is supplied', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    await session.acquireOne('worker-1', signal);

    expect(gmail.createCalls[0].service).toBe('capcut');
  });

  /**
   * Hộp thư đã thuê mà chưa dùng là TIỀN ĐÃ TRẢ. Lượt 04/09/2026 thuê
   * `songhajun652@gmail.com` rồi `xcli profile-quick` lỗi vì launcher Multilogin
   * đã tắt — hộp thư đó mất trắng vì lượt sau lại đi thuê hộp mới.
   * `orderId` đã có trong `purchased_emails`, chỉ là chưa ai dùng lại.
   */
  it('dùng lại hộp thư đã thuê mà chưa tiêu trước khi thuê hộp mới', async () => {
    storeKey('gmail94', 'GM-KEY');
    purchasedRepo.insert({
      id: 'pe-1',
      provider: 'gmail94',
      email: 'mail1@gmail.com',
      orderId: 'order-1',
      service: 'capcut'
    });
    purchasedRepo.insert({
      id: 'pe-2',
      provider: 'gmail94',
      email: 'mail2@gmail.com',
      orderId: 'order-2',
      service: 'capcut'
    });
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'gmail94',
      2,
      { maxBillablePurchases: 0 },
      signal
    );
    const item1 = await session.acquireOne('worker-1', signal);
    const item2 = await session.acquireOne('worker-2', signal);

    // Không gọi vendor lần nào nữa, và trả về đúng hai hộp cũ kèm order id cũ.
    expect(gmail.createCalls).toHaveLength(0);
    expect([item1.purchasedEmail.email, item2.purchasedEmail.email]).toEqual(['mail1@gmail.com', 'mail2@gmail.com']);
    expect([item1.purchasedEmail.orderId, item2.purchasedEmail.orderId]).toEqual(['order-1', 'order-2']);
  });

  it('hộp thư đã tiêu thì KHÔNG dùng lại', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    const signal = new AbortController().signal;

    const session1 = await service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    const first = await session1.acquireOne('worker-1', signal);
    db.prepare(
      "INSERT INTO accounts (id, email, email_provider) VALUES ('acc-1', 'mail1@gmail.com', 'gmail94')"
    ).run();
    session1.commit(first, 'acc-1');

    const session2 = await service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    await session2.acquireOne('worker-1', signal);

    expect(gmail.createCalls).toHaveLength(2);
  });

  /**
   * Nhả lại hộp thư khi luồng chết trước khi dùng tới nó: `AutomationRunService`
   * gọi `release` để trả về hàng chờ nếu không commit.
   */
  it('release đưa hộp thư chưa dùng trở lại hàng chờ', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    const signal = new AbortController().signal;

    const session1 = await service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    const first = await session1.acquireOne('worker-1', signal);
    session1.release(first);

    const session2 = await service.openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    const again = await session2.acquireOne('worker-1', signal);

    expect(gmail.createCalls).toHaveLength(1);
    expect(again.purchasedEmail.orderId).toBe('order-1');
  });
});

describe('EmailPurchaseService acquisition with DongVanFB', () => {
  it('stores the full Email|Pass|RefreshToken|ClientId record without exposing secrets', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      {
        email: 'a@hotmail.com',
        password: 'Pa55',
        refreshToken: 'r-1',
        clientId: 'c-1',
        raw: 'a@hotmail.com|Pa55|r-1|c-1'
      }
    ]];
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'dongvanfb',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    const item = await session.acquireOne('worker-1', signal);

    expect(item.purchasedEmail).toEqual({
      id: item.purchasedEmail.id,
      provider: 'dongvanfb',
      email: 'a@hotmail.com',
      orderId: null,
      service: null,
      hasPassword: true,
      hasOauth: true,
      purchasedAt: expect.any(String),
      consumedAt: null
    });

    const secrets = purchasedRepo.getSecretsById(item.purchasedEmail.id);
    expect(vault.decrypt(secrets?.passwordEncrypted as Buffer)).toBe('Pa55');
    expect(vault.decrypt(secrets?.refreshTokenEncrypted as Buffer)).toBe('r-1');
    expect(secrets?.clientId).toBe('c-1');
  });

  it('fetches the OAuth2 pair when the purchase line did not include one', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      { email: 'b@hotmail.com', password: 'pw', refreshToken: null, clientId: null, raw: 'b@hotmail.com|pw' }
    ]];
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'dongvanfb',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    const item = await session.acquireOne('worker-1', signal);

    expect(dongvan.oauthCalls).toEqual(['b@hotmail.com']);
    const secrets = purchasedRepo.getSecretsById(item.purchasedEmail.id);
    expect(vault.decrypt(secrets?.refreshTokenEncrypted as Buffer)).toBe('fetched-refresh');
    expect(secrets?.clientId).toBe('fetched-client');
  });

  it('does not call the OAuth2 endpoint when the pair already arrived', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      { email: 'c@hotmail.com', password: 'pw', refreshToken: 'r', clientId: 'c', raw: 'c@hotmail.com|pw|r|c' }
    ]];
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'dongvanfb',
      1,
      { maxBillablePurchases: 1 },
      signal
    );
    await session.acquireOne('worker-1', signal);

    expect(dongvan.oauthCalls).toEqual([]);
  });
});

describe('EmailPurchaseService.readOtp', () => {
  it('reads a Gmail94 code using the stored order id and service', async () => {
    storeKey('gmail94', 'GM-KEY');
    purchasedRepo.insert({
      id: 'pe-1',
      provider: 'gmail94',
      email: 'user@gmail.com',
      orderId: 'order-1',
      service: 'tiktok'
    });
    const service = createService();
    gmail.otpByOrder.set('order-1', '445566');

    await expect(service.readOtp('pe-1')).resolves.toBe('445566');
  });

  it('returns null while the Gmail94 mailbox has no code yet', async () => {
    storeKey('gmail94', 'GM-KEY');
    purchasedRepo.insert({
      id: 'pe-1',
      provider: 'gmail94',
      email: 'user@gmail.com',
      orderId: 'order-1',
      service: 'capcut'
    });
    const service = createService();

    await expect(service.readOtp('pe-1')).resolves.toBeNull();
  });

  it('reads a DongVanFB code through oauth2 first', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    purchasedRepo.insert({
      id: 'pe-1',
      provider: 'dongvanfb',
      email: 'e@hotmail.com',
      passwordEncrypted: vault.encrypt('p'),
      refreshTokenEncrypted: vault.encrypt('r'),
      clientId: 'c'
    });
    dongvan.oauth2Code = '778899';
    const service = createService();

    await expect(service.readOtp('pe-1', 'facebook')).resolves.toBe('778899');
    expect(dongvan.codeCalls.map((call) => call.mode)).toEqual(['oauth2']);
  });

  it('falls back to the graph endpoint when oauth2 returns nothing', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    purchasedRepo.insert({
      id: 'pe-1',
      provider: 'dongvanfb',
      email: 'f@hotmail.com',
      passwordEncrypted: vault.encrypt('p'),
      refreshTokenEncrypted: vault.encrypt('r'),
      clientId: 'c'
    });
    dongvan.graphOnlyCode = '112233';
    const service = createService();

    await expect(service.readOtp('pe-1', 'facebook')).resolves.toBe('112233');
    expect(dongvan.codeCalls.map((call) => call.mode)).toEqual(['oauth2', 'graph']);
  });

  it('fails clearly when the purchased email is unknown', async () => {
    const service = createService();
    await expect(service.readOtp('missing')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });
});

describe('EmailPurchaseService.getProviderConfigs', () => {
  it('reports which email providers are usable from the Dashboard', () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    expect(service.getProviderConfigs()).toEqual([
      { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••', apiKey: 'GM-KEY' },
      { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••', apiKey: null }
    ]);
  });

  it('R08 provides the configured email API key value', () => {
    storeKey('gmail94', 'KEY-DEMO');
    expect(createService().getProviderConfigs().find((x) => x.provider === 'gmail94')?.apiKey).toBe('KEY-DEMO');
  });
});

describe('EmailPurchaseService với domain tự sở hữu', () => {
  it('tự sinh đủ số địa chỉ theo domain, không gọi vendor nào', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'customdomain',
      4,
      { maxBillablePurchases: 0 },
      signal
    );
    const items = await Promise.all([
      session.acquireOne('w1', signal),
      session.acquireOne('w2', signal),
      session.acquireOne('w3', signal),
      session.acquireOne('w4', signal)
    ]);

    expect(items).toHaveLength(4);
    for (const row of items) {
      expect(row.purchasedEmail.email.endsWith('@oldevlk.com')).toBe(true);
      expect(row.purchasedEmail.provider).toBe('customdomain');
      expect(row.purchasedEmail.hasPassword).toBe(false);
      expect(row.purchasedEmail.hasOauth).toBe(false);
      expect(row.purchasedEmail.orderId).toBeNull();
    }
    expect(gmail.createCalls).toHaveLength(0);
    expect(dongvan.buyCalls).toBe(0);
  });

  it('không cần API key nào để dùng domain tự sở hữu', async () => {
    const service = createService();
    const signal = new AbortController().signal;
    await expect(service.openAcquisitionSession(
      'customdomain',
      1,
      { maxBillablePurchases: 0 },
      signal
    )).resolves.toBeDefined();
  });

  it('mỗi địa chỉ sinh ra là khác nhau', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'customdomain',
      12,
      { maxBillablePurchases: 0 },
      signal
    );
    const items = await Promise.all(
      Array.from({ length: 12 }, (_, i) => session.acquireOne(`w${i}`, signal))
    );

    expect(new Set(items.map((row) => row.purchasedEmail.email)).size).toBe(12);
  });

  it('lưu địa chỉ vào DB để đọc OTP về sau', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession(
      'customdomain',
      2,
      { maxBillablePurchases: 0 },
      signal
    );
    await session.acquireOne('w1', signal);
    await session.acquireOne('w2', signal);

    expect(purchasedRepo.listRecent(10).filter((r) => r.provider === 'customdomain')).toHaveLength(2);
  });

  it('đọc OTP qua base url và bộ lọc người gửi trong cài đặt', async () => {
    const service = createService();
    const signal = new AbortController().signal;
    const session = await service.openAcquisitionSession(
      'customdomain',
      1,
      { maxBillablePurchases: 0 },
      signal
    );
    const bought = await session.acquireOne('w1', signal);
    const address = bought.purchasedEmail.email;
    customDomain.otpByAddress.set(address, '260973');

    await expect(service.readOtp(bought.purchasedEmail.id)).resolves.toBe('260973');
    expect(customDomain.otpCalls[0]).toEqual({
      baseUrl: 'http://103.116.38.76:3000',
      address,
      sender: 'capcut'
    });
  });

  it('trả null khi hộp thư chưa có mã', async () => {
    const service = createService();
    const signal = new AbortController().signal;
    const session = await service.openAcquisitionSession(
      'customdomain',
      1,
      { maxBillablePurchases: 0 },
      signal
    );
    const bought = await session.acquireOne('w1', signal);

    await expect(service.readOtp(bought.purchasedEmail.id)).resolves.toBeNull();
  });
});

describe('EmailPurchaseService acquisition session with Gmail94', () => {
  it('preflight combines reusable rows with current balance and capcut price', async () => {
    storeKey('gmail94', 'GM-KEY');
    purchasedRepo.insert({
      id: 'paid-1',
      provider: 'gmail94',
      email: 'paid@gmail.com',
      service: 'capcut'
    });
    purchasedRepo.insert({
      id: 'legacy-facebook',
      provider: 'gmail94',
      email: 'legacy@gmail.com',
      service: 'facebook'
    });
    gmail.profile = { name: 'operator', email: 'owner@gmail.com', balance: 2500 };
    gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

    const session = await createService().openAcquisitionSession(
      'gmail94',
      3,
      { service: 'capcut', maxBillablePurchases: 2 },
      new AbortController().signal
    );

    expect(session.capacity).toMatchObject({
      provider: 'gmail94',
      service: 'capcut',
      balance: 2500,
      unitPrice: 1000,
      reusableCount: 1,
      affordablePurchaseCount: 2,
      totalAvailableCount: 3
    });
    expect(session.capacity?.checkedAt).toEqual(expect.any(String));
    expect(gmail.createCalls).toHaveLength(0);
  });

  it('blocks an unaffordable initial wave before an order', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 999 };
    gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

    await expect(createService().openAcquisitionSession(
      'gmail94',
      2,
      { maxBillablePurchases: 2 },
      new AbortController().signal
    )).rejects.toMatchObject({
      state: 'blocked',
      reason: { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' }
    });
    expect(gmail.createCalls).toHaveLength(0);
  });

  it('serializes two workers and never returns the same reusable row', async () => {
    storeKey('gmail94', 'GM-KEY');
    purchasedRepo.insert({
      id: 'paid-1',
      provider: 'gmail94',
      email: 'paid@gmail.com',
      service: 'capcut'
    });
    gmail.profile = { name: null, email: null, balance: 1000 };
    gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      2,
      { maxBillablePurchases: 1 },
      new AbortController().signal
    );

    const [first, second] = await Promise.all([
      session.acquireOne('worker-1', new AbortController().signal),
      session.acquireOne('worker-2', new AbortController().signal)
    ]);

    expect(new Set([first.purchasedEmail.id, second.purchasedEmail.id]).size).toBe(2);
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('pins Gmail94 purchases to the capcut service despite a stale saved slug', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 1000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { service: 'facebook', maxBillablePurchases: 1 },
      new AbortController().signal
    );

    await session.acquireOne('worker-1', new AbortController().signal);

    expect(gmail.createCalls).toEqual([
      { token: 'GM-KEY', service: 'capcut' }
    ]);
  });

  it('refreshes balance after the run-local purchase budget is spent', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 1000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 2 },
      new AbortController().signal
    );

    const first = await session.acquireOne(
      'worker-1',
      new AbortController().signal
    );
    db.prepare(
      "INSERT INTO accounts (id, email, email_provider) VALUES ('account-1', 'mail1@gmail.com', 'gmail94')"
    ).run();
    session.commit(first, 'account-1');
    gmail.profile = { name: null, email: null, balance: 1000 };
    const second = await session.acquireOne(
      'worker-1',
      new AbortController().signal
    );

    expect(second.purchasedEmail.email).toBe('mail2@gmail.com');
    expect(gmail.profileCalls).toBe(2);
    expect(gmail.createCalls).toHaveLength(2);
  });

  it('refreshes once and reports fresh safe details on early insufficient funds', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      new AbortController().signal
    );
    gmail.profile = { name: null, email: null, balance: 250 };
    gmail.orderFailures = [
      new ProviderError(
        'INSUFFICIENT_FUNDS',
        'Số dư Gmail94 không đủ.',
        'gmail94'
      )
    ];

    await expect(session.acquireOne(
      'worker-1',
      new AbortController().signal
    )).rejects.toMatchObject({
      state: 'blocked',
      reason: {
        code: 'INSUFFICIENT_FUNDS',
        provider: 'gmail94',
        details: {
          balance: 250,
          unitPrice: 1000,
          affordablePurchaseCount: 0
        }
      }
    });
    expect(gmail.profileCalls).toBe(2);
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('blocks an ambiguous purchase instead of retrying the billable request', async () => {
    vi.useFakeTimers();
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
    gmail.orderFailures = [
      new ProviderError('NETWORK_ERROR', 'network', 'gmail94'),
      new ProviderError('RATE_LIMITED', 'rate', 'gmail94')
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      new AbortController().signal
    );

    const acquisition = session.acquireOne('worker-1', new AbortController().signal).catch(e => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await acquisition).toMatchObject({ reason: { code: 'PURCHASE_OUTCOME_UNKNOWN' } });
    expect(gmail.createCalls).toHaveLength(1);
    vi.useRealTimers();
  });

  it.each(['AUTH_ERROR', 'CONFIG_ERROR', 'INSUFFICIENT_FUNDS'] as const)(
    'does not retry terminal provider error %s',
    async (code) => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [
        { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
      ];
      gmail.orderFailures = [new ProviderError(code, 'sanitized', 'gmail94')];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toBeInstanceOf(Error);
      expect(gmail.createCalls).toHaveLength(1);
    }
  );

  it('does not retry a rate-limited purchase without a provider idempotency guarantee', async () => {
    vi.useFakeTimers();
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    gmail.orderFailures = [
      new ProviderError('RATE_LIMITED', 'rate', 'gmail94')
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      new AbortController().signal
    );
    const controller = new AbortController();

    const acquisition = session.acquireOne('worker-1', controller.signal);
    const expectation = expect(acquisition).rejects.toMatchObject({ reason: { code: 'PURCHASE_OUTCOME_UNKNOWN' } });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('test cancellation'));
    await vi.advanceTimersByTimeAsync(500);

    await expectation;
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('does not expose raw transport failures or send another order', async () => {
    vi.useFakeTimers();
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    gmail.orderFailures = [
      new Error('token=secret-one'),
      new ProviderError('RATE_LIMITED', 'two', 'gmail94'),
      new ProviderError('NETWORK_ERROR', 'three', 'gmail94')
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      { maxBillablePurchases: 1 },
      new AbortController().signal
    );

    const acquisition = session.acquireOne(
      'worker-1',
      new AbortController().signal
    );
    const expectation = expect(acquisition).rejects.toMatchObject({
      state: 'blocked',
      reason: {
        code: 'PURCHASE_OUTCOME_UNKNOWN',
        provider: 'gmail94',
        details: { attempts: 1 }
      }
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expectation;
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('cancels a worker waiting behind the serialized purchase queue', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    let releaseFirst: () => void = () => {};
    gmail.createGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const session = await createService().openAcquisitionSession(
      'gmail94',
      2,
      { maxBillablePurchases: 2 },
      new AbortController().signal
    );
    const first = session.acquireOne('worker-1', new AbortController().signal);
    while (gmail.createCalls.length === 0) await Promise.resolve();

    const controller = new AbortController();
    let secondError = '';
    const second = session.acquireOne('worker-2', controller.signal)
      .catch((error: unknown) => { secondError = (error as Error).message; });
    controller.abort(new Error('queue cancelled'));
    await second;
    const rejectedBeforeFirstFinished = secondError === 'queue cancelled';

    const third = session.acquireOne(
      'worker-3',
      new AbortController().signal
    );
    await Promise.resolve();
    expect(gmail.createCalls).toHaveLength(1);

    releaseFirst();
    await first;
    await third;

    expect(rejectedBeforeFirstFinished).toBe(true);
    expect(gmail.createCalls).toHaveLength(2);
    expect(session.purchaseStats()).toEqual({
      budget: 2,
      attempted: 2,
      confirmed: 2,
      ambiguous: 0
    });
  });

  describe('Task 12: Billable provider budget enforcement at dispatch boundary', () => {
    it('requires an explicit non-negative integer purchase budget for Gmail94 and DongVan', async () => {
      storeKey('gmail94', 'GM-KEY');
      storeKey('dongvanfb', 'DV-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

      const service = createService();
      const invalidBudgets = [undefined, -1, 1.5, Number.NaN];

      for (const budget of invalidBudgets) {
        const invalidOptions = {
          maxBillablePurchases: budget
        } as unknown as PurchaseOptions;
        await expect(
          service.openAcquisitionSession('gmail94', 1, invalidOptions, new AbortController().signal)
        ).rejects.toThrow(ProviderError);

        await expect(
          service.openAcquisitionSession('dongvanfb', 1, invalidOptions, new AbortController().signal)
        ).rejects.toThrow(ProviderError);
      }

      expect(gmail.profileCalls).toBe(0);
      expect(gmail.createCalls).toHaveLength(0);
      expect(dongvan.buyCalls).toBe(0);

      // zero is valid for reuse-only
      const zeroGmail = await service.openAcquisitionSession('gmail94', 0, { maxBillablePurchases: 0 }, new AbortController().signal);
      expect(zeroGmail.purchaseStats().budget).toBe(0);

      // one permits at most one dispatch
      const oneGmail = await service.openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 1 }, new AbortController().signal);
      expect(oneGmail.purchaseStats().budget).toBe(1);
    });

    it('reused Gmail94 inventory consumes no billable budget', async () => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      purchasedRepo.insertReserved({ id: 'reused-1', provider: 'gmail94', email: 'reused1@gmail.com', service: 'capcut' }, 'initial');
      purchasedRepo.releaseReservation('reused-1', 'initial');
      purchasedRepo.insertReserved({ id: 'reused-2', provider: 'gmail94', email: 'reused2@gmail.com', service: 'capcut' }, 'initial');
      purchasedRepo.releaseReservation('reused-2', 'initial');

      const session = await createService().openAcquisitionSession('gmail94', 2, { maxBillablePurchases: 0 }, new AbortController().signal);
      const res1 = await session.acquireOne('w1', new AbortController().signal);
      const res2 = await session.acquireOne('w2', new AbortController().signal);

      expect(res1.purchasedEmail.id).toBe('reused-1');
      expect(res2.purchasedEmail.id).toBe('reused-2');
      expect(gmail.createCalls).toHaveLength(0);
      expect(session.purchaseStats()).toEqual({
        budget: 0,
        attempted: 0,
        confirmed: 0,
        ambiguous: 0
      });
    });

    it('reused DongVan inventory consumes no billable budget', async () => {
      storeKey('dongvanfb', 'DV-KEY');
      purchasedRepo.insertReserved({ id: 'dv-reused-1', provider: 'dongvanfb', email: 'dv1@dongvan.com' }, 'initial');
      purchasedRepo.releaseReservation('dv-reused-1', 'initial');
      purchasedRepo.insertReserved({ id: 'dv-reused-2', provider: 'dongvanfb', email: 'dv2@dongvan.com' }, 'initial');
      purchasedRepo.releaseReservation('dv-reused-2', 'initial');

      const session = await createService().openAcquisitionSession('dongvanfb', 2, { maxBillablePurchases: 0 }, new AbortController().signal);
      const res1 = await session.acquireOne('w1', new AbortController().signal);
      const res2 = await session.acquireOne('w2', new AbortController().signal);

      expect(res1.purchasedEmail.id).toBe('dv-reused-1');
      expect(res2.purchasedEmail.id).toBe('dv-reused-2');
      expect(dongvan.buyCalls).toBe(0);
      expect(session.purchaseStats()).toEqual({
        budget: 0,
        attempted: 0,
        confirmed: 0,
        ambiguous: 0
      });
    });

    it('atomically caps concurrent Gmail94 dispatches', async () => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 10000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

      const session = await createService().openAcquisitionSession('gmail94', 2, { maxBillablePurchases: 2 }, new AbortController().signal);
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) => session.acquireOne(`worker-${i}`, new AbortController().signal))
      );

      const fulfilled = results.filter((r): r is PromiseFulfilledResult<ReservedEmail> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(3);
      expect(gmail.createCalls).toHaveLength(2);

      for (const rej of rejected) {
        expect(rej.reason).toBeInstanceOf(AutomationTerminalError);
        expect((rej.reason as AutomationTerminalError).reason.code).toBe('BILLABLE_PURCHASE_LIMIT_REACHED');
      }

      const stats = session.purchaseStats();
      expect(stats.budget).toBe(2);
      expect(stats.attempted).toBe(2);
      expect(stats.confirmed).toBe(2);
      expect(stats.ambiguous).toBe(0);
    });

    it('atomically caps concurrent DongVan dispatches', async () => {
      storeKey('dongvanfb', 'DV-KEY');
      dongvan.rows = [
        [{
          email: 'm1@dv.com',
          password: 'p1',
          refreshToken: null,
          clientId: null,
          raw: 'm1@dv.com|p1'
        }],
        [{
          email: 'm2@dv.com',
          password: 'p2',
          refreshToken: null,
          clientId: null,
          raw: 'm2@dv.com|p2'
        }],
        [{
          email: 'm3@dv.com',
          password: 'p3',
          refreshToken: null,
          clientId: null,
          raw: 'm3@dv.com|p3'
        }]
      ];

      const session = await createService().openAcquisitionSession('dongvanfb', 2, { maxBillablePurchases: 2 }, new AbortController().signal);
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) => session.acquireOne(`worker-${i}`, new AbortController().signal))
      );

      const fulfilled = results.filter((r): r is PromiseFulfilledResult<ReservedEmail> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(3);
      expect(dongvan.buyCalls).toBe(2);

      for (const rej of rejected) {
        expect(rej.reason).toBeInstanceOf(AutomationTerminalError);
        expect((rej.reason as AutomationTerminalError).reason.code).toBe('BILLABLE_PURCHASE_LIMIT_REACHED');
      }

      const stats = session.purchaseStats();
      expect(stats.budget).toBe(2);
      expect(stats.attempted).toBe(2);
      expect(stats.confirmed).toBe(2);
      expect(stats.ambiguous).toBe(0);
    });

    it('consumes budget immediately before provider dispatch', async () => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

      let releaseProvider: () => void = () => {};
      gmail.createGate = new Promise<void>((resolve) => { releaseProvider = resolve; });

      const purchaseEvents: BillablePurchaseEvent[] = [];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        {
          maxBillablePurchases: 1,
          onPurchaseEvent: (ev) => purchaseEvents.push(ev)
        },
        new AbortController().signal
      );

      const acquirePromise = session.acquireOne('w1', new AbortController().signal);
      while (gmail.createCalls.length === 0) await Promise.resolve();

      // Before provider resolves: attempted must be 1, confirmed 0
      expect(purchaseEvents).toHaveLength(1);
      expect(purchaseEvents[0].outcome).toBe('attempted');
      expect(purchaseEvents[0].stats.attempted).toBe(1);
      expect(purchaseEvents[0].stats.confirmed).toBe(0);

      releaseProvider();
      await acquirePromise;

      expect(purchaseEvents).toHaveLength(2);
      expect(purchaseEvents[1].outcome).toBe('confirmed');
      expect(purchaseEvents[1].stats.confirmed).toBe(1);
    });

    it('ambiguous Gmail94 outcome consumes one unit and cannot retry', async () => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      gmail.orderFailures = [new Error('Network timeout during dispatch')];

      const session = await createService().openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 1 }, new AbortController().signal);

      await expect(session.acquireOne('w1', new AbortController().signal)).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'PURCHASE_OUTCOME_UNKNOWN', provider: 'gmail94' }
      });

      const stats = session.purchaseStats();
      expect(stats.attempted).toBe(1);
      expect(stats.confirmed).toBe(0);
      expect(stats.ambiguous).toBe(1);

      // Second acquire is budget-blocked without calling provider again
      await expect(session.acquireOne('w2', new AbortController().signal)).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'BILLABLE_PURCHASE_LIMIT_REACHED', provider: 'gmail94' }
      });

      expect(gmail.createCalls).toHaveLength(1);
    });

    it('ambiguous DongVan outcome consumes one unit and cannot retry', async () => {
      storeKey('dongvanfb', 'DV-KEY');
      dongvan.rows = []; // will cause buyMail to throw

      const session = await createService().openAcquisitionSession('dongvanfb', 1, { maxBillablePurchases: 1 }, new AbortController().signal);

      await expect(session.acquireOne('w1', new AbortController().signal)).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'PURCHASE_OUTCOME_UNKNOWN', provider: 'dongvanfb' }
      });

      const stats = session.purchaseStats();
      expect(stats.attempted).toBe(1);
      expect(stats.confirmed).toBe(0);
      expect(stats.ambiguous).toBe(1);

      // Second request is budget-blocked
      await expect(session.acquireOne('w2', new AbortController().signal)).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'BILLABLE_PURCHASE_LIMIT_REACHED', provider: 'dongvanfb' }
      });

      expect(dongvan.buyCalls).toBe(1);
    });

    it('treats a real DongVan malformed purchase response as ambiguous after dispatch', async () => {
      storeKey('dongvanfb', 'DV-KEY');
      const malformedResponse: HttpResponse = {
        status: 200,
        ok: true,
        body: {
          status: true,
          data: { order_code: 'order-without-mail', list_data: [] }
        },
        rawText: '{"status":true}'
      };
      const http: HttpClient = {
        async send(): Promise<HttpResponse> {
          return malformedResponse;
        }
      };
      const realDongVan = new DongVanFBProvider(http);
      const service = new EmailPurchaseService(
        credRepo,
        purchasedRepo,
        vault,
        { gmail94: gmail, dongvanfb: realDongVan, customdomain: customDomain }
      );
      const session = await service.openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'PURCHASE_OUTCOME_UNKNOWN', provider: 'dongvanfb' }
      });
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 0,
        ambiguous: 1
      });
    });

    it('poisons the session without consuming budget when attempted-event delivery fails', async () => {
      storeKey('gmail94', 'fake-key');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      let eventCalls = 0;
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        {
          maxBillablePurchases: 1,
          onPurchaseEvent: () => {
            eventCalls += 1;
            throw new Error('fake-event-delivery-failure');
          }
        },
        new AbortController().signal
      );

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toMatchObject({
        state: 'failed',
        reason: { code: 'INTERNAL_ERROR', provider: 'gmail94' }
      });
      await expect(
        session.acquireOne('worker-2', new AbortController().signal)
      ).rejects.toMatchObject({
        state: 'failed',
        reason: { code: 'INTERNAL_ERROR', provider: 'gmail94' }
      });

      expect(eventCalls).toBe(1);
      expect(gmail.createCalls).toHaveLength(0);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 0,
        confirmed: 0,
        ambiguous: 0
      });
    });

    it('confirmed purchase increments confirmed exactly once', async () => {
      storeKey('gmail94', 'GM-KEY');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

      const session = await createService().openAcquisitionSession('gmail94', 1, { maxBillablePurchases: 1 }, new AbortController().signal);
      await session.acquireOne('w1', new AbortController().signal);

      const stats = session.purchaseStats();
      expect(stats.attempted).toBe(1);
      expect(stats.confirmed).toBe(1);
      expect(stats.ambiguous).toBe(0);

      // Next acquire cannot dispatch
      await expect(session.acquireOne('w2', new AbortController().signal)).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'BILLABLE_PURCHASE_LIMIT_REACHED', provider: 'gmail94' }
      });

      expect(gmail.createCalls).toHaveLength(1);
    });

    it('purchase events contain no mailbox/order/provider credential values', async () => {
      storeKey('gmail94', 'SECRET-API-TOKEN-XYZ');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

      const events: BillablePurchaseEvent[] = [];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        {
          maxBillablePurchases: 1,
          onPurchaseEvent: (ev) => events.push(ev)
        },
        new AbortController().signal
      );

      await session.acquireOne('w1', new AbortController().signal);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const forbiddenStrings = ['SECRET-API-TOKEN', 'mail1@gmail.com', 'order-1'];

      for (const ev of events) {
        const serialized = JSON.stringify(ev);
        for (const forbidden of forbiddenStrings) {
          expect(serialized).not.toContain(forbidden);
        }
        expect(ev).toHaveProperty('provider');
        expect(ev).toHaveProperty('outcome');
        expect(ev).toHaveProperty('stats');
      }
    });

    it('counts provider confirmation before persistence can fail', async () => {
      storeKey('gmail94', 'fake-key');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );
      vi.spyOn(purchasedRepo, 'insertReserved').mockImplementationOnce(() => {
        throw new Error('fake-persistence-failure');
      });

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toThrow('fake-persistence-failure');
      expect(gmail.createCalls).toHaveLength(1);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 1,
        ambiguous: 0
      });
    });

    it('counts DongVan confirmation before OAuth enrichment can fail', async () => {
      storeKey('dongvanfb', 'fake-key');
      dongvan.rows = [[{
        email: 'mail@example.invalid',
        password: 'fake-password',
        refreshToken: null,
        clientId: null,
        raw: 'fake-offline-row'
      }]];
      vi.spyOn(dongvan, 'getOauth2').mockRejectedValueOnce(
        new Error('fake-oauth-enrichment-failure')
      );
      const session = await createService().openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toThrow('fake-oauth-enrichment-failure');
      expect(dongvan.buyCalls).toBe(1);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 1,
        ambiguous: 0
      });
    });

    it('pre-dispatch cancellation consumes no attempt', async () => {
      storeKey('gmail94', 'fake-key');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );
      const controller = new AbortController();
      controller.abort(new Error('cancel-before-dispatch'));

      await expect(session.acquireOne('worker-1', controller.signal)).rejects.toThrow(
        'cancel-before-dispatch'
      );
      expect(gmail.createCalls).toHaveLength(0);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 0,
        confirmed: 0,
        ambiguous: 0
      });
    });

    it('post-dispatch cancellation cannot refund a confirmed attempt', async () => {
      storeKey('gmail94', 'fake-key');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      let releaseProvider: () => void = () => {};
      gmail.createGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        { maxBillablePurchases: 1 },
        new AbortController().signal
      );
      const controller = new AbortController();
      const acquisition = session.acquireOne('worker-1', controller.signal);
      while (gmail.createCalls.length === 0) await Promise.resolve();

      controller.abort(new Error('cancel-after-dispatch'));
      releaseProvider();
      await acquisition.catch(() => undefined);

      expect(gmail.createCalls).toHaveLength(1);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 1,
        ambiguous: 0
      });
    });

    it('returns independent stats copies to sessions and event consumers', async () => {
      storeKey('gmail94', 'fake-key');
      gmail.profile = { name: null, email: null, balance: 5000 };
      gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
      const events: BillablePurchaseEvent[] = [];
      const session = await createService().openAcquisitionSession(
        'gmail94',
        1,
        {
          maxBillablePurchases: 1,
          onPurchaseEvent: (event) => {
            events.push(event);
            event.stats.attempted = 99;
          }
        },
        new AbortController().signal
      );

      await session.acquireOne('worker-1', new AbortController().signal);
      const firstCopy = session.purchaseStats();
      firstCopy.confirmed = 99;

      expect(events).toHaveLength(2);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 1,
        ambiguous: 0
      });
    });

    it('OP-02 retains paid mailbox after OAuth failure', async () => {
      storeKey('dongvanfb', 'DV-TEST');
      dongvan.rows = [[{
        email: 'a@example.test',
        password: 'fake',
        refreshToken: null,
        clientId: null,
        raw: 'a@example.test|fake'
      }]];
      vi.spyOn(dongvan, 'getOauth2').mockRejectedValueOnce(new Error('oauth fixture'));
      const signal = new AbortController().signal;
      const session = await createService().openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        signal
      );
      await expect(session.acquireOne('w1', signal)).rejects.toThrow('oauth fixture');
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
      const reused = await session.acquireOne('w2', signal);
      expect(reused.purchasedEmail.hasOauth).toBe(true);
      expect(dongvan.buyCalls).toBe(1);
    });

    it('OP-02 post-purchase abort releases reservation and preserves mailbox in DB', async () => {
      storeKey('dongvanfb', 'DV-TEST');
      dongvan.rows = [[{
        email: 'abort@example.test',
        password: 'pass',
        refreshToken: null,
        clientId: null,
        raw: 'abort@example.test|pass'
      }]];
      const controller = new AbortController();
      vi.spyOn(dongvan, 'getOauth2').mockImplementation(async () => {
        controller.abort(new Error('aborted-during-oauth'));
        throw new Error('aborted-during-oauth');
      });
      const session = await createService().openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        controller.signal
      );
      await expect(session.acquireOne('w1', controller.signal)).rejects.toThrow('aborted-during-oauth');
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
    });

    it('OP-02 post-OAuth abort before update releases reservation', async () => {
      storeKey('dongvanfb', 'DV-TEST');
      dongvan.rows = [[{
        email: 'post-oauth@example.test',
        password: 'pass',
        refreshToken: null,
        clientId: null,
        raw: 'post-oauth@example.test|pass'
      }]];
      const controller = new AbortController();
      vi.spyOn(dongvan, 'getOauth2').mockImplementation(async () => {
        controller.abort(new Error('post-oauth-abort'));
        return { refreshToken: 'rt', clientId: 'cid' };
      });
      const session = await createService().openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        controller.signal
      );
      await expect(session.acquireOne('w1', controller.signal)).rejects.toThrow('post-oauth-abort');
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
    });

    it('OP-02 fenced reuse looks up original owner and asserts no unknown', async () => {
      storeKey('dongvanfb', 'DV-TEST');
      const mutationRepo = new AccountMutationRepository(db);
      mutationRepo.registerApproval({
        authorityRef: 'auth-test',
        budgetOwnerRef: 'budget-test',
        provider: 'dongvanfb',
        approvedUnits: 2
      });
      const service = new EmailPurchaseService(
        credRepo,
        purchasedRepo,
        vault,
        { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
        {
          nextId: () => 'pe-' + ++idCounter,
          mutationContext: {
            repository: mutationRepo,
            authorityRef: 'auth-test',
            budgetOwnerRef: 'budget-test'
          }
        }
      );

      dongvan.rows = [[{
        email: 'fenced@example.test',
        password: 'pass',
        refreshToken: 'rt',
        clientId: 'cid',
        raw: 'fenced@example.test|pass|rt|cid'
      }]];
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('dongvanfb', 1, { maxBillablePurchases: 1 }, signal);
      const first = await session.acquireOne('w1', signal, {
        ownerRef: 'owner-1',
        runId: 'run-1',
        stepAttemptId: 'att-1'
      });
      expect(first.ownerRef).toBe('owner-1');
      session.release(first);

      // Now reuse in another worker with a different ownerRef
      const second = await session.acquireOne('w2', signal, {
        ownerRef: 'owner-2',
        runId: 'run-2',
        stepAttemptId: 'att-2'
      });
      // Ownership continuity preserves original owner
      expect(second.ownerRef).toBe('owner-1');
      expect(dongvan.buyCalls).toBe(1);
    });

    it('B01 stops malformed success without order_code after one dispatch', async () => {
      storeKey('dongvanfb', 'DV-DEMO');
      let calls = 0;
      const realProvider = new DongVanFBProvider({
        async send(): Promise<HttpResponse> {
          calls++;
          if (calls > 1) throw new Error('fixture retry detected');
          return {
            ok: true,
            status: 200,
            rawText: '',
            body: { status: true, data: { list_data: [] } }
          };
        }
      });
      const service = new EmailPurchaseService(credRepo, purchasedRepo, vault, {
        gmail94: gmail,
        dongvanfb: realProvider,
        customdomain: customDomain
      });
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1, emailRetryIntervalMs: 0 },
        signal
      );
      await expect(session.acquireOne('w1', signal)).rejects.toMatchObject({
        reason: { code: 'PURCHASE_OUTCOME_UNKNOWN' }
      });
      expect(calls).toBe(1);
      expect(session.purchaseStats()).toEqual({
        budget: 1,
        attempted: 1,
        confirmed: 0,
        ambiguous: 1
      });
    });

    it('B05 releases the reservation when reusable OAuth setup fails', async () => {
      purchasedRepo.insert({
        id: 'mail-reuse',
        provider: 'dongvanfb',
        email: 'reuse@example.test',
        passwordEncrypted: vault.encrypt('PASS-DEMO')
      });
      const signal = new AbortController().signal;
      const session = await createService().openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 0 },
        signal
      );
      await expect(session.acquireOne('w1', signal)).rejects.toMatchObject({
        code: 'CONFIG_ERROR'
      });
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
      expect(dongvan.buyCalls).toBe(0);
    });

    it('B06 refuses a mailbox already bound to another account before delivery', async () => {
      const ledger = new AccountMutationRepository(db);
      ledger.registerApproval({
        authorityRef: 'auth-r',
        budgetOwnerRef: 'budget-r',
        provider: 'dongvanfb',
        approvedUnits: 2
      });
      const service = new EmailPurchaseService(
        credRepo,
        purchasedRepo,
        vault,
        { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
        {
          nextId: () => 'pe-' + ++idCounter,
          mutationContext: {
            repository: ledger,
            authorityRef: 'auth-r',
            budgetOwnerRef: 'budget-r'
          }
        }
      );
      storeKey('dongvanfb', 'DV-DEMO');
      dongvan.rows = [[{
        email: 'a@example.test',
        password: 'p',
        refreshToken: 'r',
        clientId: 'c',
        raw: 'fixture'
      }]];
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession(
        'dongvanfb',
        1,
        { maxBillablePurchases: 1 },
        signal
      );
      const first = await session.acquireOne('w1', signal, {
        ownerRef: 'owner-A',
        runId: 'run-A',
        stepAttemptId: 'attempt-A'
      });
      session.bindAccount!(first, 'account-A');
      session.release(first);
      await expect(
        session.acquireOne('w2', signal, {
          ownerRef: 'owner-B',
          runId: 'run-B',
          stepAttemptId: 'attempt-B'
        })
      ).rejects.toMatchObject({
        reason: {
          code: 'PROVIDER_CONFIG_ERROR',
          details: { accountId: 'account-A' }
        }
      });
      expect(dongvan.buyCalls).toBe(1);
      expect(ledger.getBinding('owner-A')?.accountId).toBe('account-A');
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
    });

    it.each(['observer', 'settlement'] as const)(
      'R01/R03 keeps paid row and releases undelivered reservation on %s failure',
      async point => {
        storeKey('dongvanfb', 'DV-DEMO');
        const ledger = new AccountMutationRepository(db);
        ledger.registerApproval({
          authorityRef: 'auth-paid',
          budgetOwnerRef: 'budget-paid',
          provider: 'dongvanfb',
          approvedUnits: 2
        });
        const failure = new Error('fixture-' + point);
        const settle = vi.spyOn(ledger, 'settleIntent');
        if (point === 'settlement') settle.mockImplementationOnce(() => { throw failure; });
        dongvan.rows = [[{
          email: 'paid@example.test',
          password: 'PASS-DEMO',
          refreshToken: null,
          clientId: null,
          raw: 'fixture'
        }]];
        const service = new EmailPurchaseService(
          credRepo,
          purchasedRepo,
          vault,
          { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
          {
            nextId: () => 'pe-' + ++idCounter,
            mutationContext: { repository: ledger, authorityRef: 'auth-paid', budgetOwnerRef: 'budget-paid' }
          }
        );
        const signal = new AbortController().signal;
        const session = await service.openAcquisitionSession('dongvanfb', 1, {
          maxBillablePurchases: 2,
          onPurchaseEvent: event => {
            if (point === 'observer' && event.outcome === 'confirmed') throw failure;
          }
        }, signal);
        try {
          await expect(session.acquireOne('w1', signal, {
            ownerRef: 'owner-paid',
            runId: 'run-paid',
            stepAttemptId: 'attempt-paid'
          })).rejects.toBe(failure);
          expect(purchasedRepo.listRecent(10)).toHaveLength(1);
          expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
          expect(dongvan.buyCalls).toBe(1);
          expect(dongvan.oauthCalls).toEqual([]);
          expect(session.purchaseStats()).toMatchObject({ attempted: 1, confirmed: 1 });
          expect(ledger.getIntent('auth-paid', 'purchase:owner-paid:attempt-paid')?.state)
            .toBe(point === 'settlement' ? 'outcome-unknown' : 'effect-confirmed');
        } finally {
          settle.mockRestore();
        }
      }
    );

    it('R02 never delivers a fresh mailbox after OAuth CAS loses ownership', async () => {
      storeKey('dongvanfb', 'DV-DEMO');
      dongvan.rows = [[{
        email: 'cas@example.test',
        password: 'PASS-DEMO',
        refreshToken: null,
        clientId: null,
        raw: 'fixture'
      }]];
      let other: ReturnType<PurchasedEmailRepository['reserveOldestAvailable']> = null;
      const oauth = vi.spyOn(dongvan, 'getOauth2').mockImplementationOnce(async () => {
        purchasedRepo.clearStaleReservations(); // isolated test DB only
        other = purchasedRepo.reserveOldestAvailable('dongvanfb', 'other-owner');
        return { refreshToken: 'REFRESH-DEMO', clientId: 'CLIENT-DEMO' };
      });
      const signal = new AbortController().signal;
      const session = await createService().openAcquisitionSession('dongvanfb', 1,
        { maxBillablePurchases: 1 }, signal);
      try {
        await expect(session.acquireOne('original', signal)).rejects.toMatchObject({
          state: 'failed',
          reason: { code: 'INTERNAL_ERROR' }
        });
        expect(other).not.toBeNull();
        expect(purchasedRepo.countAvailable('dongvanfb')).toBe(0);
        expect(purchasedRepo.consumeReserved(other!.id, 'other-owner', null)).toBe(true);
        expect(dongvan.buyCalls).toBe(1);
      } finally {
        oauth.mockRestore();
      }
    });

    it('R01 wraps in AggregateError when both delivery and reservation cleanup fail', async () => {
      storeKey('dongvanfb', 'DV-DEMO');
      const failure = new Error('fixture-observer');
      const cleanupError = new Error('fixture-cleanup-fail');
      const releaseSpy = vi.spyOn(purchasedRepo, 'releaseReservation').mockImplementationOnce(() => {
        throw cleanupError;
      });
      dongvan.rows = [[{
        email: 'cleanup-fail@example.test',
        password: 'PASS-DEMO',
        refreshToken: null,
        clientId: null,
        raw: 'fixture'
      }]];
      const service = createService();
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('dongvanfb', 1, {
        maxBillablePurchases: 1,
        onPurchaseEvent: event => {
          if (event.outcome === 'confirmed') throw failure;
        }
      }, signal);
      try {
        const thrown = await session.acquireOne('w1', signal).catch(err => err);
        expect(thrown).toBeInstanceOf(AggregateError);
        expect((thrown as AggregateError).errors).toEqual([failure, cleanupError]);
        expect(purchasedRepo.listRecent(10)).toHaveLength(1);
      } finally {
        releaseSpy.mockRestore();
      }
    });

    it('R01 keeps paid row and releases undelivered reservation on Gmail94 observer failure', async () => {
      storeKey('gmail94', 'GM-DEMO');
      const failure = new Error('fixture-gmail-observer');
      gmail.profile = { name: null, email: null, balance: 10000 };
      gmail.services = [{ id: 29, slug: CAPCUT_OTP_SERVICE, name: 'CapCut', price: 1000 }];
      const service = createService();
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('gmail94', 1, {
        maxBillablePurchases: 1,
        onPurchaseEvent: event => {
          if (event.outcome === 'confirmed') throw failure;
        }
      }, signal);
      await expect(session.acquireOne('w1', signal)).rejects.toBe(failure);
      expect(purchasedRepo.listRecent(10)).toHaveLength(1);
      expect(purchasedRepo.countAvailable('gmail94', CAPCUT_OTP_SERVICE)).toBe(1);
      expect(gmail.createCalls).toHaveLength(1);
      expect(session.purchaseStats()).toMatchObject({ attempted: 1, confirmed: 1 });
    });

    it('R04 uses a distinct approved intent for confirmed-stock retry', async () => {
      storeKey('gmail94', 'GM-DEMO');
      const service = createFencedService();
      const ledger = new AccountMutationRepository(db);
      const recorded = vi.spyOn(AccountMutationRepository.prototype, 'recordIntent');
      gmail.orderFailures = [new ConfirmedOutOfStockError('gmail94')];
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('gmail94', 1,
        { maxBillablePurchases: 1, emailRetryIntervalMs: 0 }, signal);
      try {
        const result = await session.acquireOne('w1', signal, {
          ownerRef: 'stock-owner', runId: 'stock-run', stepAttemptId: 'stock-attempt'
        });
        const [first, second] = recorded.mock.calls.map(call => call[0]);
        expect(gmail.createCalls).toHaveLength(2);
        expect(first.stepAttemptId).toBe('stock-attempt');
        expect(second.stepAttemptId).not.toBe(first.stepAttemptId);
        expect(second.operationKey).not.toBe(first.operationKey);
        expect(second.ownerRef).toBe(first.ownerRef);
        expect(ledger.getIntent('auth-test', first.operationKey)?.state).toBe('no-effect-confirmed');
        expect(ledger.getIntent('auth-test', second.operationKey)?.state).toBe('effect-confirmed');
        expect(ledger.getApproval('auth-test')?.consumedUnits).toBe(2);
        expect(session.purchaseStats()).toEqual({ budget: 1, attempted: 1, confirmed: 1, ambiguous: 0 });
        session.release(result);
      } finally {
        recorded.mockRestore();
      }
    });

    it('R04 halts when approval is exhausted after confirmed-stock attempt', async () => {
      storeKey('gmail94', 'GM-DEMO');
      const mutationRepo = new AccountMutationRepository(db);
      mutationRepo.registerApproval({
        authorityRef: 'auth-1unit',
        budgetOwnerRef: 'budget-1unit',
        provider: 'gmail94',
        approvedUnits: 1
      });
      const service = new EmailPurchaseService(
        credRepo,
        purchasedRepo,
        vault,
        { gmail94: gmail, dongvanfb: dongvan, customdomain: customDomain },
        {
          nextId: () => 'pe-' + ++idCounter,
          mutationContext: {
            repository: mutationRepo,
            authorityRef: 'auth-1unit',
            budgetOwnerRef: 'budget-1unit'
          }
        }
      );
      gmail.orderFailures = [new ConfirmedOutOfStockError('gmail94')];
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('gmail94', 1,
        { maxBillablePurchases: 2, emailRetryIntervalMs: 0 }, signal);
      await expect(session.acquireOne('w1', signal, {
        ownerRef: 'stock-owner', runId: 'stock-run', stepAttemptId: 'stock-attempt'
      })).rejects.toThrow('Diagnostic approval has no remaining units.');
      expect(gmail.createCalls).toHaveLength(1);
      expect(mutationRepo.getIntent('auth-1unit', 'purchase:stock-owner:stock-attempt')?.state).toBe('no-effect-confirmed');
    });

    it('R04 treats generic OUT_OF_STOCK without confirmed marker as ambiguous in fenced session', async () => {
      storeKey('gmail94', 'GM-DEMO');
      const service = createFencedService();
      const ledger = new AccountMutationRepository(db);
      gmail.orderFailures = [new ProviderError('OUT_OF_STOCK', 'generic out of stock', 'gmail94')];
      const signal = new AbortController().signal;
      const session = await service.openAcquisitionSession('gmail94', 1,
        { maxBillablePurchases: 2, emailRetryIntervalMs: 0 }, signal);
      await expect(session.acquireOne('w1', signal, {
        ownerRef: 'stock-owner', runId: 'stock-run', stepAttemptId: 'stock-attempt'
      })).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'PURCHASE_OUTCOME_UNKNOWN' }
      });
      expect(gmail.createCalls).toHaveLength(1);
      expect(ledger.getIntent('auth-test', 'purchase:stock-owner:stock-attempt')?.state).toBe('outcome-unknown');
    });

  });
});
