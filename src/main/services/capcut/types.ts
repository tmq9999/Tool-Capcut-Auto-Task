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
import type { CapcutAccountResult } from '../AutomationRunService';
import type { VerifyRewardStep } from './stepEvidence';

export type {
  EvidenceAxis,
  EvidenceState,
  ExpectedRewardAttempt,
  OwnedStepResult,
  RewardAttempt,
  RewardStepResult,
  StepObserver,
  StepResult,
  StepVerdict,
  VerifyRewardStep,
} from './stepEvidence';

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

export interface AccountUiInteraction {
  focusMode?: 'native' | 'target';
  foreground<T>(label: string, operation: () => Promise<T>): Promise<T>;
  editor<T>(label: string, operation: () => Promise<T>): Promise<T>;
}

export interface CapcutMissionEnv {
  page: Page;
  context: BrowserContext;
  /** Đường dẫn ảnh PNG thật để upload */
  sampleImage: string;
  log: (msg: string) => void;
  signal: AbortSignal;
  /** Không có thì engine giữ đúng nhịp đã đo (xem `CapcutPace`). */
  pace?: CapcutPace;
  captureStage?: (stage: string) => void;
  ui: AccountUiInteraction;
  /** Present only when authoritative request provenance is enabled for this session. */
  verifyRewardStep?: VerifyRewardStep;
  rewardSessionAlias?: string;
}

export interface MissionGroup {
  id: 'pwa-install' | 'notifications' | 'design-studio' | 'video-studio';
  name: string;
  workspace: 'none' | 'editor';
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

export type CapcutFatalCode = 'DOM_READ_TIMEOUT';
export type CapcutAuthAttempt = 'initial' | 'existing-only';

export interface SnapshotTaskSummary {
  key: string;
  title: string;
  reward: number;
  status: number;
}

export interface TaskSnapshotSummary {
  observedAt: number;
  requiredAfter: number;
  tasks: SnapshotTaskSummary[];
  total: number;
  done: number;
  credits: number;
  creditsTotal: number;
  missing: string[];
  fresh: boolean;
  final: boolean;
  stale?: boolean;
}

export interface TaskCheckpoint {
  outcomes: TaskOutcome[];
  snapshot: TaskSnapshotSummary;
  unsettledProofs?: readonly UnsettledTaskProof[];
}

export interface TaskClaimResult {
  claimed: boolean;
  actionSettledAt: number | null;
}

export interface CapcutVerificationReceipt {
  runId: string;
  sessionAlias: string;
  observedAt: string;
  requiredAfter: string;
  fresh: boolean;
  final: boolean;
  serverTotal: number;
  serverDone: number;
  complete: boolean;
}

export interface UnsettledTaskProof {
  key: string;
  proof: ActionProof & { errNo: 0 };
}

export interface CapcutUiAccountResult extends CapcutAccountResult {
  authenticated: boolean;
  verification: CapcutVerificationReceipt | null;
  fatalCode?: CapcutFatalCode;
  unsettledProofs: UnsettledTaskProof[];
}

export type UiLane = 'foreground' | 'editor';

export type UiSchedulerEvent =
  | { type: 'queued'; lane: UiLane; sessionAlias: string; label: string; at: number }
  | { type: 'started'; lane: UiLane; sessionAlias: string; label: string; waitMs: number; at: number }
  | { type: 'finished'; lane: UiLane; sessionAlias: string; label: string; holdMs: number; outcome?: 'resolved' | 'rejected'; at: number }
  | { type: 'quarantined'; sessionAlias: string; label: string; code: 'DOM_READ_TIMEOUT' | 'ACTIVE_ABORT'; at: number }
  | { type: 'profile-stopped'; sessionAlias: string; at: number }
  | { type: 'late-settled'; sessionAlias: string; label: string; outcome: 'resolved' | 'rejected'; at: number }
  | { type: 'shutdown'; code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED'; at: number };

export interface UiSessionIdentity {
  sessionAlias: string;
  signal: AbortSignal;
  focusMode?: 'native' | 'target';
}
