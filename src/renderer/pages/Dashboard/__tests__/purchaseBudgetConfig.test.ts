import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION_CONFIG, toRunConfig, toPersistedConfig, fromPersistedConfig } from '../automationConfig';

describe('dashboard explicit purchase budget', () => {
  it('sends the edited purchase budget rather than deriving it from workers or mail limit', () => {
    const result = toRunConfig({ ...DEFAULT_AUTOMATION_CONFIG, emailSourceMode: 'api',
      threadCount: 10, mailLimit: 20, maxBillablePurchases: 3 });
    expect(result).toMatchObject({ ok: true, config: { maxBillablePurchases: 3, threadCount: 10, mailLimit: 20 } });
  });

  it('persists the explicit budget and uses zero for an older saved config', () => {
    const saved = toPersistedConfig({ ...DEFAULT_AUTOMATION_CONFIG, maxBillablePurchases: 5 });
    expect(fromPersistedConfig(saved).maxBillablePurchases).toBe(5);
    expect(fromPersistedConfig({ ...saved, maxBillablePurchases: undefined }).maxBillablePurchases).toBe(0);
  });

  it('never transfers a remembered paid budget to a manual source', () => {
    const result = toRunConfig({ ...DEFAULT_AUTOMATION_CONFIG, emailSourceMode: 'manual',
      emailList: 'fake@example.com', maxBillablePurchases: 5 });
    expect(result).toMatchObject({ ok: true, config: { maxBillablePurchases: 0 } });
  });
});
