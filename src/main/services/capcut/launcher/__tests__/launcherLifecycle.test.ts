import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright-core';
import { ApiV3Launcher } from '../ApiV3Launcher';
import { XcliLauncher } from '../XcliLauncher';
import { attachOverCdp } from '../BrowserLauncher';
import { checkRendererHealth } from '../../rendererHealth';
vi.mock('../../rendererHealth', () => ({ checkRendererHealth: vi.fn(async () => ({})) }));

const child = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../BrowserLauncher', async (original) => ({
  ...await original<typeof import('../BrowserLauncher')>(),
  attachOverCdp: vi.fn()
}));
vi.mock('../../prefs', () => ({ seedPreferences: async () => true }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: child.execute }) };
});

const profileId = '12345678-1234-1234-1234-123456789abc';
function apiFixture() {
  return {
    startQuickProfile: vi.fn(async () => ({ profileId, port: 45678, browserType: 'mimic' })),
    getQuickProfileStatuses: vi.fn(async () => []),
    stopProfile: vi.fn(async () => {})
  };
}
function cdpFixture() {
  const browser = { close: vi.fn(async () => {}) };
  vi.mocked(attachOverCdp).mockResolvedValue({
    browser: browser as unknown as Browser, page: {} as never, context: {} as never
  });
  return browser;
}
beforeEach(() => {
  child.execute.mockImplementation(async (_file: string, args: string[]) => ({
    stdout: args[0] === 'profile-quick' ? `ID ${profileId}, port: 45678`
      : args[0] === 'profile-status' ? `Profile ID    Profile Status\n${profileId}    stopped` : '', stderr: ''
  }));
});
afterEach(() => vi.useRealTimers());

import { RunUiInteractionScheduler } from '../../uiInteractionScheduler';

describe('launcher stop ownership', () => {
  it('runs the renderer health gate for headed API-v3 and xcli sessions', async () => {
    cdpFixture();
    vi.mocked(checkRendererHealth).mockClear();
    const apiLauncher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, apiFixture());
    await apiLauncher.launch({ headless: false });
    expect(checkRendererHealth).toHaveBeenCalledTimes(1);

    vi.mocked(checkRendererHealth).mockClear();
    cdpFixture();
    const xcliLauncher = new XcliLauncher({ bootWaitMs: 0 });
    await xcliLauncher.launch({ headless: false });
    expect(checkRendererHealth).toHaveBeenCalledTimes(1);
  });

  it('quarantines and tears down an owned headed profile when mouse move never settles', async () => {
    const api = apiFixture();
    cdpFixture();
    const scheduler = new RunUiInteractionScheduler();
    const controller = new AbortController();
    const ui = scheduler.forSession({ sessionAlias: 'session-1', signal: controller.signal });
    const { DomReadTimeoutError } = await import('../../cancellation');
    vi.mocked(checkRendererHealth).mockImplementationOnce(async () => {
      return ui.foreground('renderer-health:mouse', async () => {
        throw new DomReadTimeoutError('renderer-mouse');
      });
    });
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api);
    const owned: string[] = [];
    const launchPromise = launcher.launch({
      headless: false,
      ui,
      onProfileStarted: (id) => owned.push(id)
    });
    await expect(launchPromise).rejects.toMatchObject({ code: 'DOM_READ_TIMEOUT' });
    expect(scheduler.snapshot().quarantinedAlias).toBe('session-1');
    expect(owned).toEqual([profileId]);
    await launcher.stop(owned[0]);
    expect(api.stopProfile).toHaveBeenCalledTimes(1);
  });
  it('keeps the attached handle available to the owner when a headless probe fails', async () => {
    const api = apiFixture(); const browser = cdpFixture();
    vi.mocked(checkRendererHealth).mockRejectedValueOnce(new Error('Probe failed'));
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api);
    await expect(launcher.launch({ headless: true, onProfileStarted: () => {} })).rejects.toThrow('Probe failed');
    expect(api.stopProfile).not.toHaveBeenCalled();
    await launcher.stop(profileId);
    expect(api.stopProfile).toHaveBeenCalledWith('test-token', profileId, 10000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
  it('does not disconnect CDP before the vendor stop request settles', async () => {
    const api = apiFixture();
    const browser = cdpFixture();
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api);
    await launcher.launch({});
    api.stopProfile.mockImplementation(async () => { expect(browser.close).not.toHaveBeenCalled(); });
    await launcher.stop(profileId);
    expect(api.stopProfile).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('retains the CDP handle after failed stop and sanitizes diagnostics', async () => {
    const api = apiFixture();
    const browser = cdpFixture();
    const logs: string[] = [];
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api, { log: (m) => logs.push(m) });
    await launcher.launch({});
    api.stopProfile.mockRejectedValueOnce(new Error('token=must-not-leak'));
    await expect(launcher.stop(profileId)).rejects.not.toThrow('must-not-leak');
    expect(browser.close).not.toHaveBeenCalled();
    await launcher.stop(profileId);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).not.toContain('must-not-leak');
  });

  it('coalesces concurrent stop calls into one vendor request', async () => {
    const api = apiFixture();
    cdpFixture();
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api);
    await launcher.launch({});
    await Promise.all([launcher.stop(profileId), launcher.stop(profileId)]);
    expect(api.stopProfile).toHaveBeenCalledTimes(1);
  });

  it('leaves startup-failure cleanup to the service after handing off ownership', async () => {
    const api = apiFixture();
    vi.mocked(attachOverCdp).mockRejectedValue(new Error('attach failed'));
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api);
    const owned: string[] = [];
    await expect(launcher.launch({ onProfileStarted: (id) => owned.push(id) })).rejects.toThrow('attach failed');
    expect(owned).toEqual([profileId]);
    expect(api.stopProfile).not.toHaveBeenCalled();
    await launcher.stop(owned[0]);
    expect(api.stopProfile).toHaveBeenCalledTimes(1);
  });

  it('interrupts xcli boot wait and does not race the owner with a second stop', async () => {
    vi.useFakeTimers();
    cdpFixture();
    const controller = new AbortController();
    const launcher = new XcliLauncher({ bootWaitMs: 5000 });
    let owned = '';
    const launch = launcher.launch({ signal: controller.signal, onProfileStarted: (id) => { owned = id; } });
    const error = launch.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(1);
    expect(owned).toBe(profileId);
    controller.abort(new Error('stop requested'));
    await vi.advanceTimersByTimeAsync(1);
    expect(await error).toMatchObject({ message: 'stop requested' });
    expect(attachOverCdp).not.toHaveBeenCalled();
    expect(child.execute).toHaveBeenCalledTimes(1);
    await launcher.stop(owned);
    expect(child.execute.mock.calls.map((call) => call[1][0])).toEqual(['profile-quick', 'profile-stop', 'profile-status']);
  });

  it('hands off an xcli id returned after cancellation before rejecting launch', async () => {
    const controller = new AbortController();
    child.execute.mockImplementationOnce(async () => {
      controller.abort(new Error('stop requested'));
      return { stdout: `ID ${profileId}, port: 45678`, stderr: '' };
    });
    const owned: string[] = [];
    const launcher = new XcliLauncher();
    await expect(launcher.launch({ signal: controller.signal, onProfileStarted: (id) => owned.push(id) })).rejects.toThrow('stop requested');
    expect(owned).toEqual([profileId]);
  });

  it('does not cancel an acknowledged xcli start before collecting its profile id', async () => {
    child.execute.mockImplementationOnce(async (_file: string, _args: string[], options: { signal?: AbortSignal; timeout?: number }) => {
      expect(options.signal).toBeUndefined();
      expect(options.timeout).toBeGreaterThan(0);
      return { stdout: `ID ${profileId}, port: 45678`, stderr: '' };
    });
    cdpFixture();
    const launcher = new XcliLauncher({ bootWaitMs: 0 });
    await launcher.launch({ signal: new AbortController().signal });
    expect(attachOverCdp).toHaveBeenCalledWith(45678, expect.objectContaining({ headless: false }));
    await launcher.stop(profileId);
  });

  it('owns an xcli profile even when the output is missing its CDP port', async () => {
    child.execute.mockResolvedValueOnce({ stdout: `ID ${profileId}`, stderr: '' });
    const owned: string[] = [];
    await expect(new XcliLauncher().launch({ onProfileStarted: (id) => owned.push(id) })).rejects.toThrow('port');
    expect(owned).toEqual([profileId]);
  });

  it('recovers an owned profile id from a timed-out xcli command without logging raw output', async () => {
    child.execute.mockRejectedValueOnce(Object.assign(new Error('token=must-not-leak'), {
      stdout: `ID ${profileId}, port: 45678`, stderr: 'token=must-not-leak', killed: true
    }));
    const owned: string[] = [];
    const logs: string[] = [];
    const launcher = new XcliLauncher({ log: (line) => logs.push(line) });
    await expect(launcher.launch({ onProfileStarted: (id) => owned.push(id) })).rejects.not.toThrow('must-not-leak');
    expect(owned).toEqual([profileId]);
    expect(logs.join('\n')).not.toContain('must-not-leak');
    await launcher.stop(profileId);
  });

  it('cancels a pending API-v3 status read before it returns', async () => {
    const api = apiFixture();
    api.startQuickProfile.mockResolvedValueOnce({ profileId, port: null as never, browserType: 'mimic' });
    let release: () => void = () => {};
    let reading: () => void = () => {};
    const readStarted = new Promise<void>((resolve) => { reading = resolve; });
    api.getQuickProfileStatuses.mockImplementationOnce(() => {
      reading();
      return new Promise((resolve) => { release = () => resolve([]); });
    });
    const controller = new AbortController();
    const launcher = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api, { sleep: async () => {} });
    let settled = false;
    const launch = launcher.launch({ signal: controller.signal, onProfileStarted: () => {} })
      .catch((error: unknown) => { settled = true; return error; });
    await readStarted;
    controller.abort(new Error('stop'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const beforeResponse = settled;
    release();
    expect(await launch).toMatchObject({ message: 'stop' });
    expect(beforeResponse).toBe(true);
  });

  it('fails stop confirmation at its deadline even if a status request never returns', async () => {
    vi.useFakeTimers();
    const api = apiFixture();
    let release: () => void = () => {};
    api.getQuickProfileStatuses.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    let settled = false;
    const stopping = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api).stop(profileId)
      .then(() => 'accepted', (error: unknown) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(5001);
    const onTime = settled;
    release();
    expect(await stopping).toBeInstanceOf(Error);
    expect(onTime).toBe(true);
  });

  it('does not accept a stop acknowledgement while the vendor still reports running', async () => {
    vi.useFakeTimers();
    const api = apiFixture();
    let reads = 0;
    api.getQuickProfileStatuses.mockImplementation(async () => {
      reads += 1;
      return reads < 3 ? [{ profileId, status: 'browser_running', port: 45678, browserType: 'mimic' }] as never : [];
    });
    const stopping = new ApiV3Launcher({ getAccessToken: async () => 'test-token' }, api).stop(profileId);
    let settled = false;
    void stopping.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1);
    const settledBeforeStatus = settled;
    await vi.runAllTimersAsync();
    await stopping;
    expect(settledBeforeStatus).toBe(false);
    expect(reads).toBe(3);
  });
});
