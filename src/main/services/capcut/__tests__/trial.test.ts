import { describe, it, expect, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

import { createDirectUiInteraction } from '../uiInteractionScheduler';
import { checkProTrial, isEligible, MIN_TRIAL_DAYS, type TrialInfo } from '../trial';

vi.mock('../diag', () => ({ dump: vi.fn(async () => 'trial-read-dump') }));

const base: TrialInfo = {
  status: 'eligible',
  canTrial: true,
  days: 7,
  trialPrice: '0₫',
  listPrice: '222,000₫',
  hasStartButton: true,
};

describe('trial', () => {
  it('đủ điều kiện: Pro 0₫ trong 7 ngày', () => {
    expect(isEligible(base)).toBe(true);
  });

  it('KHÔNG đủ điều kiện khi dưới 7 ngày', () => {
    expect(isEligible({ ...base, days: 3 })).toBe(false);
    expect(isEligible({ ...base, days: 0, canTrial: false })).toBe(false);
  });

  it('nhiều hơn 7 ngày vẫn đủ điều kiện', () => {
    expect(isEligible({ ...base, days: 14 })).toBe(true);
  });

  it('không đủ điều kiện khi kết quả đọc trial là unknown', () => {
    const broken: TrialInfo = {
      status: 'unknown',
      canTrial: false,
      days: 0,
      trialPrice: '',
      listPrice: '',
      hasStartButton: false,
      error: 'không mở được modal nâng cấp',
    };
    expect(isEligible(broken)).toBe(false);
  });

  it('không đủ điều kiện khi fallback lỗi có days=0', () => {
    expect(isEligible({
      ...base,
      status: 'unknown',
      canTrial: false,
      days: 0,
      error: 'không thấy thẻ gói Pro trong modal',
    })).toBe(false);
  });

  it('MIN_TRIAL_DAYS đúng bằng 7 như yêu cầu', () => {
    expect(MIN_TRIAL_DAYS).toBe(7);
  });
});

function trialPage(evaluateResult: unknown, evaluateRejects = false): Page {
  const page = {
    goto: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
    evaluate: evaluateRejects
      ? vi.fn(async () => { throw new Error('DOM read failed'); })
      : vi.fn(async () => evaluateResult),
    locator: vi.fn((selector: string) => {
      const isUpgradeEntry = selector === '[data-id="TitleBarUpgradeVip"]';
      const isProduct = selector === '[class*="subscriptionProduct"]';
      const locator = {
        first: () => locator,
        count: vi.fn(async () => isUpgradeEntry ? 1 : 0),
        isVisible: vi.fn(async () => isProduct),
        click: vi.fn(async () => {}),
      };
      return locator;
    }),
  };
  return page as unknown as Page;
}

describe('checkProTrial DOM boundary', () => {
  it('returns explicit unknown and cannot trial when the Pro-card DOM read fails', async () => {
    const signal = new AbortController().signal;
    const result = await checkProTrial(
      trialPage(null, true),
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(signal),
      signal
    );

    expect(result).toMatchObject({
      status: 'unknown',
      canTrial: false,
      days: 0,
      error: 'không thấy thẻ gói Pro trong modal',
    });
    expect(isEligible(result)).toBe(false);
  });

  it('preserves an observed seven-day DOM offer as eligible', async () => {
    const signal = new AbortController().signal;
    const result = await checkProTrial(
      trialPage({
        found: true,
        days: 7,
        listPrice: '222,000₫',
        trialPrice: '0₫',
        hasStartButton: true,
      }),
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(signal),
      signal
    );

    expect(result).toMatchObject({
      status: 'eligible',
      canTrial: true,
      days: 7,
      listPrice: '222,000₫',
      trialPrice: '0₫',
      hasStartButton: true,
    });
    expect(isEligible(result)).toBe(true);
  });
});
