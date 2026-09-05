import { ProviderError } from '../providers/ProviderError';
import {
  MULTILOGIN_SERVICE_NAME,
  type MultiloginQuickProfile,
  type MultiloginQuickProfileStatus,
  type StartQuickProfileParams
} from '../providers/MultiloginProvider';
import type { BrowserRuntime } from '../../shared/schemas/automation.schema';
import type {
  BrowserProxySettings,
  IBrowserRuntimeApi,
  StartedProfile
} from './AutomationRunService';

export interface MultiloginTokenSource {
  getAccessToken(): Promise<string>;
}

export interface MultiloginQuickProfileApi {
  startQuickProfile(token: string, params: StartQuickProfileParams): Promise<MultiloginQuickProfile>;
  getQuickProfileStatuses(token: string, timeoutMs?: number): Promise<MultiloginQuickProfileStatus[]>;
  stopProfile(token: string, profileId: string, timeoutMs?: number): Promise<void>;
}

export interface MultiloginBrowserRuntimeOptions {
  sleep?: (ms: number) => Promise<void>;
  portTimeoutMs?: number;
  portPollIntervalMs?: number;
}

function waitWithSignal(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return sleep(ms);
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([sleep(ms), aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Automation type that makes the launcher publish a remote-debugging port. */
export const MULTILOGIN_AUTOMATION_TYPE = 'playwright';
const DEFAULT_PORT_TIMEOUT_MS = 30_000;
const DEFAULT_PORT_POLL_INTERVAL_MS = 1_000;

/**
 * Starts and stops Multilogin quick profiles. Quick profiles are one-shot: no
 * profile is stored on the workspace, and stopping one discards its data.
 *
 * The profile is started with an automation type, because the launcher publishes
 * a remote-debugging port only for automation launches — that port is what a
 * CDP client (Playwright) attaches to. The port is not in the start response, so
 * it is read from the statuses endpoint right afterwards.
 */
export class MultiloginBrowserRuntime implements IBrowserRuntimeApi {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly portTimeoutMs: number;
  private readonly portPollIntervalMs: number;

  constructor(
    private readonly auth: MultiloginTokenSource,
    private readonly api: MultiloginQuickProfileApi,
    options: MultiloginBrowserRuntimeOptions = {}
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.portTimeoutMs = options.portTimeoutMs ?? DEFAULT_PORT_TIMEOUT_MS;
    this.portPollIntervalMs = options.portPollIntervalMs ?? DEFAULT_PORT_POLL_INTERVAL_MS;
  }

  /**
   * Best effort: a profile without a resolved port is still a usable launch, it
   * simply cannot be attached to yet, so this never fails the start.
   */
  private async resolvePort(
    token: string,
    profileId: string,
    signal?: AbortSignal
  ): Promise<number | null> {
    const attempts = Math.max(1, Math.ceil(this.portTimeoutMs / this.portPollIntervalMs));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      signal?.throwIfAborted();
      let statuses: MultiloginQuickProfileStatus[];
      try {
        statuses = await this.api.getQuickProfileStatuses(token);
      } catch {
        return null;
      }

      const own = statuses.find((entry) => entry.profileId === profileId);
      if (own?.port) return own.port;

      if (attempt < attempts - 1) {
        await waitWithSignal(this.sleep, this.portPollIntervalMs, signal);
      }
    }

    return null;
  }

  async startProfile(params: {
    headless: boolean;
    proxy?: BrowserProxySettings;
    browser?: BrowserRuntime;
    signal?: AbortSignal;
    onProfileStarted?: (profileId: string) => void;
  }): Promise<StartedProfile> {
    params.signal?.throwIfAborted();
    const token = await this.auth.getAccessToken();
    const quickParams: StartQuickProfileParams = {
      isHeadless: params.headless,
      automation: MULTILOGIN_AUTOMATION_TYPE
    };
    if (params.proxy) {
      quickParams.proxy = params.proxy;
    }

    const profile = await this.api.startQuickProfile(token, quickParams);
    params.onProfileStarted?.(profile.profileId);
    const port = profile.port ?? (await this.resolvePort(token, profile.profileId, params.signal));

    return { profileId: profile.profileId, port, browserType: profile.browserType };
  }

  /** Stops one profile by id. Never touches any other profile. */
  async stopProfile(profileId: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    await this.api.stopProfile(token, profileId);
  }
}

/** Placeholder for the browsers scheduled after the current milestone. */
export class UnsupportedBrowserRuntime implements IBrowserRuntimeApi {
  constructor(private readonly browser: string) {}

  async startProfile(_params: {
    headless: boolean;
    proxy?: BrowserProxySettings;
    browser?: BrowserRuntime;
  }): Promise<StartedProfile> {
    throw new ProviderError(
      'CONFIG_ERROR',
      'Browser ' + this.browser + ' chưa được tích hợp. Hiện tại chỉ Multilogin khả dụng.',
      this.browser
    );
  }

  async stopProfile(_profileId: string): Promise<void> {
    // Nothing was ever started.
  }
}

/**
 * Routes each run to the runtime for its configured browser and remembers which
 * runtime started which profile so teardown always reaches the right one.
 */
export class DispatchingBrowserRuntime implements IBrowserRuntimeApi {
  private readonly ownerByProfileId = new Map<string, IBrowserRuntimeApi>();

  constructor(
    private readonly runtimes: Map<string, IBrowserRuntimeApi>,
    private readonly defaultBrowser: BrowserRuntime = MULTILOGIN_SERVICE_NAME as BrowserRuntime
  ) {}

  private resolve(browser: BrowserRuntime | undefined): IBrowserRuntimeApi {
    const requested = browser ?? this.defaultBrowser;
    const runtime = this.runtimes.get(requested);
    if (!runtime) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không có runtime cho browser ' + requested + '.',
        requested
      );
    }
    return runtime;
  }

  async startProfile(params: {
    headless: boolean;
    proxy?: BrowserProxySettings;
    browser?: BrowserRuntime;
    signal?: AbortSignal;
    onProfileStarted?: (profileId: string) => void;
  }): Promise<StartedProfile> {
    const runtime = this.resolve(params.browser);
    const profile = await runtime.startProfile(params);
    this.ownerByProfileId.set(profile.profileId, runtime);
    return profile;
  }

  async stopProfile(profileId: string): Promise<void> {
    const runtime = this.ownerByProfileId.get(profileId) ?? this.resolve(undefined);
    this.ownerByProfileId.delete(profileId);
    await runtime.stopProfile(profileId);
  }
}
