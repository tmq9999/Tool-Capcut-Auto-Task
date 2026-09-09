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

  async testConnection(draft?: unknown): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const isDraft = typeof draft === 'string';
    const explicitToken = isDraft ? draft.trim() : undefined;

    if (explicitToken !== undefined && explicitToken.length === 0) {
      return {
        code: 'CONFIG_ERROR',
        message: 'API key đang trống. Vui lòng nhập key trước khi kiểm tra.',
        timestamp,
      };
    }

    const token = explicitToken ?? this.secrets.readSimpleKey(GMAIL94_SERVICE_NAME);
    const profile = await this.api.getProfile(token);

    const details: Record<string, string | number | boolean> = {};
    if (typeof profile.balance === 'number') details.balance = profile.balance;
    if (profile.name) details.account = profile.name;

    const msg = isDraft ? 'Gmail94 đã kết nối với key vừa nhập.' : 'Gmail94 đã kết nối (khóa đã lưu).';
    return ok(msg, timestamp, Object.keys(details).length > 0 ? details : undefined);
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

  async testConnection(draft?: unknown): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const isDraft = typeof draft === 'string';
    const explicitKey = isDraft ? draft.trim() : undefined;

    if (explicitKey !== undefined && explicitKey.length === 0) {
      return {
        code: 'CONFIG_ERROR',
        message: 'API key đang trống. Vui lòng nhập key trước khi kiểm tra.',
        timestamp,
      };
    }

    const apiKey = explicitKey ?? this.secrets.readSimpleKey(DONGVANFB_SERVICE_NAME);
    const balance = await this.api.checkBalance(apiKey);
    const msg = isDraft ? 'DongVanFB đã kết nối với key vừa nhập.' : 'DongVanFB đã kết nối (khóa đã lưu).';
    return ok(msg, timestamp, { balance });
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

  async testConnection(draft?: unknown): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const isDraft = typeof draft === 'string';
    const explicitToken = isDraft ? draft.trim() : undefined;

    if (explicitToken !== undefined && explicitToken.length === 0) {
      return {
        code: 'CONFIG_ERROR',
        message: 'API token KiotProxy đang trống. Vui lòng nhập token trước khi kiểm tra.',
        timestamp,
      };
    }

    const apiToken = explicitToken ?? this.secrets.readSimpleKey(KIOTPROXY_SERVICE_NAME);

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

    const msg = isDraft ? 'KiotProxy đã kết nối với token vừa nhập.' : 'KiotProxy đã kết nối (khóa đã lưu).';
    return ok(msg, timestamp, details);
  }
}

export interface MultiloginTokenSource {
  getAccessToken(draft?: unknown): Promise<string>;
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

  async testConnection(draft?: unknown): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const isDraftObj = typeof draft === 'object' && draft !== null && 'mode' in draft;

    if (isDraftObj) {
      const mlDraft = draft as { mode: 'token' | 'credentials'; automationToken?: string; email?: string; password?: string };
      if (mlDraft.mode === 'token') {
        const token = mlDraft.automationToken?.trim();
        if (!token) {
          return {
            code: 'CONFIG_ERROR',
            message: 'Automation token Multilogin đang trống.',
            timestamp,
          };
        }
      } else if (mlDraft.mode === 'credentials') {
        const email = mlDraft.email?.trim();
        const password = mlDraft.password?.trim();
        if (!email || !password) {
          return {
            code: 'CONFIG_ERROR',
            message: 'Email hoặc mật khẩu Multilogin đang trống.',
            timestamp,
          };
        }
      }
    }

    await this.auth.getAccessToken(draft);

    try {
      const launcherVersion = await this.launcher.getLauncherVersion();
      const msg = isDraftObj ? 'Multilogin đã kết nối thành công với thông tin vừa nhập.' : 'Multilogin đã kết nối (khóa đã lưu).';
      return ok(msg, timestamp, {
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
