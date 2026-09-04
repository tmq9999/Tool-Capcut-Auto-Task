import { z } from 'zod';
import { ExportFieldEnum } from './settings.schema';

/**
 * Định dạng file xuất. Chữ hoa vì đây là nhãn người dùng thấy trên nút bấm
 * (`shared/types/account.ts`); Settings lưu bản chữ thường (`exportConfig
 * .defaultFormat`) và renderer đổi qua lại — hai chỗ đó đã có bảng ánh xạ.
 */
export const AccountExportFormatEnum = z.enum(['TXT', 'CSV', 'XLSX']);
export type AccountExportFormat = z.infer<typeof AccountExportFormatEnum>;

/**
 * Bộ lọc cho phạm vi "đang lọc". Cùng ba khoá với `AccountFilterSchema` nhưng
 * KHÔNG có `page`/`pageSize`: xuất file phải lấy hết dòng khớp bộ lọc, không
 * phải mỗi trang đang xem.
 */
export const AccountExportFilterSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  emailProvider: z.string().optional(),
  createdFrom: z.string().datetime().optional()
}).strict();
export type AccountExportFilterDTO = z.infer<typeof AccountExportFilterSchema>;

export const AccountExportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('checked'),
    ids: z.array(z.string().min(1)).min(1)
  }).strict(),
  z.object({
    kind: z.literal('filtered'),
    filter: AccountExportFilterSchema
  }).strict()
]);
export type AccountExportScopeDTO = z.infer<typeof AccountExportScopeSchema>;

export const AccountExportRequestSchema = z.object({
  format: AccountExportFormatEnum,
  fields: z.array(ExportFieldEnum).min(1),
  scope: AccountExportScopeSchema
}).strict();
export type AccountExportRequestDTO = z.infer<typeof AccountExportRequestSchema>;

/**
 * Kết quả xuất. `filePath` là đường dẫn file, KHÔNG phải nội dung: giá trị đã
 * giải mã (mật khẩu CapCut, email data) không bao giờ đi qua IPC về renderer
 * (AGENTS §13) — main ghi thẳng ra đĩa.
 */
export const AccountExportResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().nullable(),
  exportedCount: z.number().int().min(0)
}).strict();
export type AccountExportResultDTO = z.infer<typeof AccountExportResultSchema>;

/**
 * Thứ tự cột cố định của AGENTS §21. Settings chỉ chọn cột nào ĐƯỢC xuất
 * (`exportConfig.checkedFields`), không đổi được thứ tự — §21: "Do not change
 * export ordering implicitly".
 */
export const CANONICAL_EXPORT_FIELD_ORDER = [
  'email',
  'passwordCapcut',
  'emailData',
  'credit',
  'subscription',
  'createdAt'
] as const;

/** Nhãn cột đúng như §21 ghi. */
export const EXPORT_FIELD_HEADERS: Record<z.infer<typeof ExportFieldEnum>, string> = {
  email: 'Email',
  passwordCapcut: 'Password CapCut',
  emailData: 'Email Data',
  credit: 'Credit',
  subscription: 'Subscription',
  createdAt: 'Create At'
};
