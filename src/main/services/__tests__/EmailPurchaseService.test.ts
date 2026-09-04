import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  public failAfter = Number.POSITIVE_INFINITY;
  private counter = 0;

  async createOtpOrder(token: string, service: string): Promise<{ email: string; orderId: string }> {
    this.createCalls.push({ token, service });
    this.counter += 1;
    if (this.counter > this.failAfter) throw new Error('quota exhausted');
    return { email: 'mail' + this.counter + '@gmail.com', orderId: 'order-' + this.counter };
  }

  async readOtp(_token: string, orderId: string, _service: string): Promise<string | null> {
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
  dongvan = new StubDongVanFB();
  customDomain = new StubCustomDomain();
  idCounter = 0;
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EmailPurchaseService.purchase with Gmail94', () => {
  it('rents one mailbox per thread and stores every order id', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    const result = await service.purchase('gmail94', 3, { service: 'facebook' });

    expect(result.failures).toEqual([]);
    expect(result.purchased.map((row) => row.email)).toEqual([
      'mail1@gmail.com', 'mail2@gmail.com', 'mail3@gmail.com'
    ]);
    expect(result.purchased.map((row) => row.orderId)).toEqual(['order-1', 'order-2', 'order-3']);
    expect(gmail.createCalls.every((call) => call.token === 'GM-KEY')).toBe(true);
    expect(purchasedRepo.listUnconsumed('gmail94', 10)).toHaveLength(3);
  });

  it('keeps the mailboxes it managed to rent and reports the rest as failures', async () => {
    storeKey('gmail94', 'GM-KEY');
    gmail.failAfter = 2;
    const service = createService();

    const result = await service.purchase('gmail94', 4, { service: 'facebook' });

    expect(result.purchased).toHaveLength(2);
    expect(result.failures).toHaveLength(2);
  });

  it('refuses to purchase when the provider has no api key configured', async () => {
    const service = createService();
    await expect(service.purchase('gmail94', 1, {})).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  /**
   * Slug mặc định phải là `capcut`, không phải `facebook`: gmail94 thuê hộp thư
   * THEO dịch vụ, và `otp/read` lọc mã theo đúng slug đã thuê. Thuê hộp
   * `facebook` rồi chờ mã CapCut là chờ mãi mãi.
   */
  it('defaults the service slug to capcut when none is supplied', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    await service.purchase('gmail94', 1, {});

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
    const service = createService();

    // Lượt trước thuê 2 hộp và không dùng hộp nào.
    await service.purchase('gmail94', 2, {});
    expect(gmail.createCalls).toHaveLength(2);

    const again = await service.purchase('gmail94', 2, {});

    // Không gọi vendor lần nào nữa, và trả về đúng hai hộp cũ kèm order id cũ.
    expect(gmail.createCalls).toHaveLength(2);
    expect(again.purchased.map((row) => row.email)).toEqual(['mail1@gmail.com', 'mail2@gmail.com']);
    expect(again.purchased.map((row) => row.orderId)).toEqual(['order-1', 'order-2']);
  });

  it('chỉ thuê thêm cho phần còn thiếu', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    await service.purchase('gmail94', 1, {});
    const result = await service.purchase('gmail94', 3, {});

    // 1 hộp dùng lại + 2 hộp thuê mới = 3 lần gọi vendor tổng cộng.
    expect(gmail.createCalls).toHaveLength(3);
    expect(result.purchased).toHaveLength(3);
  });

  it('hộp thư đã tiêu thì KHÔNG dùng lại', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    const first = await service.purchase('gmail94', 1, {});
    // accountId null: bảng `purchased_emails` có FK sang `accounts`, và test này
    // không dựng account nào — điều được kiểm là cờ `consumed_at`.
    service.markConsumed(first.purchased[0].id, null);

    await service.purchase('gmail94', 1, {});

    expect(gmail.createCalls).toHaveLength(2);
  });

  /**
   * Nhả lại hộp thư khi luồng chết trước khi dùng tới nó: `AutomationRunService`
   * gọi `markConsumed` ngay lúc tạo account, tức là TRƯỚC khi browser mở, nên
   * browser lỗi là hộp thư bị đánh dấu đã tiêu mà chưa dùng gì.
   */
  it('release đưa hộp thư chưa dùng trở lại hàng chờ', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();

    const first = await service.purchase('gmail94', 1, {});
    service.markConsumed(first.purchased[0].id, null);
    service.release(first.purchased[0].id);

    const again = await service.purchase('gmail94', 1, {});

    expect(gmail.createCalls).toHaveLength(1);
    expect(again.purchased[0].orderId).toBe('order-1');
  });
});

describe('EmailPurchaseService.purchase with DongVanFB', () => {
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

    const result = await service.purchase('dongvanfb', 1, {});

    expect(result.purchased[0]).toEqual({
      id: 'pe-1',
      provider: 'dongvanfb',
      email: 'a@hotmail.com',
      hasPassword: true,
      hasOauth: true,
      orderId: null,
      service: null,
      purchasedAt: expect.any(String),
      consumedAt: null
    });
    expect(JSON.stringify(result.purchased)).not.toContain('Pa55');
    expect(JSON.stringify(result.purchased)).not.toContain('r-1');

    const secrets = purchasedRepo.getSecretsById('pe-1');
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

    await service.purchase('dongvanfb', 1, {});

    expect(dongvan.oauthCalls).toEqual(['b@hotmail.com']);
    const secrets = purchasedRepo.getSecretsById('pe-1');
    expect(vault.decrypt(secrets?.refreshTokenEncrypted as Buffer)).toBe('fetched-refresh');
    expect(secrets?.clientId).toBe('fetched-client');
  });

  it('does not call the OAuth2 endpoint when the pair already arrived', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      { email: 'c@hotmail.com', password: 'pw', refreshToken: 'r', clientId: 'c', raw: 'c@hotmail.com|pw|r|c' }
    ]];
    const service = createService();

    await service.purchase('dongvanfb', 1, {});

    expect(dongvan.oauthCalls).toEqual([]);
  });

  it('issues one buy call per requested mailbox', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [
      [{ email: 'd1@hotmail.com', password: 'p', refreshToken: 'r', clientId: 'c', raw: 'd1' }],
      [{ email: 'd2@hotmail.com', password: 'p', refreshToken: 'r', clientId: 'c', raw: 'd2' }]
    ];
    const service = createService();

    const result = await service.purchase('dongvanfb', 2, {});

    expect(dongvan.buyCalls).toBe(2);
    expect(result.purchased).toHaveLength(2);
  });
});

describe('EmailPurchaseService.readOtp', () => {
  it('reads a Gmail94 code using the stored order id and service', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    await service.purchase('gmail94', 1, { service: 'tiktok' });
    gmail.otpByOrder.set('order-1', '445566');

    await expect(service.readOtp('pe-1')).resolves.toBe('445566');
  });

  it('returns null while the Gmail94 mailbox has no code yet', async () => {
    storeKey('gmail94', 'GM-KEY');
    const service = createService();
    await service.purchase('gmail94', 1, {});

    await expect(service.readOtp('pe-1')).resolves.toBeNull();
  });

  it('reads a DongVanFB code through oauth2 first', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      { email: 'e@hotmail.com', password: 'p', refreshToken: 'r', clientId: 'c', raw: 'e' }
    ]];
    dongvan.oauth2Code = '778899';
    const service = createService();
    await service.purchase('dongvanfb', 1, {});

    await expect(service.readOtp('pe-1', 'facebook')).resolves.toBe('778899');
    expect(dongvan.codeCalls.map((call) => call.mode)).toEqual(['oauth2']);
  });

  it('falls back to the graph endpoint when oauth2 returns nothing', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    dongvan.rows = [[
      { email: 'f@hotmail.com', password: 'p', refreshToken: 'r', clientId: 'c', raw: 'f' }
    ]];
    dongvan.graphOnlyCode = '112233';
    const service = createService();
    await service.purchase('dongvanfb', 1, {});

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

    const result = await service.purchase('customdomain', 4, {});

    expect(result.failures).toEqual([]);
    expect(result.purchased).toHaveLength(4);
    for (const row of result.purchased) {
      expect(row.email.endsWith('@oldevlk.com')).toBe(true);
      expect(row.provider).toBe('customdomain');
      expect(row.hasPassword).toBe(false);
      expect(row.hasOauth).toBe(false);
      expect(row.orderId).toBeNull();
    }
    expect(gmail.createCalls).toHaveLength(0);
    expect(dongvan.buyCalls).toBe(0);
  });

  it('không cần API key nào để dùng domain tự sở hữu', async () => {
    const service = createService();
    await expect(service.purchase('customdomain', 1, {})).resolves.toMatchObject({ failures: [] });
  });

  it('mỗi địa chỉ sinh ra là khác nhau', async () => {
    const service = createService();

    const result = await service.purchase('customdomain', 12, {});

    expect(new Set(result.purchased.map((row) => row.email)).size).toBe(12);
  });

  it('lưu địa chỉ vào DB để đọc OTP về sau', async () => {
    const service = createService();

    await service.purchase('customdomain', 2, {});

    expect(purchasedRepo.listUnconsumed('customdomain', 10)).toHaveLength(2);
  });

  it('đọc OTP qua base url và bộ lọc người gửi trong cài đặt', async () => {
    const service = createService();
    const bought = await service.purchase('customdomain', 1, {});
    const address = bought.purchased[0].email;
    customDomain.otpByAddress.set(address, '260973');

    await expect(service.readOtp(bought.purchased[0].id)).resolves.toBe('260973');
    expect(customDomain.otpCalls[0]).toEqual({
      baseUrl: 'http://103.116.38.76:3000',
      address,
      sender: 'capcut'
    });
  });

  it('trả null khi hộp thư chưa có mã', async () => {
    const service = createService();
    const bought = await service.purchase('customdomain', 1, {});

    await expect(service.readOtp(bought.purchased[0].id)).resolves.toBeNull();
  });
});
