import { describe, it, expect } from 'vitest';
import {
  MultiloginBrowserRuntime,
  DispatchingBrowserRuntime,
  UnsupportedBrowserRuntime
} from '../browserRuntime';
import { ProviderError } from '../../providers/ProviderError';
import type {
  MultiloginQuickProfile,
  MultiloginQuickProfileStatus,
  StartQuickProfileParams
} from '../../providers/MultiloginProvider';
import type { StartedProfile } from '../AutomationRunService';

class StubMultiloginApi {
  public startArgs: Array<{ token: string; params: StartQuickProfileParams }> = [];
  public stopArgs: Array<{ token: string; profileId: string }> = [];
  public statusCalls = 0;
  /** Ports reported per statuses poll; null means "not booted yet". */
  public portSequence: Array<number | null> = [null];
  public startPort: number | null = null;

  async startQuickProfile(token: string, params: StartQuickProfileParams): Promise<MultiloginQuickProfile> {
    this.startArgs.push({ token, params });
    return { profileId: 'profile-1', port: this.startPort, browserType: 'mimic' };
  }

  async getQuickProfileStatuses(): Promise<MultiloginQuickProfileStatus[]> {
    const port = this.portSequence[Math.min(this.statusCalls, this.portSequence.length - 1)];
    this.statusCalls += 1;
    return [{ profileId: 'profile-1', status: 'browser_running', port, browserType: 'mimic' }];
  }

  async stopProfile(token: string, profileId: string): Promise<void> {
    this.stopArgs.push({ token, profileId });
  }
}

const noWait = { sleep: async (): Promise<void> => {}, portTimeoutMs: 3_000, portPollIntervalMs: 100 };

class RecordingRuntime {
  public started = 0;
  public stopped: string[] = [];
  public receivedSignal?: AbortSignal;
  public receivedStartCallback?: (profileId: string) => void;
  constructor(private readonly id: string) {}

  async startProfile(params: { signal?: AbortSignal; onProfileStarted?: (profileId: string) => void } = {}): Promise<StartedProfile> {
    this.started += 1;
    const profileId = this.id + '-' + this.started;
    this.receivedSignal = params.signal;
    this.receivedStartCallback = params.onProfileStarted;
    params.onProfileStarted?.(profileId);
    return { profileId, port: 1000, browserType: this.id };
  }

  async stopProfile(profileId: string): Promise<void> {
    this.stopped.push(profileId);
  }
}

describe('MultiloginBrowserRuntime', () => {
  it('authenticates then starts a quick profile with the headless flag and proxy', async () => {
    const api = new StubMultiloginApi();
    api.portSequence = [55579];
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-1' }, api, noWait);

    const profile = await runtime.startProfile({
      headless: true,
      proxy: { host: '1.2.3.4', port: 20001, type: 'http', username: 'u', password: 'p' }
    });

    expect(api.startArgs[0].token).toBe('jwt-1');
    expect(api.startArgs[0].params.isHeadless).toBe(true);
    expect(api.startArgs[0].params.proxy).toEqual({
      host: '1.2.3.4', port: 20001, type: 'http', username: 'u', password: 'p'
    });
    expect(profile).toEqual({ profileId: 'profile-1', port: 55579, browserType: 'mimic' });
  });

  it('starts the profile for playwright automation so a debug port is published', async () => {
    const api = new StubMultiloginApi();
    api.portSequence = [61000];
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-1' }, api, noWait);

    await runtime.startProfile({ headless: false });

    expect(api.startArgs[0].params.automation).toBe('playwright');
  });

  it('waits for the launcher to publish the debug port after start', async () => {
    const api = new StubMultiloginApi();
    api.portSequence = [null, null, 60873];
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-1' }, api, noWait);

    const profile = await runtime.startProfile({ headless: false });

    expect(profile.port).toBe(60873);
    expect(api.statusCalls).toBe(3);
  });

  it('does not poll when the start response already carried the port', async () => {
    const api = new StubMultiloginApi();
    api.startPort = 50000;
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-1' }, api, noWait);

    const profile = await runtime.startProfile({ headless: false });

    expect(profile.port).toBe(50000);
    expect(api.statusCalls).toBe(0);
  });

  it('returns the profile with a null port rather than failing the launch', async () => {
    const api = new StubMultiloginApi();
    api.portSequence = [null];
    const runtime = new MultiloginBrowserRuntime(
      { getAccessToken: async () => 'jwt-1' },
      api,
      { sleep: async () => {}, portTimeoutMs: 250, portPollIntervalMs: 100 }
    );

    const profile = await runtime.startProfile({ headless: false });

    expect(profile.profileId).toBe('profile-1');
    expect(profile.port).toBeNull();
  });

  it('starts without a proxy when none is supplied', async () => {
    const api = new StubMultiloginApi();
    api.portSequence = [1];
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-1' }, api, noWait);

    await runtime.startProfile({ headless: false });

    expect(api.startArgs[0].params.proxy).toBeUndefined();
  });

  it('stops exactly the profile it was given and nothing else', async () => {
    const api = new StubMultiloginApi();
    const runtime = new MultiloginBrowserRuntime({ getAccessToken: async () => 'jwt-2' }, api, noWait);

    await runtime.stopProfile('profile-9');

    expect(api.stopArgs).toEqual([{ token: 'jwt-2', profileId: 'profile-9' }]);
  });
});

describe('UnsupportedBrowserRuntime', () => {
  it('explains which browser is not wired up yet', async () => {
    const runtime = new UnsupportedBrowserRuntime('gologin');

    const error = await runtime.startProfile({ headless: false }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain('gologin');
  });

  it('is a no-op when asked to stop', async () => {
    const runtime = new UnsupportedBrowserRuntime('camoufox');
    await expect(runtime.stopProfile('x')).resolves.toBeUndefined();
  });
});

describe('DispatchingBrowserRuntime', () => {
  it('routes a start request to the runtime for the requested browser', async () => {
    const multilogin = new RecordingRuntime('ml');
    const dispatcher = new DispatchingBrowserRuntime(
      new Map([['multilogin', multilogin]]),
      'multilogin'
    );

    await dispatcher.startProfile({ headless: false, browser: 'multilogin' });

    expect(multilogin.started).toBe(1);
  });

  it('forwards cancellation and early ownership callback to the selected runtime', async () => {
    const multilogin = new RecordingRuntime('ml');
    const dispatcher = new DispatchingBrowserRuntime(new Map([['multilogin', multilogin]]), 'multilogin');
    const controller = new AbortController();
    const owned: string[] = [];
    const started = await dispatcher.startProfile({
      headless: false, browser: 'multilogin', signal: controller.signal,
      onProfileStarted: (profileId) => owned.push(profileId)
    });
    expect(multilogin.receivedSignal).toBe(controller.signal);
    expect(multilogin.receivedStartCallback).toBeDefined();
    expect(owned).toEqual([started.profileId]);
  });

  it('stops a profile through the runtime that started it', async () => {
    const multilogin = new RecordingRuntime('ml');
    const other = new RecordingRuntime('other');
    const dispatcher = new DispatchingBrowserRuntime(
      new Map([['multilogin', multilogin], ['gologin', other]]),
      'multilogin'
    );

    const started = await dispatcher.startProfile({ headless: false, browser: 'gologin' });
    await dispatcher.stopProfile(started.profileId);

    expect(other.stopped).toEqual(['other-1']);
    expect(multilogin.stopped).toEqual([]);
  });

  it('falls back to the default runtime when the browser is unknown', async () => {
    const multilogin = new RecordingRuntime('ml');
    const dispatcher = new DispatchingBrowserRuntime(
      new Map([['multilogin', multilogin]]),
      'multilogin'
    );

    await dispatcher.startProfile({ headless: false });

    expect(multilogin.started).toBe(1);
  });

  it('stops an unknown profile id through the default runtime', async () => {
    const multilogin = new RecordingRuntime('ml');
    const dispatcher = new DispatchingBrowserRuntime(
      new Map([['multilogin', multilogin]]),
      'multilogin'
    );

    await dispatcher.stopProfile('never-seen');

    expect(multilogin.stopped).toEqual(['never-seen']);
  });

  it('rejects when the requested browser has no runtime registered', async () => {
    const dispatcher = new DispatchingBrowserRuntime(new Map(), 'multilogin');

    await expect(dispatcher.startProfile({ headless: false, browser: 'gpm' })).rejects.toBeInstanceOf(ProviderError);
  });
});
