import { describe, it, expect } from 'vitest';
import {
  AutomationRunConfigSchema,
  AutomationRunProgressSchema,
  DEFAULT_TEST_RUN_DURATION_MS
} from '../automation.schema';

const baseConfig = {
  threadCount: 3,
  browser: 'multilogin' as const,
  headless: false,
  retryCount: 3,
  stepDelayMinMs: 500,
  stepDelayMaxMs: 2000,
  typeDelayMinMs: 50,
  typeDelayMaxMs: 150,
  module: 'trial' as const,
  skipWithoutTrial: false,
  emailSource: { mode: 'api' as const, provider: 'gmail94' as const, service: 'facebook' },
  proxy: { mode: 'proxykey' as const },
  password: { mode: 'random' as const, length: 12, uppercase: true, numbers: true, special: false }
};

describe('automation.schema', () => {
  it('defaults the connectivity test duration to 10 seconds', () => {
    const parsed = AutomationRunConfigSchema.parse(baseConfig);
    expect(parsed.testDurationMs).toBe(DEFAULT_TEST_RUN_DURATION_MS);
    expect(DEFAULT_TEST_RUN_DURATION_MS).toBe(10_000);
  });

  it('requires at least one thread', () => {
    expect(AutomationRunConfigSchema.safeParse({ ...baseConfig, threadCount: 0 }).success).toBe(false);
  });

  it('rejects a delay range where min exceeds max', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      stepDelayMinMs: 3000,
      stepDelayMaxMs: 2000
    });
    expect(result.success).toBe(false);
  });

  it('requires a provider when the email source is api mode', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      emailSource: { mode: 'api' }
    });
    expect(result.success).toBe(false);
  });

  it('accepts manual email entries without a provider', () => {
    const parsed = AutomationRunConfigSchema.parse({
      ...baseConfig,
      emailSource: { mode: 'manual', entries: ['a@b.com|pass1', 'c@d.com|pass2'] }
    });
    expect(parsed.emailSource.mode).toBe('manual');
  });

  it('requires a custom password value when password mode is custom', () => {
    expect(
      AutomationRunConfigSchema.safeParse({
        ...baseConfig,
        password: { mode: 'custom', length: 12, uppercase: true, numbers: true, special: false }
      }).success
    ).toBe(false);

    expect(
      AutomationRunConfigSchema.safeParse({
        ...baseConfig,
        password: { mode: 'custom', value: 'Str0ngPass!', length: 12, uppercase: true, numbers: true, special: false }
      }).success
    ).toBe(true);
  });

  it('parses a progress event for a running batch', () => {
    const parsed = AutomationRunProgressSchema.parse({
      runId: 'run-1',
      state: 'running',
      threadTotal: 3,
      threadsStarted: 2,
      threadsStopped: 0,
      threadsFailed: 1,
      message: 'Đã khởi chạy 2/3 profile'
    });
    expect(parsed.state).toBe('running');
  });
});

describe('chọn riêng proxy key để chạy', () => {
  it('nhận danh sách key cụ thể ở chế độ proxykey', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      proxy: { mode: 'proxykey', keys: ['K48fbd08e', 'K282b6e16'] }
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.proxy).toEqual({ mode: 'proxykey', keys: ['K48fbd08e', 'K282b6e16'] });
  });

  it('để trống danh sách key thì mặc định là mảng rỗng', () => {
    const result = AutomationRunConfigSchema.safeParse({ ...baseConfig, proxy: { mode: 'proxykey' } });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.proxy).toEqual({ mode: 'proxykey', keys: [] });
  });

  it('loại bỏ key rỗng', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      proxy: { mode: 'proxykey', keys: ['K1', ''] }
    });
    expect(result.success).toBe(false);
  });

  it('nhận vùng KiotProxy kèm danh sách key', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      proxy: { mode: 'proxykey', keys: ['K1'], region: 'bac' }
    });
    expect(result.success).toBe(true);
  });

  /**
   * `random` là lựa chọn trên UI, KHÔNG phải giá trị gửi đi: nó nghĩa là không gửi
   * khoá `region` để KiotProxy tự chọn. Contract từ chối nó để không ai gửi một
   * chuỗi mà API không hiểu.
   */
  it('từ chối "random" trong contract vì đó không phải một vùng thật', () => {
    const result = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      proxy: { mode: 'proxykey', keys: ['K1'], region: 'random' }
    });
    expect(result.success).toBe(false);
  });
});
