import { describe, it, expect } from 'vitest';
import {
  EmailApiProviderEnum,
  EmailSourceProviderEnum,
  PurchasedEmailDTOSchema,
  QuickProfileDTOSchema,
  ProxyKeySummaryDTOSchema,
  EmailProviderConfigDTOSchema
} from '../provider.schema';

describe('provider.schema', () => {
  it('accepts every implemented email source, including the custom domain', () => {
    expect(EmailSourceProviderEnum.safeParse('gmail94').success).toBe(true);
    expect(EmailSourceProviderEnum.safeParse('dongvanfb').success).toBe(true);
    expect(EmailSourceProviderEnum.safeParse('customdomain').success).toBe(true);
    expect(EmailSourceProviderEnum.safeParse('gologin').success).toBe(false);
  });

  it('keeps the api-key vendors separate from the custom domain', () => {
    // Only these two need an API key, so only these two appear in Settings.
    expect(EmailApiProviderEnum.options).toEqual(['gmail94', 'dongvanfb']);
    expect(EmailApiProviderEnum.safeParse('customdomain').success).toBe(false);
  });

  it('parses a custom-domain mailbox that has no password and no order id', () => {
    const parsed = PurchasedEmailDTOSchema.parse({
      id: 'pe-9',
      provider: 'customdomain',
      email: 'toibisidamatroi19090@oldevlk.com',
      hasPassword: false,
      hasOauth: false,
      orderId: null,
      service: null,
      purchasedAt: '2026-09-01T10:00:00.000Z',
      consumedAt: null
    });
    expect(parsed.provider).toBe('customdomain');
  });

  it('parses a purchased email DTO that carries no plaintext secret', () => {
    const parsed = PurchasedEmailDTOSchema.parse({
      id: 'pe-1',
      provider: 'gmail94',
      email: 'doducs60830@gmail.com',
      hasPassword: false,
      hasOauth: false,
      orderId: '68bdb654d878a',
      service: 'facebook',
      purchasedAt: '2026-09-01T10:00:00.000Z',
      consumedAt: null
    });
    expect(parsed.orderId).toBe('68bdb654d878a');
  });

  it('rejects a purchased email DTO that leaks a password field', () => {
    const result = PurchasedEmailDTOSchema.safeParse({
      id: 'pe-1',
      provider: 'dongvanfb',
      email: 'a@hotmail.com',
      password: 'plaintext-leak',
      hasPassword: true,
      hasOauth: true,
      orderId: null,
      service: null,
      purchasedAt: '2026-09-01T10:00:00.000Z',
      consumedAt: null
    });
    expect(result.success).toBe(false);
  });

  it('parses a quick profile DTO with a numeric debug port', () => {
    const parsed = QuickProfileDTOSchema.parse({
      profileId: 'd04aa438-d887-11ef-8d6d-0a0027000012',
      port: 55579,
      browserType: 'mimic'
    });
    expect(parsed.port).toBe(55579);
  });

  it('accepts a quick profile whose runtime reported no port yet', () => {
    const parsed = QuickProfileDTOSchema.parse({
      profileId: '51590a68-a5c8-11f1-8304-10ffe099466c',
      port: null,
      browserType: 'mimic'
    });
    expect(parsed.port).toBeNull();
  });

  it('never exposes a raw proxy key value in the summary DTO', () => {
    const parsed = ProxyKeySummaryDTOSchema.parse({
      id: 12,
      maskedKey: 'kp••••7f2a',
      isAvailable: true,
      expiredAt: null
    });
    expect(parsed.maskedKey).not.toContain('kiotproxy');
    expect(ProxyKeySummaryDTOSchema.safeParse({
      id: 12,
      keyValue: 'REAL-KEY',
      maskedKey: 'kp••••7f2a',
      isAvailable: true,
      expiredAt: null
    }).success).toBe(false);
  });

  it('reports email provider config as masked hint plus configured flag', () => {
    const parsed = EmailProviderConfigDTOSchema.parse({
      provider: 'dongvanfb',
      isConfigured: true,
      maskedHint: '••••••••'
    });
    expect(parsed.isConfigured).toBe(true);
  });
});
