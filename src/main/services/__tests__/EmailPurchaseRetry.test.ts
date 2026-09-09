import { describe, it, expect, vi } from 'vitest';
import { EmailPurchaseService } from '../EmailPurchaseService';
import { ProviderError } from '../../providers/ProviderError';
import { AutomationTerminalError } from '../AutomationTerminalError';
import type { CredentialRepository } from '../../repositories/CredentialRepository';
import type { PurchasedEmailRepository } from '../../repositories/PurchasedEmailRepository';
import type { ICredentialVault } from '../../security/CredentialVault';

describe('EmailPurchaseService Polling & Retry on OUT_OF_STOCK', () => {
  function createMockSetup() {
    const credRepo = {
      getCredential: vi.fn().mockReturnValue({
        encryptedData: 'ENCRYPTED_KEY',
        maskedHint: '••••••••',
        status: 'valid'
      })
    } as unknown as CredentialRepository;

    const vault: ICredentialVault = {
      isAvailable: () => true,
      encrypt: (val: string) => Buffer.from(`ENC(${val})`),
      decrypt: (_val: Buffer) => 'TEST_TOKEN'
    };

    const purchasedRepo = {
      reserveOldestAvailable: vi.fn().mockReturnValue(null),
      countAvailable: vi.fn().mockReturnValue(0),
      insertReserved: vi.fn().mockImplementation((input, _resId) => ({
        ...input,
        allocatedToAccount: null,
        usedAt: null,
        expiresAt: null
      }))
    } as unknown as PurchasedEmailRepository;

    const gmail94Api = {
      getProfile: vi.fn().mockResolvedValue({ name: 'User', email: 'u@gmail.com', balance: 50_000 }),
      listServices: vi.fn().mockResolvedValue([{ id: 1, name: 'CapCut', slug: 'capcut', price: 1000 }]),
      createOtpOrder: vi.fn(),
      readOtp: vi.fn()
    };

    const dongvanfbApi = {
      buyMail: vi.fn(),
      getOauth2: vi.fn(),
      readCode: vi.fn()
    };

    const customdomainApi = {
      readOtp: vi.fn()
    };

    const service = new EmailPurchaseService(
      credRepo,
      purchasedRepo,
      vault,
      { gmail94: gmail94Api, dongvanfb: dongvanfbApi, customdomain: customdomainApi },
      { nextId: () => 'pe-test-1' }
    );

    return { service, gmail94Api, dongvanfbApi, purchasedRepo };
  }

  it('Gmail94: polls on OUT_OF_STOCK and succeeds when mail becomes available without consuming purchase budget prematurely', async () => {
    const { service, gmail94Api } = createMockSetup();
    const retryWaitMessages: string[] = [];

    // Attempt 1: OUT_OF_STOCK (400)
    // Attempt 2: OUT_OF_STOCK (400)
    // Attempt 3: Success
    gmail94Api.createOtpOrder
      .mockRejectedValueOnce(new ProviderError('OUT_OF_STOCK', 'Gmail94 mua email thất bại: hết email.'))
      .mockRejectedValueOnce(new ProviderError('OUT_OF_STOCK', 'Gmail94 mua email thất bại: hết email.'))
      .mockResolvedValueOnce({ email: 'fresh@gmail.com', orderId: 'ord-999' });

    const session = await service.openAcquisitionSession('gmail94', 1, {
      maxBillablePurchases: 5,
      emailRetryIntervalMs: 10, // fast in test
      onRetryWait: (msg) => retryWaitMessages.push(msg)
    }, new AbortController().signal);

    const result = await session.acquireOne('worker-1', new AbortController().signal);

    expect(result.purchasedEmail.email).toBe('fresh@gmail.com');
    expect(result.purchasedEmail.orderId).toBe('ord-999');
    expect(gmail94Api.createOtpOrder).toHaveBeenCalledTimes(3);
    expect(retryWaitMessages).toHaveLength(2);
    expect(retryWaitMessages[0]).toContain('Kho email Gmail94 tạm hết');
    expect(retryWaitMessages[0]).toContain('lần 1');
    expect(retryWaitMessages[1]).toContain('lần 2');

    // Only 1 purchase should be confirmed in stats
    const stats = session.purchaseStats();
    expect(stats.confirmed).toBe(1);
    expect(stats.attempted).toBe(1);
    expect(stats.ambiguous).toBe(0);
  });

  it('Gmail94: terminates immediately on INSUFFICIENT_FUNDS without retrying', async () => {
    const { service, gmail94Api } = createMockSetup();
    const retryWaitMessages: string[] = [];

    gmail94Api.createOtpOrder.mockRejectedValueOnce(
      new ProviderError('INSUFFICIENT_FUNDS', 'Số dư Gmail94 không đủ để mua email CapCut.')
    );

    const session = await service.openAcquisitionSession('gmail94', 1, {
      maxBillablePurchases: 5,
      emailRetryIntervalMs: 10,
      onRetryWait: (msg) => retryWaitMessages.push(msg)
    }, new AbortController().signal);

    await expect(session.acquireOne('worker-1', new AbortController().signal))
      .rejects.toThrow(AutomationTerminalError);

    expect(gmail94Api.createOtpOrder).toHaveBeenCalledTimes(1);
    expect(retryWaitMessages).toHaveLength(0);
  });

  it('DongVanFB: polls on OUT_OF_STOCK and succeeds when mail becomes available', async () => {
    const { service, dongvanfbApi } = createMockSetup();
    const retryWaitMessages: string[] = [];

    dongvanfbApi.buyMail
      .mockRejectedValueOnce(new ProviderError('OUT_OF_STOCK', 'DongVanFB mua email không trả về tài khoản nào.'))
      .mockResolvedValueOnce([{
        email: 'dv@hotmail.com',
        password: 'pass',
        refreshToken: 'rf-token',
        clientId: 'cid-1'
      }]);

    const session = await service.openAcquisitionSession('dongvanfb', 1, {
      maxBillablePurchases: 5,
      emailRetryIntervalMs: 10,
      onRetryWait: (msg) => retryWaitMessages.push(msg)
    }, new AbortController().signal);

    const result = await session.acquireOne('worker-1', new AbortController().signal);

    expect(result.purchasedEmail.email).toBe('dv@hotmail.com');
    expect(dongvanfbApi.buyMail).toHaveBeenCalledTimes(2);
    expect(retryWaitMessages).toHaveLength(1);
    expect(retryWaitMessages[0]).toContain('Kho email DongVanFB tạm hết');
    expect(session.purchaseStats().confirmed).toBe(1);
  });

  it('DongVanFB: terminates immediately on INSUFFICIENT_FUNDS without retrying', async () => {
    const { service, dongvanfbApi } = createMockSetup();
    const retryWaitMessages: string[] = [];

    dongvanfbApi.buyMail.mockRejectedValueOnce(
      new ProviderError('INSUFFICIENT_FUNDS', 'DongVanFB mua email thất bại: không đủ tiền.')
    );

    const session = await service.openAcquisitionSession('dongvanfb', 1, {
      maxBillablePurchases: 5,
      emailRetryIntervalMs: 10,
      onRetryWait: (msg) => retryWaitMessages.push(msg)
    }, new AbortController().signal);

    await expect(session.acquireOne('worker-1', new AbortController().signal))
      .rejects.toThrow(AutomationTerminalError);

    expect(dongvanfbApi.buyMail).toHaveBeenCalledTimes(1);
    expect(retryWaitMessages).toHaveLength(0);
  });

  it('Aborts immediately if user cancels while waiting for restock', async () => {
    const { service, gmail94Api } = createMockSetup();
    const controller = new AbortController();

    gmail94Api.createOtpOrder.mockImplementation(async () => {
      throw new ProviderError('OUT_OF_STOCK', 'Hết email');
    });

    const session = await service.openAcquisitionSession('gmail94', 1, {
      maxBillablePurchases: 5,
      emailRetryIntervalMs: 5000,
      onRetryWait: () => {
        // User clicks stop during wait
        setTimeout(() => controller.abort(), 10);
      }
    }, new AbortController().signal);

    await expect(session.acquireOne('worker-1', controller.signal))
      .rejects.toThrow();
  });
});
