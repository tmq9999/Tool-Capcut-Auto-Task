import { z } from 'zod';

export const NormalizedIpcErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
}).strict();

export type NormalizedIpcError = z.infer<typeof NormalizedIpcErrorSchema>;

export function createIpcEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      data: dataSchema
    }).strict(),
    z.object({
      success: z.literal(false),
      error: NormalizedIpcErrorSchema
    }).strict()
  ]);
}

export type IpcEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: NormalizedIpcError };
