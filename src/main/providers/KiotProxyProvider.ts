import type { HttpClient, HttpResponse } from './HttpClient';
import {
  ProviderError,
  asRecord,
  readBoolean,
  readNumber,
  readString,
  statusToProviderCode
} from './ProviderError';
import type { ProxyProtocol } from '../repositories/ProxyLeaseRepository';

export const KIOTPROXY_SERVICE_NAME = 'kiotproxy';
const DEFAULT_BASE_URL = 'https://api.kiotproxy.com';

/**
 * The key cannot hand out a new IP right now — most often the rotation window
 * has not elapsed, or the key is already serving another session. The caller is
 * expected to move on to a different key rather than retry this one.
 */
export class ProxyKeyUnavailableError extends ProviderError {
  constructor(public readonly reason: string) {
    super('CONFIG_ERROR', 'Proxy key chưa thể cấp IP mới: ' + reason, KIOTPROXY_SERVICE_NAME);
    this.name = 'ProxyKeyUnavailableError';
  }
}

export interface KiotProxyKeySummary {
  id: number | string;
  keyValue: string;
  expiredAt: string | null;
}

export interface KiotProxyLease {
  keyValue: string;
  ip: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username: string | null;
  password: string | null;
  nextChangeSeconds: number | null;
}

export interface GetNewProxyOptions {
  protocol?: ProxyProtocol;
  region?: string;
  ppua?: string;
}

export interface KiotProxyUserInfo {
  username: string | null;
  balance: number | null;
}

export interface KiotProxyProviderOptions {
  baseUrl?: string;
}

export class KiotProxyProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpClient,
    options: KiotProxyProviderOptions = {}
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * KiotProxy answers { success, data, message }. A transport failure and a
   * success:false body are distinguished so the lease manager can tell an
   * account/auth problem from a key that is simply not ready.
   */
  private unwrap(response: HttpResponse, action: string): { data: unknown; message: string | null } {
    const envelope = asRecord(response.body);
    const message = readString(envelope, 'message');

    if (!response.ok) {
      throw new ProviderError(
        statusToProviderCode(response.status),
        'KiotProxy ' + action + ' thất bại (HTTP ' + response.status + ').',
        KIOTPROXY_SERVICE_NAME
      );
    }

    const success = readBoolean(envelope, 'success');
    if (success === false) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'KiotProxy ' + action + ' thất bại: ' + (message ?? 'không rõ nguyên nhân') + '.',
        KIOTPROXY_SERVICE_NAME
      );
    }

    return { data: envelope?.data ?? null, message };
  }

  async listKeys(apiToken: string): Promise<KiotProxyKeySummary[]> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/api/public/keys',
      headers: { 'Api-token': apiToken }
    });

    const { data } = this.unwrap(response, 'đọc danh sách key');
    const rows = Array.isArray(data) ? data : [];

    return rows.flatMap((entry) => {
      const record = asRecord(entry);

      // api.kiotproxy.com puts the key itself in "value".
      const keyValue =
        readString(record, 'value') ??
        readString(record, 'keyValue') ??
        readString(record, 'key') ??
        readString(record, 'key_value');
      if (!keyValue) return [];

      // A deleted or non-active key cannot serve traffic, so it must not count
      // toward the pool a run draws from.
      if (readBoolean(record, 'deleted') === true) return [];
      const keyStatus = readString(record, 'status');
      if (keyStatus !== null && keyStatus.toUpperCase() !== 'ACTIVE') return [];

      const id = readString(record, 'id') ?? readNumber(record, 'id') ?? keyValue;

      // Expiry arrives as epoch milliseconds ("expirationAt") on the live API.
      const expiryMs =
        readNumber(record, 'expirationAt') ??
        readNumber(record, 'expiration_at') ??
        readNumber(record, 'expiredAt');
      const expiredAt = expiryMs !== null
        ? new Date(expiryMs).toISOString()
        : readString(record, 'expiredAt') ??
          readString(record, 'expired_at') ??
          readString(record, 'expiredTime');

      return [{ id, keyValue, expiredAt: expiredAt ?? null }];
    });
  }

  private toLease(
    keyValue: string,
    data: unknown,
    protocol: ProxyProtocol
  ): KiotProxyLease {
    const record = asRecord(data);
    const ip = readString(record, 'ip') ?? readString(record, 'host') ?? readString(record, 'proxyIp');
    const socksPort =
      readNumber(record, 'socks5Port') ??
      readNumber(record, 'socks5_port') ??
      readNumber(record, 'socksPort');
    const httpPort =
      readNumber(record, 'httpPort') ??
      readNumber(record, 'http_port') ??
      readNumber(record, 'port');
    const port = protocol === 'socks5' ? socksPort ?? httpPort : httpPort ?? socksPort;

    if (!ip || port === null) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'KiotProxy trả về dữ liệu proxy không nhận dạng được.',
        KIOTPROXY_SERVICE_NAME
      );
    }

    const username =
      readString(record, 'httpUsername') ??
      readString(record, 'username') ??
      readString(record, 'user');
    const password =
      readString(record, 'httpPassword') ??
      readString(record, 'password') ??
      readString(record, 'pass');
    const nextChangeSeconds =
      readNumber(record, 'nextChangeSeconds') ??
      readNumber(record, 'next_change_seconds') ??
      readNumber(record, 'ttl');

    return {
      keyValue,
      ip,
      host: ip,
      port,
      protocol,
      username: username ?? null,
      password: password ?? null,
      nextChangeSeconds: nextChangeSeconds ?? null
    };
  }

  /**
   * Always asks the gateway for a brand-new IP. Any non-auth failure is surfaced
   * as ProxyKeyUnavailableError so the caller switches to another key instead of
   * retrying — the same IP is never handed out twice by design.
   */
  async getNewProxy(keyValue: string, options: GetNewProxyOptions = {}): Promise<KiotProxyLease> {
    const protocol: ProxyProtocol = options.protocol ?? 'http';
    const json: Record<string, string> = { keyValue };
    if (options.region) json.region = options.region;
    if (options.ppua) json.ppua = options.ppua;

    const response = await this.http.send({
      method: 'POST',
      url: this.baseUrl + '/api/public/proxies/get-new',
      json
    });

    let payload: { data: unknown };
    try {
      payload = this.unwrap(response, 'lấy proxy mới');
    } catch (err: unknown) {
      if (err instanceof ProviderError && (err.code === 'AUTH_ERROR' || err.code === 'RATE_LIMITED')) {
        throw err;
      }
      const reason = err instanceof Error ? err.message : 'không rõ nguyên nhân';
      throw new ProxyKeyUnavailableError(reason);
    }

    return this.toLease(keyValue, payload.data, protocol);
  }

  async getCurrentProxy(keyValue: string, protocol: ProxyProtocol = 'http'): Promise<KiotProxyLease> {
    const response = await this.http.send({
      method: 'POST',
      url: this.baseUrl + '/api/public/proxies/get-current',
      json: { keyValue }
    });
    const { data } = this.unwrap(response, 'lấy proxy hiện tại');
    return this.toLease(keyValue, data, protocol);
  }

  /** Best-effort release. A gateway that already rotated the key is not an error. */
  async releaseKey(keyValue: string): Promise<void> {
    const response = await this.http.send({
      method: 'POST',
      url: this.baseUrl + '/api/public/proxies/out',
      json: { keyValue }
    });

    if (!response.ok) return;
    const envelope = asRecord(response.body);
    if (readBoolean(envelope, 'success') === false) return;
  }

  async getUserInfo(apiToken: string): Promise<KiotProxyUserInfo> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/api/public/get-user-info',
      headers: { 'Api-token': apiToken }
    });
    const { data } = this.unwrap(response, 'đọc thông tin tài khoản');
    const record = asRecord(data);
    return {
      username: readString(record, 'username') ?? readString(record, 'name'),
      balance: readNumber(record, 'balance') ?? readNumber(record, 'money')
    };
  }
}
