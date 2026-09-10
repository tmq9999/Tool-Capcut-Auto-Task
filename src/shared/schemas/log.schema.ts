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
  createdAt: z.string().datetime(),
  streamSequence: z.number().int().safe().optional()
}).strict();

export type CanonicalRuntimeLog = z.infer<typeof CanonicalRuntimeLogSchema>;

export const LogsResetPayloadSchema = z.object({
  clearedThrough: z.number().int().safe()
}).strict();

export type LogsResetPayload = z.infer<typeof LogsResetPayloadSchema>;

/**
 * Số dòng tối đa một lần `logs.list` được trả về.
 *
 * Export ra ngoài vì phía renderer PHẢI kẹp request theo đúng con số này. Trước
 * 04/09/2026 trang Logs gửi `pageSize = 1000` trong khi schema chặn ở 500, nên
 * `logsIpc` trả VALIDATION_ERROR và trang chỉ hiện "Không tải được nhật ký
 * runtime." với 0 dòng — dù DB có 1573 dòng. Hai con số phải khớp thì phải có
 * MỘT nguồn.
 */
export const LOG_PAGE_SIZE_MAX = 500;

export const LogFilterSchema = z.object({
  level: z.string().optional(),
  email: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(LOG_PAGE_SIZE_MAX).default(100)
}).strict();

export type LogFilterDTO = z.infer<typeof LogFilterSchema>;
