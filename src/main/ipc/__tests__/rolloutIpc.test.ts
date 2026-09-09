import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAutomationIpc } from '../automationIpc';
import { IpcContractRegistry } from '../../../shared/contracts/api';
import type { IpcRegistrar } from '../registerIpc';

describe('dedicated rollout IPC boundary', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('validates health stage/count and calls only the health service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const registrar = { handle: (key: string, fn: (...args: unknown[]) => unknown) => handlers.set(key, fn), removeHandler: vi.fn() } as IpcRegistrar;
    const result = { runId: 'run-health', artifactBasename: 'run-health.jsonl', attempted: 3, healthy: 3, stopped: 3, cleanupFailures: 0 };
    const health = vi.fn(async () => result);
    const start = vi.fn();
    const email = { getProviderConfigs: vi.fn(), readOtp: vi.fn() };
    const run = { start, stop: vi.fn(), stopThread: vi.fn(), getProgress: vi.fn(), getRunningThreads: vi.fn(), runHealthCheck: health, getUserDataDir: () => 'D:/outside-user-data' };
    const cleanup = registerAutomationIpc(registrar, run, email);
    const handler = handlers.get('run:health');
    expect(handler).toBeTypeOf('function');
    expect(await handler!({}, { threadCount: 3, rolloutStage: 10, headless: false })).toMatchObject({ success: false });
    expect(health).not.toHaveBeenCalled();
    expect(await handler!({}, { threadCount: 3, rolloutStage: 3, headless: false })).toMatchObject({ success: true, data: result });
    expect(start).not.toHaveBeenCalled();
    expect(email.readOtp).not.toHaveBeenCalled();
    expect(email.getProviderConfigs).not.toHaveBeenCalled();
    expect(await handlers.get('run:user-data')!({})).toMatchObject({ success: true, data: { userDataDir: 'D:/outside-user-data' } });
    cleanup();
    expect(registrar.removeHandler).toHaveBeenCalledWith('run:health');
    expect(registrar.removeHandler).toHaveBeenCalledWith('run:user-data');
  });

  it('keeps real account/proxy/mail options outside the health contract', () => {
    const valid = { threadCount: 3, rolloutStage: 3, headless: false };
    expect(IpcContractRegistry.run.health.request.safeParse(valid).success).toBe(true);
    for (const forbidden of [{ emailSource: { mode: 'api', provider: 'gmail94' } }, { maxBillablePurchases: 3 }, { proxy: {} }, { headless: true }]) {
      expect(IpcContractRegistry.run.health.request.safeParse({ ...valid, ...forbidden }).success).toBe(false);
    }
  });

  it('returns only a validated child handshake alongside userData for ownership checks', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const registrar = { handle: (key: string, fn: (...args: unknown[]) => unknown) => handlers.set(key, fn), removeHandler: vi.fn() } as IpcRegistrar;
    const run = { start: vi.fn(), stop: vi.fn(), stopThread: vi.fn(), getProgress: vi.fn(), getRunningThreads: vi.fn(), runHealthCheck: vi.fn(), getUserDataDir: () => 'D:/outside-user-data' };
    registerAutomationIpc(registrar, run, { getProviderConfigs: vi.fn(), readOtp: vi.fn() });
    vi.stubEnv('AUTOMANAGER_ROLLOUT_HANDSHAKE', 'a'.repeat(64));
    expect(await handlers.get('run:user-data')!({})).toMatchObject({ success: true, data: { rolloutHandshake: 'a'.repeat(64) } });
    vi.stubEnv('AUTOMANAGER_ROLLOUT_HANDSHAKE', 'secret@example.invalid');
    expect(await handlers.get('run:user-data')!({})).toEqual({ success: true, data: { userDataDir: 'D:/outside-user-data' } });
  });
});
