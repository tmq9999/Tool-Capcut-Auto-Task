import type { z } from 'zod';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import { ProviderError } from '../providers/ProviderError';
import { AutomationTerminalError } from '../services/AutomationTerminalError';

export const VALIDATION_ERROR: IpcEnvelope<never> = {
  success: false,
  error: { code: 'ERR_VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ.' }
};

/**
 * Lỗi validation KÈM field nào sai.
 *
 * Bản cũ mọi handler trả hằng `VALIDATION_ERROR` và vứt `parsed.error` đi, trong
 * khi `NormalizedIpcErrorSchema` đã có sẵn ô `details`. Đó là lý do lỗi trang Logs
 * (`pageSize = 1000` vs contract `.max(500)`) sống nhiều ngày: main biết chính xác
 * field nào sai, người dùng chỉ nhận "Yêu cầu không hợp lệ." với màn hình trống.
 *
 * `details` chỉ nhận giá trị nguyên thuỷ (xem schema), nên gộp thành hai chuỗi.
 * Không có secret ở đây: `path` là tên field trong contract, `message` là câu của
 * zod về kiểu/giới hạn — không chứa giá trị người dùng nhập.
 */
export function validationError(error: z.ZodError): IpcEnvelope<never> {
  const issues = error.issues.slice(0, 5);
  const field = issues.map((i) => i.path.join('.') || '(gốc)').join(', ');
  const reason = issues.map((i) => i.message).join(' | ');

  return {
    success: false,
    error: {
      code: 'ERR_VALIDATION_FAILED',
      message: 'Yêu cầu không hợp lệ: ' + field,
      details: { field, reason }
    }
  };
}

export function ok<T>(data: T): IpcEnvelope<T> {
  return { success: true, data };
}

/**
 * Normalizes a thrown error for the renderer. An AutomationTerminalError or ProviderError keeps its
 * diagnostic code, message, and safe details; anything else collapses to a generic
 * persistence failure so internal details never cross the boundary.
 */
export function toErrorEnvelope(err: unknown): IpcEnvelope<never> {
  if (err instanceof AutomationTerminalError) {
    const details = {
      ...(err.reason.provider ? { provider: err.reason.provider } : {}),
      ...(err.reason.details ?? {})
    };
    return {
      success: false,
      error: {
        code: err.reason.code,
        message: err.message,
        ...(Object.keys(details).length > 0 ? { details } : {})
      }
    };
  }
  if (err instanceof ProviderError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  return {
    success: false,
    error: { code: 'ERR_PERSISTENCE_FAILED', message: 'Thao tác thất bại, vui lòng thử lại.' }
  };
}
