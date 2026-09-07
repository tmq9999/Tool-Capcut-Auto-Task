import { describe, it, expect } from 'vitest';
import {
  AutomationRunConfigSchema,
  AutomationRunProgressSchema,
  DEFAULT_TEST_RUN_DURATION_MS,
  RunningThreadInfoSchema
} from '../automation.schema';
import { SanitizedDiagnosticResultSchema } from '../diagnostics.schema';
import { AccountStatusEnum } from '../account.schema';

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
  it('defaults mission transport to the existing UI policy', () => {
    expect(AutomationRunConfigSchema.parse(baseConfig).missionTransport).toBeUndefined();
    expect(AutomationRunConfigSchema.parse({ ...baseConfig, missionTransport: 'http-only' }).missionTransport).toBe('http-only');
    expect(AutomationRunConfigSchema.safeParse({ ...baseConfig, missionTransport: 'hybrid' }).success).toBe(false);
  });
  it('accepts old configs and validates explicit mailbox caps', () => {
    expect(AutomationRunConfigSchema.safeParse(baseConfig).success).toBe(true);
    for (const mailLimit of [0, 1, 3, 200]) {
      expect(AutomationRunConfigSchema.parse({ ...baseConfig, mailLimit }).mailLimit).toBe(mailLimit);
    }
    for (const mailLimit of [-1, 201, 1.5, '3', null]) {
      expect(AutomationRunConfigSchema.safeParse({ ...baseConfig, mailLimit }).success).toBe(false);
    }
  });
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

  it('accepts blank manual elements as textarea position markers', () => {
    const parsed = AutomationRunConfigSchema.parse({
      ...baseConfig,
      module: 'credit',
      emailSource: {
        mode: 'manual',
        entries: ['good@example.com', '', 'bad-line']
      }
    });

    expect(parsed.emailSource).toEqual({
      mode: 'manual',
      entries: ['good@example.com', '', 'bad-line']
    });
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
      workerTarget: 3,
      workersActive: 2,
      accountsAccepted: 2,
      accountsCompleted: 0,
      accountsFailed: 1,
      accountsStopped: 0,
      message: 'Đã khởi chạy 2/3 profile'
    });
    expect(parsed.state).toBe('running');
  });

  it.each(['completed', 'blocked'] as const)('accepts terminal run state %s', (state) => {
    const parsed = AutomationRunProgressSchema.parse({
      runId: 'run-1',
      state,
      workerTarget: 3,
      workersActive: 0,
      accountsAccepted: 4,
      accountsCompleted: 3,
      accountsFailed: 1,
      accountsStopped: 0,
      message: 'terminal',
      terminalReason: {
        code: state === 'completed' ? 'MANUAL_EXHAUSTED' : 'INSUFFICIENT_FUNDS',
        provider: state === 'blocked' ? 'gmail94' : undefined,
        details: state === 'blocked' ? { balance: 1000, unitPrice: 1000 } : undefined
      }
    });

    expect(parsed.state).toBe(state);
  });

  it('accepts INSUFFICIENT_FUNDS as a sanitized provider code', () => {
    expect(SanitizedDiagnosticResultSchema.parse({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Số dư Gmail94 không đủ.',
      timestamp: '2026-09-05T00:00:00.000Z',
      details: { balance: 1000, unitPrice: 1000 }
    }).code).toBe('INSUFFICIENT_FUNDS');
  });

  it('accepts stopped as an account status', () => {
    expect(AccountStatusEnum.parse('stopped')).toBe('stopped');
  });

  it('accepts both legacy UI threads and profile-free HTTP-only threads', () => {
    expect(RunningThreadInfoSchema.parse({
      accountId: 'ui-1', email: 'ui@x.com', profileId: 'profile-1'
    })).toEqual({ accountId: 'ui-1', email: 'ui@x.com', profileId: 'profile-1' });
    expect(RunningThreadInfoSchema.parse({
      accountId: 'http-1', email: 'http@x.com', transport: 'http-only'
    })).toEqual({ accountId: 'http-1', email: 'http@x.com', transport: 'http-only' });
  });

  it('accepts TASK_CHECKPOINT_PERSISTENCE_FAILED and RESOURCE_CLEANUP_FAILED in terminal reasons', async () => {
    const { AutomationTerminalCodeEnum } = await import('../automation.schema');
    expect(AutomationTerminalCodeEnum.parse('TASK_CHECKPOINT_PERSISTENCE_FAILED')).toBe('TASK_CHECKPOINT_PERSISTENCE_FAILED');
    expect(AutomationTerminalCodeEnum.parse('RESOURCE_CLEANUP_FAILED')).toBe('RESOURCE_CLEANUP_FAILED');
    expect(AutomationTerminalCodeEnum.safeParse('UNKNOWN_CODE').success).toBe(false);
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

describe('AutomationEvidenceEventSchema', () => {
  it('validates strictly formatted evidence events and rejects unknown fields', async () => {
    const { AutomationEvidenceEventSchema } = await import('../automation-evidence.schema');

    const validRunStart = {
      schemaVersion: 1,
      runId: 'run-12345678-abcd-1234-abcd-123456789abc',
      at: '2026-09-08T00:00:00.000Z',
      type: 'run-start',
      mode: 'new',
      headed: true,
      stage: 1,
      workerTarget: 3,
      maxBillablePurchases: 5
    };

    expect(AutomationEvidenceEventSchema.safeParse(validRunStart).success).toBe(true);

    // Reject unknown fields
    expect(
      AutomationEvidenceEventSchema.safeParse({
        ...validRunStart,
        extraSecret: 'forbidden'
      }).success
    ).toBe(false);
  });

  it('rejects duplicate task keys in task-checkpoint', async () => {
    const { AutomationEvidenceEventSchema } = await import('../automation-evidence.schema');

    const checkpoint = {
      schemaVersion: 1,
      runId: 'run-12345678-abcd-1234-abcd-123456789abc',
      at: '2026-09-08T00:00:00.000Z',
      type: 'task-checkpoint',
      fresh: true,
      final: false,
      observedAt: '2026-09-08T00:00:00.000Z',
      requiredAfter: '2026-09-08T00:00:00.000Z',
      serverTotal: 2,
      serverDone: 1,
      tasks: [
        { key: 'dup-key', status: 1 },
        { key: 'dup-key', status: 4, errNo: 0 }
      ]
    };

    expect(AutomationEvidenceEventSchema.safeParse(checkpoint).success).toBe(false);
  });

  it('enforces monotonic purchase counters where confirmed + ambiguous <= attempted <= budget', async () => {
    const { AutomationEvidenceEventSchema } = await import('../automation-evidence.schema');

    const validPurchase = {
      schemaVersion: 1,
      runId: 'run-12345678-abcd-1234-abcd-123456789abc',
      at: '2026-09-08T00:00:00.000Z',
      type: 'purchase',
      provider: 'gmail94',
      outcome: 'confirmed',
      attempted: 2,
      confirmed: 1,
      ambiguous: 1,
      budget: 5
    };

    expect(AutomationEvidenceEventSchema.safeParse(validPurchase).success).toBe(true);

    // confirmed + ambiguous (3) > attempted (2) -> invalid
    expect(
      AutomationEvidenceEventSchema.safeParse({
        ...validPurchase,
        attempted: 2,
        confirmed: 2,
        ambiguous: 1
      }).success
    ).toBe(false);

    // attempted (6) > budget (5) -> invalid
    expect(
      AutomationEvidenceEventSchema.safeParse({
        ...validPurchase,
        attempted: 6,
        budget: 5
      }).success
    ).toBe(false);
  });

  it('validates a non-empty unique list of existing account ids', () => {
    // empty list
    expect(
      AutomationRunConfigSchema.safeParse({
        ...baseConfig,
        emailSource: { mode: 'existing', accountIds: [] }
      }).success
    ).toBe(false);

    // duplicate ids
    expect(
      AutomationRunConfigSchema.safeParse({
        ...baseConfig,
        emailSource: { mode: 'existing', accountIds: ['acc-1', 'acc-1'] }
      }).success
    ).toBe(false);

    // 21 items
    const twentyOne = Array.from({ length: 21 }, (_, i) => `acc-${i + 1}`);
    expect(
      AutomationRunConfigSchema.safeParse({
        ...baseConfig,
        emailSource: { mode: 'existing', accountIds: twentyOne }
      }).success
    ).toBe(false);

    // valid 3 items
    const valid = AutomationRunConfigSchema.safeParse({
      ...baseConfig,
      emailSource: { mode: 'existing', accountIds: ['acc-1', 'acc-2', 'acc-3'] }
    });
    expect(valid.success).toBe(true);
    if (valid.success && valid.data.emailSource.mode === 'existing') {
      expect(valid.data.emailSource.accountIds).toEqual(['acc-1', 'acc-2', 'acc-3']);
    }
  });
});


