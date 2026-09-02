import crypto from 'node:crypto';
import type { HttpClient, HttpResponse } from './HttpClient';
import {
  ProviderError,
  asRecord,
  readNumber,
  readString,
  statusToProviderCode
} from './ProviderError';

export const MULTILOGIN_SERVICE_NAME = 'multilogin';
const DEFAULT_API_BASE_URL = 'https://api.multilogin.com';
const DEFAULT_LAUNCHER_BASE_URL = 'https://launcher.mlx.yt:45001';

/** Regular JWT tokens live 30 minutes; refresh a little early. */
export const MULTILOGIN_TOKEN_TTL_MS = 30 * 60_000;
export const MULTILOGIN_TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

export interface MultiloginTokens {
  token: string;
  refreshToken: string;
}

export interface MultiloginProxyConnection {
  host: string;
  port: number;
  type: string;
  username?: string;
  password?: string;
}

export interface StartQuickProfileParams {
  isHeadless: boolean;
  browserType?: string;
  osType?: string;
  automation?: string;
  proxy?: MultiloginProxyConnection;
}

export interface MultiloginQuickProfileStatus {
  profileId: string;
  status: string;
  port: number | null;
  browserType: string;
}

export interface MultiloginQuickProfile {
  profileId: string;
  /**
   * Remote-debugging port. Launcher 12.x does not report it on the start
   * response; it appears later in GET /api/v1/profile/quick/statuses. Null means
   * "not reported yet", which is normal and not a failure.
   */
  port: number | null;
  browserType: string;
}

export interface MultiloginProviderOptions {
  apiBaseUrl?: string;
  launcherBaseUrl?: string;
}

export function md5Hex(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

function defaultOsType(): string {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'windows';
}

export class MultiloginProvider {
  private readonly apiBaseUrl: string;
  private readonly launcherBaseUrl: string;

  constructor(
    private readonly http: HttpClient,
    options: MultiloginProviderOptions = {}
  ) {
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.launcherBaseUrl = options.launcherBaseUrl ?? DEFAULT_LAUNCHER_BASE_URL;
  }

  /**
   * Unwraps the shared Multilogin envelope { status: {...}, data: {...} }.
   * The launcher can answer transport 200 while reporting a failure inside
   * status.http_code, so both layers are checked.
   */
  private unwrap(response: HttpResponse, action: string): Record<string, unknown> {
    const envelope = asRecord(response.body);
    const status = asRecord(envelope?.status);
    const innerCode = readNumber(status, 'http_code');
    const vendorMessage = readString(status, 'message') ?? readString(status, 'error_code');

    if (!response.ok) {
      throw new ProviderError(
        statusToProviderCode(response.status),
        'Multilogin ' + action + ' thất bại (HTTP ' + response.status + ').',
        MULTILOGIN_SERVICE_NAME
      );
    }

    if (innerCode !== null && (innerCode < 200 || innerCode >= 300)) {
      throw new ProviderError(
        statusToProviderCode(innerCode),
        'Multilogin ' + action + ' thất bại: ' + (vendorMessage ?? 'HTTP ' + innerCode) + '.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    if (!envelope) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Multilogin ' + action + ' trả về dữ liệu không đọc được.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    return asRecord(envelope.data) ?? {};
  }

  private readTokens(data: Record<string, unknown>, action: string): MultiloginTokens {
    const token = readString(data, 'token');
    const refreshToken = readString(data, 'refresh_token');
    if (!token || !refreshToken) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Multilogin ' + action + ' không trả về đủ token.',
        MULTILOGIN_SERVICE_NAME
      );
    }
    return { token, refreshToken };
  }

  /** Signs in with the account password. The password is md5-hashed as the API requires. */
  async signIn(email: string, password: string): Promise<MultiloginTokens> {
    const response = await this.http.send({
      method: 'POST',
      url: this.apiBaseUrl + '/user/signin',
      json: { email, password: md5Hex(password) }
    });
    return this.readTokens(this.unwrap(response, 'đăng nhập'), 'đăng nhập');
  }

  async refreshTokens(
    email: string,
    refreshToken: string,
    workspaceId?: string
  ): Promise<MultiloginTokens> {
    const json: Record<string, string> = { email, refresh_token: refreshToken };
    if (workspaceId) {
      json.workspace_id = workspaceId;
    }

    const response = await this.http.send({
      method: 'POST',
      url: this.apiBaseUrl + '/user/refresh_token',
      json
    });
    return this.readTokens(this.unwrap(response, 'làm mới token'), 'làm mới token');
  }

  async startQuickProfile(
    token: string,
    params: StartQuickProfileParams
  ): Promise<MultiloginQuickProfile> {
    const parameters: Record<string, unknown> = {};
    if (params.proxy) {
      const proxy: Record<string, unknown> = {
        host: params.proxy.host,
        port: params.proxy.port,
        type: params.proxy.type
      };
      if (params.proxy.username) proxy.username = params.proxy.username;
      if (params.proxy.password) proxy.password = params.proxy.password;
      parameters.proxy = proxy;
    }

    const json: Record<string, unknown> = {
      browser_type: params.browserType ?? 'mimic',
      os_type: params.osType ?? defaultOsType(),
      is_headless: params.isHeadless,
      parameters
    };
    if (params.automation) {
      json.automation = params.automation;
    }

    const response = await this.http.send({
      method: 'POST',
      url: this.launcherBaseUrl + '/api/v3/profile/quick',
      headers: { Authorization: 'Bearer ' + token },
      json
    });

    const data = this.unwrap(response, 'khởi chạy quick profile');
    const profileId = readString(data, 'id');
    if (!profileId) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Multilogin không trả về profile id của quick profile.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    return {
      profileId,
      port: readNumber(data, 'port'),
      browserType: readString(data, 'browser_type') ?? (params.browserType ?? 'mimic')
    };
  }

  async stopProfile(token: string, profileId: string): Promise<void> {
    const response = await this.http.send({
      method: 'GET',
      url: this.launcherBaseUrl + '/api/v1/profile/stop/p/' + encodeURIComponent(profileId),
      headers: { Authorization: 'Bearer ' + token }
    });
    this.unwrap(response, 'dừng profile');
  }

  /**
   * Quick profile states keyed by profile id. The remote-debugging port is not
   * available on the start response; it shows up here once the browser has
   * finished booting, which is what an automation client attaches to.
   */
  async getQuickProfileStatuses(token: string): Promise<MultiloginQuickProfileStatus[]> {
    const response = await this.http.send({
      method: 'GET',
      url: this.launcherBaseUrl + '/api/v1/profile/quick/statuses',
      headers: { Authorization: 'Bearer ' + token }
    });

    const data = this.unwrap(response, 'đọc trạng thái quick profile');
    const states = asRecord(data.states);
    if (!states) return [];

    return Object.entries(states).flatMap(([profileId, rawState]) => {
      const state = asRecord(rawState);
      if (!state) return [];
      return [{
        profileId: readString(state, 'profile_id') ?? profileId,
        status: readString(state, 'status') ?? 'unknown',
        // Some launcher builds only report the port through "message".
        port: readNumber(state, 'port') ?? readNumber(state, 'message'),
        browserType: readString(state, 'browser_type') ?? 'mimic'
      }];
    });
  }

  /** Launcher agent version. Used as the local-agent connectivity probe. */
  async getLauncherVersion(): Promise<string> {
    const response = await this.http.send({
      method: 'GET',
      url: this.launcherBaseUrl + '/api/v1/version'
    });
    const data = this.unwrap(response, 'đọc phiên bản launcher');
    const version = readString(data, 'version');
    if (!version) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Multilogin launcher không trả về phiên bản.',
        MULTILOGIN_SERVICE_NAME
      );
    }
    return version;
  }

  async listWorkspaceFolders(token: string): Promise<Array<{ folderId: string; name: string }>> {
    const response = await this.http.send({
      method: 'GET',
      url: this.apiBaseUrl + '/workspace/folders',
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = this.unwrap(response, 'đọc danh sách folder');
    const folders = Array.isArray(data.folders) ? data.folders : [];
    return folders.flatMap((entry) => {
      const record = asRecord(entry);
      const folderId = readString(record, 'folder_id');
      const name = readString(record, 'name');
      return folderId ? [{ folderId, name: name ?? folderId }] : [];
    });
  }
}
