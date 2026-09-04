/**
 * =============================================================================
 * CAPCUT ENGINE SERVICE — DỊCH `isNewAccount` THÀNH `forceSignup`
 * =============================================================================
 * File này khoá lại đúng một quyết định: engine service phải nói cho
 * `ensureInApp` biết account có mới hay không, thay vì để `looksExisting()` đoán
 * từ `source: 'db'` (luôn ra "đã tồn tại", nên hộp thư vừa thuê cũng bị đẩy vào
 * đường ĐĂNG NHẬP trước — xem `capcutSignupPath.test.ts`).
 *
 * Bốn module của engine bị `vi.mock` vì chúng đều cần một `Page` Playwright thật;
 * cái được kiểm là tham số `runAccount` truyền xuống, không phải hành vi của mock.
 * =============================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

const ensureInApp = vi.fn();
const checkProTrial = vi.fn();
const isEligible = vi.fn();
const ensureSampleImage = vi.fn();
const runAllTasks = vi.fn();
const setDumpDir = vi.fn();

vi.mock('../capcut/auth', () => ({
  ensureInApp: (...args: unknown[]) => ensureInApp(...args)
}));
vi.mock('../capcut/trial', () => ({
  MIN_TRIAL_DAYS: 7,
  checkProTrial: (...args: unknown[]) => checkProTrial(...args),
  isEligible: (...args: unknown[]) => isEligible(...args)
}));
vi.mock('../capcut/image', () => ({
  ensureSampleImage: (...args: unknown[]) => ensureSampleImage(...args)
}));
vi.mock('../capcut/runTasks', () => ({
  runAllTasks: (...args: unknown[]) => runAllTasks(...args)
}));
vi.mock('../capcut/diag', () => ({
  setDumpDir: (...args: unknown[]) => setDumpDir(...args)
}));

const { CapcutEngineService } = await import('../CapcutEngineService');

type AuthOptions = { forceSignup?: boolean; log: (msg: string) => void };

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    // Page giả phải có `on`: `runAccount` đăng ký nghe `close`/`crash` của tab.
    page: listeningPage().page,
    context: {} as unknown as BrowserContext,
    email: 'mail1@gmail.com',
    password: 'Str0ngPass',
    accountId: 'acc-1',
    isNewAccount: false,
    log: () => {},
    ...overrides
  } as Parameters<InstanceType<typeof CapcutEngineService>['runAccount']>[0];
}

/** Page giả chỉ ghi lại các sự kiện được đăng ký. */
function listeningPage(): { page: Page; events: string[] } {
  const events: string[] = [];
  const page = {
    on: (event: string) => {
      events.push(event);
      return page;
    }
  } as unknown as Page;
  return { page, events };
}

/** Tham số thứ 4 của `ensureInApp` — nơi `forceSignup` phải xuất hiện. */
function lastAuthOptions(): AuthOptions {
  return ensureInApp.mock.calls.at(-1)?.[3] as AuthOptions;
}

beforeEach(() => {
  ensureInApp.mockReset().mockResolvedValue({ mode: 'signup', created: true });
  checkProTrial.mockReset().mockResolvedValue({ days: 7, isPro: false });
  isEligible.mockReset().mockReturnValue(true);
  ensureSampleImage.mockReset().mockReturnValue('C:/tmp/assets/sample.png');
  runAllTasks.mockReset().mockResolvedValue({
    outcomes: [],
    snapshot: { total: 12, done: 12, credits: 1800, creditsTotal: 1800, missing: [] }
  });
  setDumpDir.mockReset();
});

describe('CapcutEngineService.runAccount', () => {
  it('bắt buộc đường ĐĂNG KÝ khi account là mới', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: true }));

    expect(lastAuthOptions().forceSignup).toBe(true);
  });

  it('không bắt buộc đăng ký khi account đã tồn tại', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: false }));

    expect(lastAuthOptions().forceSignup).toBe(false);
  });

  it('vẫn báo account đến từ DB để nhánh fallback đăng nhập không đổi', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: true }));

    expect(ensureInApp.mock.calls[0][2]).toEqual({
      email: 'mail1@gmail.com',
      password: 'Str0ngPass',
      source: 'db'
    });
  });

  /**
   * Hai lượt chạy 04/09/2026 bị cắt ngắn bởi `❌ Tab chính đã bị đóng` và
   * `Target page, context or browser has been closed`, mà không có dòng nào cho
   * biết AI đóng nó và đóng lúc nào. `page.on('crash')` phân biệt được "renderer
   * sập" với "có ai gọi close()" — hai nguyên nhân cần hai cách sửa khác nhau.
   */
  it('nghe sự kiện đóng và crash của tab chính để lần sau có địa chỉ', async () => {
    const { page, events } = listeningPage();
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ page }));

    expect(events).toContain('close');
    expect(events).toContain('crash');
  });

  /**
   * Cổng trial đọc được `gói Pro: 222,000₫ → 0₫ cho 7 ngày` và LOG ra, nhưng
   * không trả gì cho người gọi — nên hàng `accounts.subscription` rỗng và cột
   * Subscription khi xuất Excel/CSV (AGENTS.md §21) trống trơn.
   */
  it('trả về ưu đãi Pro đã đọc được để account ghi lại', async () => {
    checkProTrial.mockResolvedValue({ canTrial: true, days: 7, trialPrice: '0₫', listPrice: '222,000₫' });
    isEligible.mockReturnValue(true);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    const result = await engine.runAccount(runInput());

    expect(result.subscription).toBe('Pro trial 7 ngày');
  });

  it('nói rõ khi account không có ưu đãi, thay vì để trống', async () => {
    checkProTrial.mockResolvedValue({ canTrial: false, days: 0, trialPrice: '', listPrice: '' });
    isEligible.mockReturnValue(false);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    const result = await engine.runAccount(runInput());

    expect(result.subscription).toBe('Không có ưu đãi');
  });
});
