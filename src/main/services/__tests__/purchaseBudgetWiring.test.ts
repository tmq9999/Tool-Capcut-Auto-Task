import { describe, expect, it, vi } from 'vitest';
import { AutomationRunConfigSchema } from '../../../shared/schemas/automation.schema';
import { createAutomationWorkSourceFactory } from '../AutomationWorkSource';
import type { EmailAcquisitionSession, PurchaseOptions } from '../EmailPurchaseService';

const base = AutomationRunConfigSchema.parse({
  threadCount: 3, browser: 'multilogin', headless: false, retryCount: 0,
  stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
  module: 'credit', skipWithoutTrial: false,
  emailSource: { mode: 'manual', entries: ['fake@example.com'] }, proxy: { mode: 'proxykey' },
  password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false }
});

describe('purchase budget source wiring', () => {
  it('passes the explicit budget and forwards accounting events independently of worker count', async () => {
    const stats = { budget: 2, attempted: 1, confirmed: 1, ambiguous: 0 };
    const session: EmailAcquisitionSession = {
      acquireOne: vi.fn(), commit: vi.fn(), release: vi.fn(), purchaseStats: () => ({ ...stats })
    };
    const open = vi.fn(async (_provider, _count, options: PurchaseOptions) => {
      options.onPurchaseEvent?.({ provider: 'gmail94', outcome: 'confirmed', stats: { ...stats } });
      return session;
    });
    const observed = vi.fn();
    const source = createAutomationWorkSourceFactory({ openAcquisitionSession: open }).create({
      ...base, emailSource: { mode: 'api', provider: 'gmail94' }, maxBillablePurchases: 2
    }, 'run-budget', observed);
    const signal = new AbortController().signal;
    await source.prepare(3, signal);
    expect(open).toHaveBeenCalledWith('gmail94', 3, expect.objectContaining({ maxBillablePurchases: 2 }), signal);
    expect(observed).toHaveBeenCalledWith({ provider: 'gmail94', outcome: 'confirmed', stats });
    expect(source.purchaseStats()).toEqual(stats);
    const exposed = source.purchaseStats();
    exposed.attempted = 99;
    expect(source.purchaseStats().attempted).toBe(1);
  });

  it('rejects an unbudgeted API source without calling the email service', () => {
    const open = vi.fn();
    const factory = createAutomationWorkSourceFactory({ openAcquisitionSession: open });
    expect(() => factory.create({ ...base, emailSource: { mode: 'api', provider: 'gmail94' } }, 'run-budget')).toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('reports zero purchasing for a manual source without opening acquisition', async () => {
    const open = vi.fn();
    const source = createAutomationWorkSourceFactory({ openAcquisitionSession: open }).create(base, 'run-manual');
    await source.prepare(1, new AbortController().signal);
    expect(source.purchaseStats()).toEqual({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 });
    expect(open).not.toHaveBeenCalled();
  });
});
