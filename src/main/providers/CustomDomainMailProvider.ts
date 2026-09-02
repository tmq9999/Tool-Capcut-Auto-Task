import type { HttpClient, HttpResponse } from './HttpClient';
import { ProviderError, asRecord, readBoolean, readNumber, readString, statusToProviderCode } from './ProviderError';

export const CUSTOM_DOMAIN_SERVICE_NAME = 'customdomain';

/** Mail a CapCut verification code is expected to arrive from. */
export const DEFAULT_OTP_SENDER_FRAGMENT = 'capcut';

/** A code is 4 to 8 digits; anything longer is an order or reference number. */
const OTP_PATTERN = /(?<!\d)(\d{4,8})(?!\d)/;

export interface CustomDomainEmail {
  id: string;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  read: boolean;
  hasAttachments: boolean;
}

export interface CustomDomainInbox {
  address: string;
  count: number;
  emails: CustomDomainEmail[];
}

export interface ReadOtpOptions {
  /** Substring matched against the sender address. Defaults to CapCut. */
  senderContains?: string;
}

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path;
}

/**
 * Reads a catch-all domain the operator owns (for example @oldevlk.com) over a
 * plain HTTP inbox API. Addresses are generated locally rather than bought, so
 * there is no API key, no order and no mailbox password — only reading.
 *
 * The verification code lives in the subject line, which is all this API exposes.
 */
export class CustomDomainMailProvider {
  constructor(private readonly http: HttpClient) {}

  private toEmail(entry: unknown): CustomDomainEmail[] {
    const record = asRecord(entry);
    const id = readString(record, 'id');
    if (!id) return [];
    return [{
      id,
      from: readString(record, 'from') ?? '',
      fromAddress: readString(record, 'fromAddress') ?? '',
      subject: readString(record, 'subject') ?? '',
      date: readString(record, 'date') ?? '',
      read: readBoolean(record, 'read') ?? false,
      hasAttachments: readBoolean(record, 'hasAttachments') ?? false
    }];
  }

  private unwrap(response: HttpResponse, address: string): CustomDomainInbox {
    if (!response.ok) {
      throw new ProviderError(
        statusToProviderCode(response.status),
        'Đọc hộp thư ' + address + ' thất bại (HTTP ' + response.status + ').',
        CUSTOM_DOMAIN_SERVICE_NAME
      );
    }

    const envelope = asRecord(response.body);
    const returnedAddress = readString(envelope, 'address');
    if (!envelope || !returnedAddress || !Array.isArray(envelope.emails)) {
      throw new ProviderError(
        'NETWORK_ERROR',
        'Dịch vụ mail domain trả về dữ liệu không nhận dạng được.',
        CUSTOM_DOMAIN_SERVICE_NAME
      );
    }

    const emails = envelope.emails.flatMap((entry) => this.toEmail(entry));
    return {
      address: returnedAddress,
      count: readNumber(envelope, 'count') ?? emails.length,
      emails
    };
  }

  async listInbox(baseUrl: string, address: string): Promise<CustomDomainInbox> {
    const response = await this.http.send({
      method: 'GET',
      url: joinUrl(baseUrl, '/api/emails/' + encodeURIComponent(address))
    });
    return this.unwrap(response, address);
  }

  /**
   * Newest matching mail wins. Returns null while no code has arrived, so a
   * caller can poll without treating an empty inbox as a failure.
   */
  async readOtp(
    baseUrl: string,
    address: string,
    options: ReadOtpOptions = {}
  ): Promise<string | null> {
    const senderFragment = (options.senderContains ?? DEFAULT_OTP_SENDER_FRAGMENT).toLowerCase();
    const inbox = await this.listInbox(baseUrl, address);

    const candidates = inbox.emails
      .filter((email) => email.fromAddress.toLowerCase().includes(senderFragment))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    for (const email of candidates) {
      const match = OTP_PATTERN.exec(email.subject);
      if (match) return match[1];
    }

    return null;
  }
}
