import { z } from 'zod';

/**
 * Trạng thái nhiệm vụ do CHÍNH CapCut trả về trong `GET /task/v1/task_list`,
 * không phải cờ nội bộ của tool: 1 chưa xong · 2 chờ nhận (Claim) · 4 đã xong.
 * Khai ở shared vì cả main (ghi) và renderer (hiện) đều phải hiểu cùng một bảng
 * — bộ đếm nội bộ của bản CLI cũ từng báo THỪA so với CapCut.
 */
export const CAPCUT_TASK_STATUS = {
  OPEN: 1,
  CLAIMABLE: 2,
  DONE: 4
} as const;

export const AccountTaskItemSchema = z.object({
  taskKey: z.string().min(1),
  title: z.string(),
  reward: z.number().int().min(0),
  status: z.number().int().min(0),
  /** `op_id` của `do_action` — bằng chứng đã bấm xong, `null` nếu chưa có. */
  opId: z.string().nullable(),
  provedAt: z.string().nullable(),
  updatedAt: z.string()
}).strict();
export type AccountTaskItemDTO = z.infer<typeof AccountTaskItemSchema>;

export const AccountTasksRequestSchema = z.object({
  accountId: z.string().min(1)
}).strict();
export type AccountTasksRequestDTO = z.infer<typeof AccountTasksRequestSchema>;

export const AccountTasksResponseSchema = z.object({
  items: z.array(AccountTaskItemSchema),
  /** Số nhiệm vụ CapCut ghi nhận đã xong. */
  doneCount: z.number().int().min(0),
  /** Tổng credit của những nhiệm vụ đã xong. */
  creditsEarned: z.number().int().min(0)
}).strict();
export type AccountTasksResponseDTO = z.infer<typeof AccountTasksResponseSchema>;

/** Nhãn tiếng Việt cho từng trạng thái, dùng chung để hai trang không lệch chữ. */
export function taskStatusLabel(status: number): string {
  if (status === CAPCUT_TASK_STATUS.DONE) return 'Đã xong';
  if (status === CAPCUT_TASK_STATUS.CLAIMABLE) return 'Chờ nhận';
  return 'Chưa xong';
}
