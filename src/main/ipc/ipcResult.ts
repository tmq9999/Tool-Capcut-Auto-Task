import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import { ProviderError } from '../providers/ProviderError';

export const VALIDATION_ERROR: IpcEnvelope<never> = {
  success: false,
  error: { code: 'ERR_VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ.' }
};

export function ok<T>(data: T): IpcEnvelope<T> {
  return { success: true, data };
}

/**
 * Normalizes a thrown error for the renderer. A ProviderError keeps its
 * diagnostic code and user-facing message; anything else collapses to a generic
 * persistence failure so internal details never cross the boundary.
 */
export function toErrorEnvelope(err: unknown): IpcEnvelope<never> {
  if (err instanceof ProviderError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  return {
    success: false,
    error: { code: 'ERR_PERSISTENCE_FAILED', message: 'Thao tác thất bại, vui lòng thử lại.' }
  };
}
