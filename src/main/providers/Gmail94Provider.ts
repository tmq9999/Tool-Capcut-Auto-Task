import type { HttpClient, HttpResponse } from './HttpClient';
import {
  ProviderError,
  asRecord,
  readBoolean,
  readNumber,
  readString,
  statusToProviderCode
} from './ProviderError';

export const GMAIL94_SERVICE_NAME = 'gmail94';
const DEFAULT_BASE_URL = 'https://gmail94.com/api';

export interface Gmail94Profile {
  name: string | null;
  email: string | null;
  balance: number | null;
}

export interface Gmail94OtpOrder {
  email: string;
  orderId: string;
}

export interface Gmail94Service {
  id: number | string;
  name: string;
  slug: string;
  price: number | null;
}

export interface Gmail94ProviderOptions {
  baseUrl?: string;
}

/**
 * Gmail94 rents disposable mailboxes: creating an order returns the mailbox plus
 * an order id, and the OTP is later read back with that order id. The API token
 * travels as a query parameter, so it must never appear in an error message.
 */
export class Gmail94Provider {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpClient,
    options: Gmail94ProviderOptions = {}
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private unwrap(response: HttpResponse, action: string): Record<string, unknown> {
    const envelope = asRecord(response.body);

    if (!response.ok) {
      throw new ProviderError(
        statusToProviderCode(response.status),
        'Gmail94 ' + action + ' thất bại (HTTP ' + response.status + ').',
        GMAIL94_SERVICE_NAME
      );
    }

    const success = readBoolean(envelope, 'success') ?? readBoolean(envelope, 'status');
    if (success === false) {
      const message = readString(envelope, 'message');
      const insufficient =
        action === 'mua email' &&
        typeof message === 'string' &&
        /không đủ tiền/i.test(message);

      throw new ProviderError(
        insufficient ? 'INSUFFICIENT_FUNDS' : 'CONFIG_ERROR',
        insufficient
          ? 'Số dư Gmail94 không đủ để mua email CapCut.'
          : 'Gmail94 ' + action + ' thất bại: ' + (message ?? 'không rõ nguyên nhân') + '.',
        GMAIL94_SERVICE_NAME
      );
    }

    if (!envelope) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Gmail94 ' + action + ' trả về dữ liệu không đọc được.',
        GMAIL94_SERVICE_NAME
      );
    }

    return envelope;
  }

  async getProfile(token: string): Promise<Gmail94Profile> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/profile?token=' + encodeURIComponent(token)
    });
    const data = asRecord(this.unwrap(response, 'đọc thông tin tài khoản').data);
    return {
      name: readString(data, 'name'),
      email: readString(data, 'email'),
      balance: readNumber(data, 'money') ?? readNumber(data, 'balance')
    };
  }

  /** Rents one mailbox for the given service. The order id is required to read the OTP later. */
  async createOtpOrder(token: string, service: string): Promise<Gmail94OtpOrder> {
    const response = await this.http.send({
      method: 'GET',
      url:
        this.baseUrl +
        '/otp/create?token=' + encodeURIComponent(token) +
        '&service=' + encodeURIComponent(service)
    });

    const data = asRecord(this.unwrap(response, 'mua email').data);
    const email = readString(data, 'email');
    const orderId = readString(data, 'order_id') ?? readString(data, 'orderId');

    if (!email || !orderId) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Gmail94 mua email không trả về email hoặc order id.',
        GMAIL94_SERVICE_NAME
      );
    }

    return { email, orderId };
  }

  /**
   * Reads the verification code for a rented mailbox.
   * Returns null while the code has not arrived — only auth and transport
   * failures are raised, so callers can poll safely.
   */
  async readOtp(token: string, orderId: string, service: string): Promise<string | null> {
    const response = await this.http.send({
      method: 'GET',
      url:
        this.baseUrl +
        '/otp/read?token=' + encodeURIComponent(token) +
        '&order_id=' + encodeURIComponent(orderId) +
        '&service=' + encodeURIComponent(service)
    });

    if (!response.ok) {
      const code = statusToProviderCode(response.status);
      if (code === 'AUTH_ERROR' || code === 'RATE_LIMITED') {
        throw new ProviderError(
          code,
          'Gmail94 đọc OTP thất bại (HTTP ' + response.status + ').',
          GMAIL94_SERVICE_NAME
        );
      }
      return null;
    }

    const envelope = asRecord(response.body);
    return readString(envelope, 'otp') ?? readString(asRecord(envelope?.data), 'otp');
  }

  async listServices(): Promise<Gmail94Service[]> {
    const response = await this.http.send({
      method: 'GET',
      url: this.baseUrl + '/services'
    });

    const envelope = this.unwrap(response, 'đọc danh sách dịch vụ');
    const rows = Array.isArray(envelope.data) ? envelope.data : [];

    return rows.flatMap((entry) => {
      const record = asRecord(entry);
      const slug = readString(record, 'slug');
      if (!slug) return [];
      const id = readNumber(record, 'id') ?? slug;
      return [{
        id,
        name: readString(record, 'name') ?? slug,
        slug,
        price: readNumber(record, 'price')
      }];
    });
  }
}
