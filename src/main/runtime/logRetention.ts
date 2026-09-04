/**
 * =============================================================================
 * DỌN LOG QUÁ HẠN — AGENTS.md §18
 * =============================================================================
 * Audit 04/09/2026: `LogRepository.cleanupOldLogs()` tồn tại và ĐÃ CÓ test, nhưng
 * grep toàn repo cho thấy KHÔNG consumer nào ngoài test — không ai gọi nó. Settings
 * có sẵn khoá `logs.retention` mà cũng không ai đọc. Hệ quả: `runtime_logs` phình
 * vô hạn — DB thật đã có 1573 dòng chỉ sau MỘT ngày chạy.
 *
 * Đặt ở tầng `runtime/` vì đây là việc nối dây (repository + LogBus), không phải
 * quy tắc nghiệp vụ; đúng hướng phụ thuộc của §7 (IPC → services → repositories).
 * =============================================================================
 */

import type { LogBus } from '../services/LogBus';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings/default-settings';

/** Chỉ hai method thật sự cần — nhận hẹp để test bơm được bản hỏng. */
export interface LogRetentionDeps {
  repositories: {
    logRepo: { cleanupOldLogs(retentionDays: number): number };
    settingsRepo: { getAppSettings(): { logs: { retention: string } } | null };
  };
  logBus: LogBus;
}

const RETENTION_STEP = 'Bảo trì';

/**
 * Xoá log cũ hơn `logs.retention` ngày. KHÔNG BAO GIỜ ném ra ngoài.
 *
 * Hai nhánh thất bại được xử lý KHÁC NHAU có chủ ý:
 *
 * - Đọc settings hỏng ⇒ **không xoá gì**. §18 nói "never delete logs outside
 *   configured retention rules"; không đọc được luật thì lấy mặc định 30 ngày ra
 *   xoá là có thể xoá nhầm log của người đã đặt `never` — mất dữ liệu không lấy
 *   lại được.
 * - Xoá hỏng (DB khoá, WAL busy) ⇒ chỉ một dòng WARNING. Dọn log là việc dọn dẹp,
 *   không phải điều kiện để app mở được. Tiền lệ cùng ngày: bản đóng gói chết ở
 *   bước DB_CONNECT với đúng một dòng stderr, không ai biết vì sao.
 */
export function runLogRetentionCleanup(deps: LogRetentionDeps): void {
  const { logRepo, settingsRepo } = deps.repositories;
  const say = (status: 'INFO' | 'WARNING', message: string): void => {
    deps.logBus.emit({ email: 'system', step: RETENTION_STEP, status, message });
  };

  let retention: string;
  try {
    retention = settingsRepo.getAppSettings()?.logs.retention
      ?? DEFAULT_APP_SETTINGS.logs.retention;
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    say('WARNING', 'Không đọc được cấu hình lưu trữ nhật ký nên KHÔNG dọn dòng nào: ' + cause);
    return;
  }

  if (retention === 'never') {
    say('INFO', 'Cấu hình lưu trữ nhật ký là "never" — không dọn dòng nào.');
    return;
  }

  const days = Number(retention);
  if (!Number.isFinite(days) || days < 0) {
    say('WARNING', 'Cấu hình lưu trữ nhật ký không hợp lệ ("' + retention + '") nên KHÔNG dọn dòng nào.');
    return;
  }

  try {
    const removed = logRepo.cleanupOldLogs(days);
    say('INFO', 'Đã dọn ' + removed + ' dòng nhật ký cũ hơn ' + days + ' ngày.');
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    say('WARNING', 'Không dọn được nhật ký cũ: ' + cause);
  }
}
