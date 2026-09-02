import type { SanitizedDiagnosticResult } from '../../shared/schemas/diagnostics.schema';
import type { ConnectivityProvider } from '../services/ProviderRegistry';
import { ProviderError } from './ProviderError';
import { GMAIL94_SERVICE_NAME, type Gmail94Profile } from './Gmail94Provider';
import { DONGVANFB_SERVICE_NAME } from './DongVanFBProvider';
import { KIOTPROXY_SERVICE_NAME, type KiotProxyKeySummary, type KiotProxyUserInfo } from './KiotProxyProvider';
import { MULTILOGIN_SERVICE_NAME } from './MultiloginProvider';

export interface ClockLike {
  now(): number;
}

/** Only the secret lookup the probes need. */
export interface SecretSource {
  readSimpleKey(serviceName: string): string;
}

const defaultClock: ClockLike = { now: () => Date.now() };

function ok(message: string, timestamp: string, details?: Record<string, string | number | boolean>): SanitizedDiagnosticResult {
  return details ? { code: 'OK', message, timestamp, details } : { code: 'OK', message, timestamp };
}

export interface Gmail94ProfileApi {
  getProfile(token: string): Promise<Gmail94Profile>;
}

/** Probes Gmail94 by reading the account profile, which also yields the balance. */
export class Gmail94Connectivity implements ConnectivityProvider {
  constructor(
    private readonly secrets: SecretSource,
    private readonly api: Gmail94ProfileApi,
    private readonly clock: ClockLike = defaultClock
  ) {}

  async testConnection(): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const token = this.secrets.readSimpleKey(GMAIL94_SERVICE_NAME);
    const profile = await this.api.getProfile(token);

    const details: Record<string, string | number | boolean> = {};
    if (typeof profile.balance === 'number') details.balance = profile.balance;
    if (profile.name) details.account = profile.name;

    return ok('Gmail94 đã kết nối.', timestamp, Object.keys(details).length > 0 ? details : undefined);
  }
}

export interface DongVanBalanceApi {
  checkBalance(apiKey: string): Promise<number>;
}

/** Probes DongVanFB with the balance endpoint, the cheapest authenticated read. */
export class DongVanFBConnectivity implements ConnectivityProvider {
  constructor(
    private readonly secrets: SecretSource,
    private readonly api: DongVanBalanceApi,
    private readonly clock: ClockLike = defaultClock
  ) {}

  async testConnection(): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const apiKey = this.secrets.readSimpleKey(DONGVANFB_SERVICE_NAME);
    const balance = await this.api.checkBalance(apiKey);
    return ok('DongVanFB đã kết nối.', timestamp, { balance });
  }
}

export interface KiotProxyAccountApi {
  getUserInfo(apiToken: string): Promise<KiotProxyUserInfo>;
  listKeys(apiToken: string): Promise<KiotProxyKeySummary[]>;
}

/**
 * Probes KiotProxy and reports how many keys the account owns. Key count is the
 * hard limit on concurrent threads, because two profiles may never share an IP.
 */
export class KiotProxyConnectivity implements ConnectivityProvider {
  constructor(
    private readonly secrets: SecretSource,
    private readonly api: KiotProxyAccountApi,
    private readonly clock: ClockLike = defaultClock
  ) {}

  async testConnection(): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const apiToken = this.secrets.readSimpleKey(KIOTPROXY_SERVICE_NAME);

    const info = await this.api.getUserInfo(apiToken);
    const keys = await this.api.listKeys(apiToken);

    if (keys.length === 0) {
      return {
        code: 'CONFIG_ERROR',
        message: 'KiotProxy đã xác thực nhưng tài khoản chưa có proxy key nào.',
        timestamp,
        details: { keyCount: 0 }
      };
    }

    const details: Record<string, string | number | boolean> = { keyCount: keys.length };
    if (typeof info.balance === 'number') details.balance = info.balance;
    if (info.username) details.account = info.username;

    return ok('KiotProxy đã kết nối.', timestamp, details);
  }
}

export interface MultiloginTokenSource {
  getAccessToken(): Promise<string>;
}

export interface MultiloginLauncherApi {
  getLauncherVersion(): Promise<string>;
}

/**
 * Probes Multilogin in two stages: the cloud account must authenticate, and the
 * local launcher agent must answer, because quick profiles are started there.
 * An authenticated account with a dead launcher is reported as a launcher fault
 * so the user knows which half to fix.
 */
export class MultiloginConnectivity implements ConnectivityProvider {
  constructor(
    private readonly auth: MultiloginTokenSource,
    private readonly launcher: MultiloginLauncherApi,
    private readonly clock: ClockLike = defaultClock
  ) {}

  async testConnection(): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    await this.auth.getAccessToken();

    try {
      const launcherVersion = await this.launcher.getLauncherVersion();
      return ok('Multilogin đã kết nối.', timestamp, {
        accountAuthenticated: true,
        launcherVersion
      });
    } catch (err: unknown) {
      const code = err instanceof ProviderError ? err.code : 'NETWORK_ERROR';
      return {
        code: code === 'OK' ? 'NETWORK_ERROR' : code,
        message:
          'Đã đăng nhập Multilogin nhưng không kết nối được launcher tại cổng 45001. ' +
          'Hãy mở ứng dụng Multilogin trước khi chạy.',
        timestamp,
        details: { accountAuthenticated: true, launcherReachable: false }
      };
    }
  }
}

export const CONNECTIVITY_SERVICE_NAMES = [
  GMAIL94_SERVICE_NAME,
  DONGVANFB_SERVICE_NAME,
  KIOTPROXY_SERVICE_NAME,
  MULTILOGIN_SERVICE_NAME
] as const;
