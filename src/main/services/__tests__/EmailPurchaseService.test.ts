import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import { PurchasedEmailRepository } from '../../repositories/PurchasedEmailRepository';
import {
  EmailPurchaseService,
  type IGmail94EmailApi,
  type IDongVanFBEmailApi
} from '../EmailPurchaseService';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { DongVanPurchasedMail, DongVanCodeResult } from '../../providers/DongVanFBProvider';
import type { ICustomDomainMailApi } from '../EmailPurchaseService';
import { ProviderError } from '../../providers/ProviderError';
import type { Gmail94Profile, Gmail94Service } from '../../providers/Gmail94Provider';

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
  public orderFailures: ProviderError[] = [];
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

function createService(): EmailPurchaseService {
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
      })
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
  it('rents one mailbox per thread and stores every order id', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession('gmail94', 3, { service: 'facebook' }, signal);
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
    await expect(service.openAcquisitionSession('gmail94', 1, {}, signal)).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
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

    const session = await service.openAcquisitionSession('gmail94', 1, {}, signal);
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

    const session = await service.openAcquisitionSession('gmail94', 2, {}, signal);
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

    const session1 = await service.openAcquisitionSession('gmail94', 1, {}, signal);
    const first = await session1.acquireOne('worker-1', signal);
    db.prepare(
      "INSERT INTO accounts (id, email, email_provider) VALUES ('acc-1', 'mail1@gmail.com', 'gmail94')"
    ).run();
    session1.commit(first, 'acc-1');

    const session2 = await service.openAcquisitionSession('gmail94', 1, {}, signal);
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

    const session1 = await service.openAcquisitionSession('gmail94', 1, {}, signal);
    const first = await session1.acquireOne('worker-1', signal);
    session1.release(first);

    const session2 = await service.openAcquisitionSession('gmail94', 1, {}, signal);
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

    const session = await service.openAcquisitionSession('dongvanfb', 1, {}, signal);
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

    const session = await service.openAcquisitionSession('dongvanfb', 1, {}, signal);
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

    const session = await service.openAcquisitionSession('dongvanfb', 1, {}, signal);
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
      { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••' },
      { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••' }
    ]);
  });
});

describe('EmailPurchaseService với domain tự sở hữu', () => {
  it('tự sinh đủ số địa chỉ theo domain, không gọi vendor nào', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession('customdomain', 4, {}, signal);
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
    await expect(service.openAcquisitionSession('customdomain', 1, {}, signal)).resolves.toBeDefined();
  });

  it('mỗi địa chỉ sinh ra là khác nhau', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession('customdomain', 12, {}, signal);
    const items = await Promise.all(
      Array.from({ length: 12 }, (_, i) => session.acquireOne(`w${i}`, signal))
    );

    expect(new Set(items.map((row) => row.purchasedEmail.email)).size).toBe(12);
  });

  it('lưu địa chỉ vào DB để đọc OTP về sau', async () => {
    const service = createService();
    const signal = new AbortController().signal;

    const session = await service.openAcquisitionSession('customdomain', 2, {}, signal);
    await session.acquireOne('w1', signal);
    await session.acquireOne('w2', signal);

    expect(purchasedRepo.listRecent(10).filter((r) => r.provider === 'customdomain')).toHaveLength(2);
  });

  it('đọc OTP qua base url và bộ lọc người gửi trong cài đặt', async () => {
    const service = createService();
    const signal = new AbortController().signal;
    const session = await service.openAcquisitionSession('customdomain', 1, {}, signal);
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
    const session = await service.openAcquisitionSession('customdomain', 1, {}, signal);
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
      { service: 'capcut' },
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
      {},
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
      {},
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
      { service: 'facebook' },
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
      {},
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
      {},
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

  it('retries only transient purchase failures with 500ms and 1500ms backoff', async () => {
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
      {},
      new AbortController().signal
    );

    const acquisition = session.acquireOne('worker-1', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(gmail.createCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(gmail.createCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(gmail.createCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(acquisition).resolves.toMatchObject({
      purchasedEmail: { email: 'mail1@gmail.com' }
    });
    expect(gmail.createCalls).toHaveLength(3);
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
        {},
        new AbortController().signal
      );

      await expect(
        session.acquireOne('worker-1', new AbortController().signal)
      ).rejects.toBeInstanceOf(Error);
      expect(gmail.createCalls).toHaveLength(1);
    }
  );

  it('cancels a transient backoff before another Gmail94 order', async () => {
    vi.useFakeTimers();
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    gmail.orderFailures = [
      new ProviderError('NETWORK_ERROR', 'network', 'gmail94')
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      {},
      new AbortController().signal
    );
    const controller = new AbortController();

    const acquisition = session.acquireOne('worker-1', controller.signal);
    const expectation = expect(acquisition).rejects.toThrow('test cancellation');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('test cancellation'));
    await vi.advanceTimersByTimeAsync(500);

    await expectation;
    expect(gmail.createCalls).toHaveLength(1);
  });

  it('blocks with PROVIDER_RETRY_EXHAUSTED after exactly three transient attempts', async () => {
    vi.useFakeTimers();
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    gmail.orderFailures = [
      new ProviderError('NETWORK_ERROR', 'one', 'gmail94'),
      new ProviderError('RATE_LIMITED', 'two', 'gmail94'),
      new ProviderError('NETWORK_ERROR', 'three', 'gmail94')
    ];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      {},
      new AbortController().signal
    );

    const acquisition = session.acquireOne(
      'worker-1',
      new AbortController().signal
    );
    const expectation = expect(acquisition).rejects.toMatchObject({
      state: 'blocked',
      reason: {
        code: 'PROVIDER_RETRY_EXHAUSTED',
        provider: 'gmail94',
        details: { attempts: 3 }
      }
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expectation;
    expect(gmail.createCalls).toHaveLength(3);
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
      {},
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
  });
});
