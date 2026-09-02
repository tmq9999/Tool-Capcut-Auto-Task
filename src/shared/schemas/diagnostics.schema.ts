import { z } from 'zod';

export const DiagnosticStatusEnum = z.enum([
  'unknown', 'testing', 'connected', 'degraded', 'offline'
]);
export type DiagnosticStatus = z.infer<typeof DiagnosticStatusEnum>;

export const SanitizedDiagnosticDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
).optional();

export const SanitizedDiagnosticResultSchema = z.object({
  code: z.enum(['OK', 'AUTH_ERROR', 'NETWORK_ERROR', 'RATE_LIMITED', 'CONFIG_ERROR', 'PROVIDER_NOT_IMPLEMENTED']),
  message: z.string().min(1),
  timestamp: z.string().datetime(),
  details: SanitizedDiagnosticDetailsSchema
}).strict();

export type SanitizedDiagnosticResult = z.infer<typeof SanitizedDiagnosticResultSchema>;

export const CredentialDiagnosticMetadataSchema = z.object({
  maskedHint: z.string(),
  status: DiagnosticStatusEnum,
  lastTestedAt: z.string().datetime().optional(),
  lastTestResult: SanitizedDiagnosticResultSchema.optional(),
  balance: z.number().optional(),
  balanceFetchedAt: z.string().datetime().optional()
}).strict();

export type CredentialDiagnosticMetadata = z.infer<typeof CredentialDiagnosticMetadataSchema>;

export const CredentialStatusDTOSchema = z.object({
  serviceName: z.string(),
  isConfigured: z.boolean(),
  isStale: z.boolean(),
  metadata: CredentialDiagnosticMetadataSchema
}).strict();

export type CredentialStatusDTO = z.infer<typeof CredentialStatusDTOSchema>;
