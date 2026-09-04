/**
 * =============================================================================
 * LỖI VALIDATION PHẢI NÓI RÕ FIELD NÀO SAI
 * =============================================================================
 * Audit 04/09/2026: mọi handler IPC viết `if (!parsed.success) return
 * VALIDATION_ERROR` rồi VỨT `parsed.error` đi, trong khi `NormalizedIpcErrorSchema`
 * đã có sẵn ô `details` không ai dùng.
 *
 * Hệ quả đo được: trang Logs gửi `pageSize = 1000` (contract chặn ở 500) và người
 * dùng chỉ thấy "Không tải được nhật ký runtime." với 0 dòng, dù DB có 1573 dòng.
 * Main BIẾT chính xác field nào sai rồi ném đi — nên lỗi đó sống nhiều ngày.
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validationError, VALIDATION_ERROR } from '../ipcResult';
import { NormalizedIpcErrorSchema } from '../../../shared/schemas/ipc-envelope.schema';

const Filter = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(500)
}).strict();

describe('validationError', () => {
  it('nói rõ field nào sai và sai vì sao', () => {
    const parsed = Filter.safeParse({ page: 1, pageSize: 1000 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const envelope = validationError(parsed.error);

    expect(envelope.success).toBe(false);
    if (envelope.success) return;
    expect(envelope.error.details?.field).toBe('pageSize');
    expect(String(envelope.error.details?.reason)).toMatch(/500/);
  });

  it('gộp nhiều field sai thành một danh sách đọc được', () => {
    const parsed = Filter.safeParse({ page: 0, pageSize: 0 });
    if (parsed.success) return;

    const envelope = validationError(parsed.error);
    if (envelope.success) return;

    expect(String(envelope.error.details?.field)).toContain('page');
    expect(String(envelope.error.details?.field)).toContain('pageSize');
  });

  it('key lạ (schema .strict()) cũng phải nêu tên key', () => {
    const parsed = Filter.safeParse({ page: 1, pageSize: 50, search: 'x' });
    if (parsed.success) return;

    const envelope = validationError(parsed.error);
    if (envelope.success) return;

    expect(String(envelope.error.details?.reason)).toMatch(/search/);
  });

  it('vẫn hợp lệ với NormalizedIpcErrorSchema (details chỉ nhận giá trị nguyên thuỷ)', () => {
    const parsed = Filter.safeParse({ page: 1, pageSize: 1000 });
    if (parsed.success) return;

    const envelope = validationError(parsed.error);
    if (envelope.success) return;

    expect(NormalizedIpcErrorSchema.safeParse(envelope.error).success).toBe(true);
  });

  it('giữ nguyên code cũ để renderer không phải đổi cách bắt lỗi', () => {
    const parsed = Filter.safeParse({ page: 1, pageSize: 1000 });
    if (parsed.success) return;

    const envelope = validationError(parsed.error);
    if (envelope.success) return;

    expect(envelope.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(VALIDATION_ERROR.success).toBe(false);
  });
});
