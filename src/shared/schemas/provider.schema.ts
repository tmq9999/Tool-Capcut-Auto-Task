import { z } from 'zod';

/**
 * Normalized, provider-agnostic shapes that cross the IPC boundary.
 * Vendor-specific response structures never leave src/main/providers.
 * No schema here may carry a plaintext secret (AGENTS.md §13).
 */

/** Vendors that sell mailboxes and therefore need an API key in Settings. */
export const EmailApiProviderEnum = z.enum(['gmail94', 'dongvanfb']);
export type EmailApiProvider = z.infer<typeof EmailApiProviderEnum>;

/**
 * Every email source a run can draw from. `customdomain` is a catch-all domain
 * the operator owns: addresses are generated locally and read back over HTTP, so
 * it costs nothing and needs no API key.
 */
export const EmailSourceProviderEnum = z.enum(['gmail94', 'dongvanfb', 'customdomain']);
export type EmailSourceProvider = z.infer<typeof EmailSourceProviderEnum>;

export const PurchasedEmailDTOSchema = z.object({
  id: z.string().min(1),
  provider: EmailSourceProviderEnum,
  email: z.string().min(1),
  hasPassword: z.boolean(),
  hasOauth: z.boolean(),
  orderId: z.string().nullable(),
  service: z.string().nullable(),
  purchasedAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable()
}).strict();
export type PurchasedEmailDTO = z.infer<typeof PurchasedEmailDTOSchema>;

export const QuickProfileDTOSchema = z.object({
  profileId: z.string().min(1),
  /** Null when the browser runtime does not report a debug port at start. */
  port: z.number().int().min(1).max(65535).nullable(),
  browserType: z.string().min(1)
}).strict();
export type QuickProfileDTO = z.infer<typeof QuickProfileDTOSchema>;

export const ProxyKeySummaryDTOSchema = z.object({
  id: z.union([z.number(), z.string()]),
  maskedKey: z.string().min(1),
  isAvailable: z.boolean(),
  expiredAt: z.string().nullable()
}).strict();
export type ProxyKeySummaryDTO = z.infer<typeof ProxyKeySummaryDTOSchema>;

export const EmailProviderConfigDTOSchema = z.object({
  provider: EmailApiProviderEnum,
  isConfigured: z.boolean(),
  maskedHint: z.string()
}).strict();
export type EmailProviderConfigDTO = z.infer<typeof EmailProviderConfigDTOSchema>;
