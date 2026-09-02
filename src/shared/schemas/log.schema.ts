import { z } from 'zod';

export const CanonicalLogStatusSchema = z.enum([
  'INFO', 'SUCCESS', 'WARNING', 'WAITING', 'ERROR', 'DEBUG'
]);
export type CanonicalLogStatus = z.infer<typeof CanonicalLogStatusSchema>;

export const CanonicalRuntimeLogSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().optional(),
  email: z.string(),
  step: z.string(),
  status: CanonicalLogStatusSchema,
  message: z.string(),
  createdAt: z.string().datetime()
}).strict();

export type CanonicalRuntimeLog = z.infer<typeof CanonicalRuntimeLogSchema>;

export const LogFilterSchema = z.object({
  level: z.string().optional(),
  email: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(100)
}).strict();

export type LogFilterDTO = z.infer<typeof LogFilterSchema>;
