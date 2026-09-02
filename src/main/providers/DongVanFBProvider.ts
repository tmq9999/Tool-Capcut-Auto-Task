import type { HttpClient, HttpResponse } from './HttpClient';
import {
  ProviderError,
  asRecord,
  readBoolean,
  readNumber,
  readString,
  statusToProviderCode
} from './ProviderError';

export const DONGVANFB_SERVICE_NAME = 'dongvanfb';
const DEFAULT_BASE_URL = 'https://api.dongvanfb.net';
const DEFAULT_TOOLS_BASE_URL = 'https://tools.dongvanfb.net';

export type DongVanBuyListFormat = 'full' | 'null' | 'text';

export interface DongVanAccountType {
  id: number | string;
  name: string;
  quality: number | null;
  price: number | null;
}

export interface DongVanPurchasedMail {
  email: string;
  password: string | null;
  refreshToken: string | null;
  clientId: string | null;
  /** Original vendor line, stored encrypted so the purchase can be re-imported. */
  raw: string;
}

export interface DongVanOauth2Pair {
  refreshToken: string;
  clientId: string;
}

export interface DongVanReadCodeParams {
  email: string;
  refreshToken: string;
  clientId: string;
  type: string;
}

export interface DongVanCodeResult {
  code: string;
  content: string | null;
}

export interface DongVanFBProviderOptions {
  baseUrl?: string;
  toolsBaseUrl?: string;
}

function splitPipe(line: string): string[] {
  return line.split('|').map((part) => part.trim());
}

const LINE_FEED = String.fromCharCode(10);

/** Splits a newline-joined payload; trim() also removes a trailing carriage return. */
function splitLines(payload: string): string[] {
  return payload
    .split(LINE_FEED)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * DongVanFB rents Hotmail/Outlook mailboxes and exposes OAuth2 / Graph
 * endpoints to read verification codes from them. The API key travels as a query
 * parameter for GET calls and in the JSON body for POST calls, so it must never
 * be echoed back in an error message.
 */
export class DongVanFBProvider {
  private readonly baseUrl: string;
  private readonly toolsBaseUrl: string;

  constructor(
    private readonly http: HttpClient,
    options: DongVanFBProviderOptions = {}
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.toolsBaseUrl = options.toolsBaseUrl ?? DEFAULT_TOOLS_BASE_URL;
  }

  private unwrap(response: HttpResponse, action: string): Record<string, unknown> {
    const envelope = asRecord(response.body);

    if (!response.ok) {
      throw new ProviderError(
        statusToProviderCode(response.status),
        'DongVanFB ' + action + ' thất bại (HTTP ' + response.status + ').',
        DONGVANFB_SERVICE_NAME
      );
    }

    const status = readBoolean(envelope, 'status') ?? readBoolean(envelope, 'success');
    if (status === false) {
      const message = readString(envelope, 'message');
      throw new ProviderError(
        'CONFIG_ERROR',
        'DongVanFB ' + action + ' thất bại: ' + (message ?? 'không rõ nguyên nhân') + '.',
        DONGVANFB_SERVICE_NAME
      );
    }

    if (!envelope) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'DongVanFB ' + action + ' trả về dữ liệu không đọc được.',
        DONGVANFB_SERVICE_NAME
      );
    }

    return envelope;
  }

  async checkBalance(apiKey: string): Promise<number> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/user/balance?apikey=' + encodeURIComponent(apiKey)
    });
    const envelope = this.unwrap(response, 'đọc số dư');
    const balance = readNumber(envelope, 'balance') ?? readNumber(asRecord(envelope.data), 'balance');
    if (balance === null) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'DongVanFB không trả về số dư.',
        DONGVANFB_SERVICE_NAME
      );
    }
    return balance;
  }

  async listAccountTypes(apiKey: string): Promise<DongVanAccountType[]> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/user/account_type?apikey=' + encodeURIComponent(apiKey)
    });
    const envelope = this.unwrap(response, 'đọc loại tài khoản');
    const rows = Array.isArray(envelope.data)
      ? envelope.data
      : Array.isArray(envelope.list_data) ? envelope.list_data : [];

    return rows.flatMap((entry) => {
      const record = asRecord(entry);
      const name = readString(record, 'name');
      const id = readNumber(record, 'id');
      if (!name || id === null) return [];
      return [{
        id,
        name,
        quality: readNumber(record, 'quality'),
        price: readNumber(record, 'price')
      }];
    });
  }

  private toPurchasedMail(entry: unknown): DongVanPurchasedMail[] {
    if (typeof entry === 'string' && entry.includes('|')) {
      const parts = splitPipe(entry);
      const email = parts[0];
      if (!email) return [];
      return [{
        email,
        password: parts[1] ?? null,
        refreshToken: parts[2] ?? null,
        clientId: parts[3] ?? null,
        raw: entry
      }];
    }

    const record = asRecord(entry);
    const email = readString(record, 'email');
    if (!email) return [];
    const password = readString(record, 'password') ?? readString(record, 'pass');
    const refreshToken = readString(record, 'refresh_token') ?? readString(record, 'refreshToken');
    const clientId = readString(record, 'client_id') ?? readString(record, 'clientId');

    return [{
      email,
      password,
      refreshToken,
      clientId,
      raw: [email, password ?? '', refreshToken ?? '', clientId ?? ''].join('|')
    }];
  }

  /**
   * Buys mailboxes. The vendor endpoint has no quantity parameter, so a caller
   * that needs N mailboxes issues N calls.
   */
  async buyMail(
    apiKey: string,
    params: { accountType: number | string; quality: number | string; type?: DongVanBuyListFormat }
  ): Promise<DongVanPurchasedMail[]> {
    const listFormat = params.type ?? 'full';
    const response = await this.http.send({
      method: 'GET',
      url:
        this.baseUrl + '/user/buy?apikey=' + encodeURIComponent(apiKey) +
        '&account_type=' + encodeURIComponent(String(params.accountType)) +
        '&quality=' + encodeURIComponent(String(params.quality)) +
        '&type=' + encodeURIComponent(listFormat)
    });

    const envelope = this.unwrap(response, 'mua email');

    // The live API nests the purchase under "data": { order_code, ..., list_data }.
    // Older/documented shapes put list_data at the top level, and some responses
    // deliver it as one newline-joined string.
    const nested = asRecord(envelope.data);
    const candidate = nested?.list_data ?? envelope.list_data ?? envelope.data;

    let rows: unknown[];
    if (Array.isArray(candidate)) {
      rows = candidate;
    } else if (typeof candidate === 'string') {
      rows = splitLines(candidate);
    } else {
      rows = [];
    }

    const mails = rows.flatMap((entry) => this.toPurchasedMail(entry));
    if (mails.length === 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'DongVanFB mua email không trả về tài khoản nào.',
        DONGVANFB_SERVICE_NAME
      );
    }
    return mails;
  }

  async getOauth2(apiKey: string, email: string, password: string): Promise<DongVanOauth2Pair> {
    const response = await this.http.send({
      method: 'POST',
      url: this.baseUrl + '/api/getOauth2',
      json: { email, password, apikey: apiKey }
    });

    const envelope = this.unwrap(response, 'lấy OAuth2 token');
    const combined =
      readString(envelope, 'oauth2') ??
      readString(envelope, 'data') ??
      readString(envelope, 'token');

    if (combined && combined.includes('|')) {
      const [refreshToken, clientId] = splitPipe(combined);
      if (refreshToken && clientId) {
        return { refreshToken, clientId };
      }
    }

    const refreshToken = readString(envelope, 'refresh_token') ?? readString(envelope, 'refreshToken');
    const clientId = readString(envelope, 'client_id') ?? readString(envelope, 'clientId');
    if (refreshToken && clientId) {
      return { refreshToken, clientId };
    }

    throw new ProviderError(
      'NETWORK_ERROR',
      'DongVanFB không trả về cặp refresh_token|client_id.',
      DONGVANFB_SERVICE_NAME
    );
  }

  /**
   * Reads the newest verification code for a rented mailbox.
   * Returns null while no code has arrived so callers can poll.
   */
  async readCode(
    mode: 'oauth2' | 'graph',
    params: DongVanReadCodeParams
  ): Promise<DongVanCodeResult | null> {
    const path = mode === 'graph' ? '/api/graph_code' : '/api/get_code_oauth2';
    const response = await this.http.send({
      method: 'POST',
      url: this.toolsBaseUrl + path,
      json: {
        email: params.email,
        refresh_token: params.refreshToken,
        client_id: params.clientId,
        type: params.type
      }
    });

    if (!response.ok) {
      const code = statusToProviderCode(response.status);
      if (code === 'AUTH_ERROR' || code === 'RATE_LIMITED') {
        throw new ProviderError(
          code,
          'DongVanFB đọc mã xác thực thất bại (HTTP ' + response.status + ').',
          DONGVANFB_SERVICE_NAME
        );
      }
      return null;
    }

    const envelope = asRecord(response.body);
    const code = readString(envelope, 'code');
    if (!code) return null;
    return { code, content: readString(envelope, 'content') };
  }

  async createMailServerAddress(apiKey: string): Promise<string> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/user/create_mail_server?apikey=' + encodeURIComponent(apiKey)
    });
    const envelope = this.unwrap(response, 'tạo mail server');
    const email = readString(envelope, 'email') ?? readString(asRecord(envelope.data), 'email');
    if (!email) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'DongVanFB không trả về địa chỉ mail server.',
        DONGVANFB_SERVICE_NAME
      );
    }
    return email;
  }

  async readMailServerCode(apiKey: string, email: string): Promise<string | null> {
    const response = await this.http.send({
      method: 'GET',
      url:
        this.baseUrl + '/user/get_code_mail_server?apikey=' + encodeURIComponent(apiKey) +
        '&email=' + encodeURIComponent(email)
    });
    if (!response.ok) return null;
    const envelope = asRecord(response.body);
    return readString(envelope, 'code');
  }
}
