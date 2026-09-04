/**
 * =============================================================================
 * HỘP THƯ VỪA THUÊ ⇒ ĐI ĐƯỜNG ĐĂNG KÝ
 * =============================================================================
 * Hai mắt xích của cùng một quyết định:
 *
 *   1. `AutomationRunService` biết email của luồng đến từ đâu — có
 *      `purchasedEmailId` nghĩa là vừa thuê/mua, nên account CHƯA tồn tại trên
 *      CapCut. Nó phải nói điều đó cho engine bằng `isNewAccount`.
 *   2. `CapcutEngineService` dịch cờ đó thành `forceSignup` của `ensureInApp`.
 *
 * Vì sao phải khoá lại bằng test: trước 04/09/2026 engine luôn truyền
 * `source: 'db'`, nên `looksExisting()` trả true và MỌI account — kể cả hộp thư
 * vừa thuê — đi đường ĐĂNG NHẬP trước. `loginCapcut` chạy tới heading
 * "Create an account" rồi ném lỗi (`capcut/login.ts`), bị `.catch` ở
 * `capcut/auth.ts` bắt, rồi mới quay lại đăng ký: mất ~60 giây và in một dòng
 * lỗi giả cho mỗi account mới.
 * =============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import {
  AutomationRunService,
  type CapcutAccountResult,
  type CapcutTaskRunner,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IEmailSourceApi,
  type IProxyLeaseSource,
  type StartedProfile
} from '../AutomationRunService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
import { LogBus, type ILogSink } from '../LogBus';
import {
  AutomationRunConfigSchema,
  type AutomationRunConfigDTO
} from '../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';
import type { EmailPurchaseResult } from '../EmailPurchaseService';
import type { PurchasedEmailDTO } from '../../../shared/schemas/provider.schema';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';

class CollectingSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void { this.rows.push(...logs); }
}

function purchasedRow(index: number): PurchasedEmailDTO {
  return {
    id: 'pe-' + index,
    provider: 'gmail94',
    email: 'mail' + index + '@gmail.com',
    hasPassword: false,
    hasOauth: false,
    orderId: 'order-' + index,
    service: 'capcut',
    purchasedAt: '2026-09-04T05:00:00.000Z',
    consumedAt: null
  };
}

class StubEmailSource implements IEmailSourceApi {
  /** Số lượt `readOtp` đầu tiên trả null (mail chưa tới). */
  public silentReads = 0;
  public readCalls = 0;
  public readError: Error | null = null;

  async purchase(_provider: string, count: number): Promise<EmailPurchaseResult> {
    return {
      purchased: Array.from({ length: count }, (_unused, i) => purchasedRow(i + 1)),
      failures: []
    };
  }
  markConsumed(): void {}

  async readOtp(): Promise<string | null> {
    this.readCalls += 1;
    if (this.readError && this.readCalls === 1) throw this.readError;
    return this.readCalls > this.silentReads ? '123456' : null;
  }
}

class StubProxySource implements IProxyLeaseSource {
  async acquire(): Promise<AcquiredProxyLease> {
    throw new Error('test này chạy Direct IP nên không xin proxy');
  }
  async release(): Promise<void> {}
  async releaseAll(): Promise<void> {}
}

class StubBrowserRuntime implements IBrowserRuntimeApi {
  async startProfile(): Promise<StartedProfile> {
    throw new Error('test này đi qua launcher, không dùng startProfile');
  }
  async stopProfile(): Promise<void> {}
}

class StubAccounts implements IAccountSink {
  private counter = 0;
  create(): { id: string } {
    this.counter += 1;
    return { id: 'acc-' + this.counter };
  }
  update(): { success: boolean } { return { success: true }; }
}

class StubLauncher implements BrowserLauncher {
  public readonly name = 'xcli' as const;
  private counter = 0;
  async launch(): Promise<LaunchedProfile> {
    this.counter += 1;
    return {
      page: {} as unknown as Page,
      context: {} as unknown as BrowserContext,
      port: 61000 + this.counter,
      profileId: 'profile-' + this.counter
    };
  }
  async stop(): Promise<void> {}
}

type RunAccountInput = Parameters<CapcutTaskRunner['runAccount']>[0];

class RecordingCapcutRunner implements CapcutTaskRunner {
  public lastInput: RunAccountInput | null = null;
  /** Bật để mô phỏng engine gọi `getOtp` trong lúc đăng ký. */
  public callOtp = false;
  public otpResult: string | null = null;
  public otpError: Error | null = null;

  async runAccount(input: RunAccountInput): Promise<CapcutAccountResult> {
    this.lastInput = input;
    if (this.callOtp && input.getOtp) {
      try {
        this.otpResult = await input.getOtp();
      } catch (err: unknown) {
        this.otpError = err as Error;
      }
    }
    return { done: 0, total: 0, credits: 0, creditsTotal: 0, missing: [], tasks: [] };
  }
}

function baseConfig(overrides: Partial<AutomationRunConfigDTO> = {}): AutomationRunConfigDTO {
  return AutomationRunConfigSchema.parse({
    threadCount: 1,
    browser: 'multilogin',
    headless: false,
    retryCount: 0,
    stepDelayMinMs: 0,
    stepDelayMaxMs: 0,
    typeDelayMinMs: 0,
    typeDelayMaxMs: 0,
    module: 'credit',
    skipWithoutTrial: false,
    emailSource: { mode: 'api', provider: 'gmail94' },
    proxy: { mode: 'direct', entries: [] },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    testDurationMs: 0,
    ...overrides
  });
}

let runner: RecordingCapcutRunner;
let emails: StubEmailSource;
let logs: CanonicalRuntimeLog[];
let logBus: LogBus;

function createService(): AutomationRunService {
  return new AutomationRunService(
    {
      emails,
      proxies: new StubProxySource(),
      browser: new StubBrowserRuntime(),
      accounts: new StubAccounts(),
      logBus,
      launcher: () => new StubLauncher(),
      capcut: runner
    },
    { sleep: async () => {}, nextId: () => 'run-1' }
  );
}

beforeEach(() => {
  runner = new RecordingCapcutRunner();
  emails = new StubEmailSource();
  logs = [];
  logBus = new LogBus(new CollectingSink(), { maxBatchSize: 1000 });
  logBus.subscribe((row) => logs.push(row));
});

describe('AutomationRunService nói cho engine biết account có mới hay không', () => {
  it('hộp thư vừa thuê từ vendor ⇒ isNewAccount', async () => {
    const service = createService();

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.lastInput?.isNewAccount).toBe(true);
  });

  it('email dán tay ⇒ không phải account mới', async () => {
    const service = createService();

    await service.start(baseConfig({
      emailSource: { mode: 'manual', entries: ['old@example.com|mail-pass'] }
    }));
    await service.waitForCompletion();

    expect(runner.lastInput?.isNewAccount).toBe(false);
  });
});

/**
 * Vòng chờ OTP dài tới 90 giây. Trước 04/09/2026 nó không in gì trong suốt thời
 * gian đó, nên khi hết hạn không ai biết là mail chưa tới hay API mail lỗi — mà
 * mỗi lần hết hạn là mất một hộp thư đã trả tiền.
 */
describe('vòng chờ OTP nói ra nó đang chờ gì', () => {
  it('in một dòng cho mỗi lượt chưa có mã, và mốc thời gian khi mã về', async () => {
    emails.silentReads = 2;
    runner.callOtp = true;
    const service = createService();

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.otpResult).toBe('123456');
    const otpLogs = logs.filter((row) => row.step === 'OTP');
    expect(otpLogs.filter((row) => row.message.includes('Chưa có mã'))).toHaveLength(2);
    expect(otpLogs.filter((row) => row.status === 'SUCCESS')).toHaveLength(1);
  });

  it('in lỗi của API mail ngay lượt đó thay vì nuốt tới khi hết hạn', async () => {
    emails.readError = new Error('HTTP 500 từ gmail94');
    runner.callOtp = true;
    const service = createService();

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.otpResult).toBe('123456');
    expect(
      logs.some((row) => row.step === 'OTP' && row.status === 'WARNING' && row.message.includes('HTTP 500'))
    ).toBe(true);
  });

  it('gắn mọi dòng OTP vào đúng account của luồng', async () => {
    emails.silentReads = 1;
    runner.callOtp = true;
    const service = createService();

    await service.start(baseConfig());
    await service.waitForCompletion();

    const otpLogs = logs.filter((row) => row.step === 'OTP');
    expect(otpLogs.length).toBeGreaterThan(0);
    expect(otpLogs.every((row) => row.accountId === 'acc-1')).toBe(true);
    expect(otpLogs.every((row) => row.email === 'mail1@gmail.com')).toBe(true);
  });
});
