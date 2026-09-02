import { describe, it, expect } from 'vitest';

import { isEligible, MIN_TRIAL_DAYS, type TrialInfo } from '../trial';

const base: TrialInfo = {
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

  it('FAIL-OPEN: không đọc được thì coi là đủ điều kiện, không âm thầm bỏ qua', () => {
    // Một trục trặc giao diện thoáng qua không được phép giết cả batch — đúng bài
    // học từ lượt 2026-09-02 05:56 khi waitForSnapshot ném và 19 account chết sạch.
    const broken: TrialInfo = {
      canTrial: false,
      days: 0,
      trialPrice: '',
      listPrice: '',
      hasStartButton: false,
      error: 'không mở được modal nâng cấp',
    };
    expect(isEligible(broken)).toBe(true);
  });

  it('MIN_TRIAL_DAYS đúng bằng 7 như yêu cầu', () => {
    expect(MIN_TRIAL_DAYS).toBe(7);
  });
});
