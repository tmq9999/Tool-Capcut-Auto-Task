/**
 * =============================================================================
 * TYPES — HỢP ĐỒNG GIỮA ENGINE VÀ APP
 * =============================================================================
 * Engine KHÔNG tự mở/tắt profile, không tự xin proxy, không tự đọc SQLite. Nó
 * nhận `{ page, context, sampleImage, log }` từ ngoài và trả về kết quả từng
 * nhiệm vụ. Vì vậy các kiểu ở đây là ranh giới duy nhất mà
 * `AutomationRunService` phải biết tới.
 *
 * `log` được INJECT chứ không phải `console.log`: mọi dòng phải đi qua `LogBus`
 * để có `accountId` (AGENTS.md §16).
 * =============================================================================
 */

import type { BrowserContext, Page } from 'playwright-core';

import type { ActionProof } from './taskApi';

/**
 * Nhịp thao tác do người dùng đặt ở Dashboard (`stepDelay*` / `typeDelay*`).
 *
 * CHỈ ĐƯỢC LÀM CHẬM HƠN. Mọi khoảng `rand(...)` của engine là số ĐÃ ĐO trên
 * lượt 13 account thành công, và CapCut chạy Shark Risk Control — nó chấm điểm
 * quỹ đạo chuột lẫn độ trễ giữa các phím, gõ nhanh hơn khoảng đã đo thì
 * `grant_reward` trả về `err_no 8001003` (docs/AUTOMATION-ENGINE.md §5). Vì vậy
 * chỗ nào áp dụng cũng phải có SÀN bằng giá trị engine đang dùng:
 *   - `typeMinMs`/`typeMaxMs` → nhịp gõ mỗi ký tự, sàn `45–130ms`
 *   - `stepMinMs`/`stepMaxMs` → khoảng nghỉ THÊM giữa các bước lớn (sau mỗi
 *     `MissionGroup`, giữa hai lượt quét); KHÔNG chạm vào các
 *     `waitForTimeout(rand(...))` bên trong từng mission vì chúng là thời gian
 *     chờ UI đã đo, không phải nhịp người dùng.
 */
export interface CapcutPace {
  stepMinMs: number;
  stepMaxMs: number;
  typeMinMs: number;
  typeMaxMs: number;
}

export interface CapcutMissionEnv {
  page: Page;
  context: BrowserContext;
  /** Đường dẫn ảnh PNG thật để upload */
  sampleImage: string;
  log: (msg: string) => void;
  /** Không có thì engine giữ đúng nhịp đã đo (xem `CapcutPace`). */
  pace?: CapcutPace;
}

export interface MissionGroup {
  name: string;
  /** Các `task_key` mà nhóm này hoàn thành. */
  keys: string[];
  proofTimeoutMs: number;
  /** Chỉ thao tác UI. Chỉ làm những key có trong `need`. */
  act(env: CapcutMissionEnv, need: Set<string>): Promise<void>;
}

export interface TaskOutcome {
  key: string;
  title: string;
  reward: number;
  done: boolean;
  attempts: number;
  proof?: ActionProof;
  error?: string;
  dumpName?: string | null;
}
