import { describe, expect, it } from 'vitest';
import { AutomationRunConfigSchema, AutomationTerminalCodeEnum } from '../automation.schema';

const config = {
  threadCount: 3, browser: 'multilogin', headless: false, retryCount: 1,
  stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
  module: 'credit', skipWithoutTrial: false,
  emailSource: { mode: 'api', provider: 'gmail94' }, proxy: { mode: 'proxykey' },
  password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false }
};

describe('rollout purchase authorization config', () => {
  it('rejects missing billable budget before a source can be prepared', () => {
    expect(AutomationRunConfigSchema.safeParse(config).success).toBe(false);
  });

  it.each(['gmail94', 'dongvanfb'])('accepts explicit non-negative budget for %s', (provider) => {
    for (const maxBillablePurchases of [0, 1, 3]) {
      expect(AutomationRunConfigSchema.parse({
        ...config, emailSource: { mode: 'api', provider }, maxBillablePurchases
      }).maxBillablePurchases).toBe(maxBillablePurchases);
    }
  });

  it.each([-1, 1.5, NaN, Infinity, '3'])('rejects invalid budget %s', (maxBillablePurchases) => {
    expect(AutomationRunConfigSchema.safeParse({ ...config, maxBillablePurchases }).success).toBe(false);
  });

  it('retains non-purchasing manual and existing configs', () => {
    expect(AutomationRunConfigSchema.safeParse({ ...config, emailSource: { mode: 'manual', entries: ['fake@example.com'] } }).success).toBe(true);
    expect(AutomationRunConfigSchema.safeParse({ ...config, emailSource: { mode: 'existing', accountIds: ['fake-account'] } }).success).toBe(true);
    expect(AutomationRunConfigSchema.safeParse({ ...config, emailSource: { mode: 'existing', accountIds: ['fake-account'] }, maxBillablePurchases: 1 }).success).toBe(false);
  });

  it('accepts only a fully equal headed new-account rollout tuple', () => {
    const rollout = { ...config, rolloutStage: 3, mailLimit: 3, approvedMailboxes: 3, stopAfter: 3, maxBillablePurchases: 3 };
    expect(AutomationRunConfigSchema.safeParse(rollout).success).toBe(true);
    for (const field of ['threadCount', 'mailLimit', 'approvedMailboxes', 'stopAfter', 'maxBillablePurchases']) {
      expect(AutomationRunConfigSchema.safeParse({ ...rollout, [field]: 5 }).success).toBe(false);
      expect(AutomationRunConfigSchema.safeParse({ ...rollout, [field]: undefined }).success).toBe(false);
    }
    expect(AutomationRunConfigSchema.safeParse({ ...rollout, headless: true }).success).toBe(false);
    expect(AutomationRunConfigSchema.safeParse({ ...rollout, missionTransport: 'http-only' }).success).toBe(false);
  });

  it('round-trips a budget exhaustion terminal code', () => {
    expect(AutomationTerminalCodeEnum.parse('BILLABLE_PURCHASE_LIMIT_REACHED')).toBe('BILLABLE_PURCHASE_LIMIT_REACHED');
  });

  it('distinguishes a successful health-only terminal from a completed account run', () => {
    expect(AutomationTerminalCodeEnum.parse('HEALTH_CHECK_COMPLETED')).toBe('HEALTH_CHECK_COMPLETED');
  });
});
