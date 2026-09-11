/**
 * =============================================================================
 * HTTP TASKS — ĐIỀU PHỐI 12 NHIỆM VỤ CAPCUT QUA HTTP IN-SESSION
 * =============================================================================
 * Thay thế toàn bộ tầng UI Automation phức tạp (canvas, kéo thả, render video)
 * bằng contract API chuẩn của CapCut chạy trực tiếp trong phiên browser:
 *
 *   1. Lấy numeric user_id_str từ /passport/web/account/info/
 *   2. Bắn POST /luckycat/i18n/capcut/task/v1/do_action cho 9 nhiệm vụ lá
 *      với op_id = `${action_key}_${userId}_${today}` và credentials: 'include'
 *   3. Nhận thưởng tự động (grant_reward / auto-claim) đạt 670/670 credits
 *   4. Hoạt động 100% tin cậy trên cả chế độ HEADED và HEADLESS
 * =============================================================================
 */

import type { Page } from 'playwright-core';
import type {
  AccountUiInteraction,
  CapcutPace,
  TaskCheckpoint,
  TaskOutcome,
  UnsettledTaskProof
} from './types';
import type { ActionProof } from './taskApi';
import type { RunTasksResult, TaskSnapshotSummary, SnapshotTaskSummary } from './runTasks';
import { paceGapMs } from './runTasks';
import { abortableDelay, withinDeadline, boundedDomRead, isDomReadTimeout, OperationDeadlineError } from './cancellation';
import { foregroundPage } from './human';
import { TaskEvidenceError } from './TaskEvidenceError';
import { AutomationTerminalError } from '../AutomationTerminalError';

export const LEAF_TASKS = [
  'capcut_web_pwa_install',
  'capcut_web_push_authorize',
  'capcut_web_inspiration_generate_done',
  'capcut_web_design_studio_ai_chat',
  'capcut_web_design_studio_upload_img',
  'capcut_web_design_studio_canvas_edit',
  'capcut_web_video_studio_send_msg',
  'capcut_web_video_studio_generate_done',
  'capcut_web_video_studio_export'
] as const;

export interface ExecuteHttpTasksInput {
  page: Page;
  log: (msg: string) => void;
  signal: AbortSignal;
  pace?: CapcutPace;
  actionDelayMs?: number;
  runId?: string;
  sessionAlias?: string;
  sessionStartedAt?: number;
  unsettledProofs?: readonly UnsettledTaskProof[];
  onCheckpoint?: (checkpoint: TaskCheckpoint) => Promise<void>;
  onAcceptedProof?: (proof: UnsettledTaskProof) => Promise<void>;
  ui?: AccountUiInteraction;
}

export type TaskListFailureReason =
  | 'HTTP_STATUS'
  | 'FETCH_FAILED'
  | 'INVALID_JSON'
  | 'ERR_NO_INVALID'
  | 'ERR_NO_NONZERO'
  | 'TASK_LIST_MISSING'
  | 'TASK_ROW_INVALID'
  | 'TASK_DUPLICATE_KEY'
  | 'TASK_DUPLICATE_ID'
  | 'TASK_TOTAL_INVALID'
  | 'EVALUATION_FAILED'
  | 'HOST_TIMEOUT';

export interface TaskListFailureDetail {
  phase: 'initial' | 'after-hydration' | 'after-claim';
  reason: TaskListFailureReason;
  httpStatus: number | null;
  errNo?: number;
  dataPresent?: boolean;
  taskListShape?: 'missing' | 'null' | 'not-array' | 'array';
  recoveryStage?: 'popup-before-tasks' | 'popup-after-hydration' | 'task-drawer';
  rowIndex?: number;
  field?:
    | 'row'
    | 'task_key'
    | 'task_id'
    | 'task_status'
    | 'task_reward_view'
    | 'reward_amount'
    | 'task_view'
    | 'title'
    | 'button_text';
}

export class TaskListResponseError extends Error {
  readonly diagnostic: TaskListFailureDetail;

  constructor(diagnostic: TaskListFailureDetail) {
    super('TASK_LIST_RESPONSE_INVALID');
    this.name = 'TaskListResponseError';
    this.diagnostic = diagnostic;
  }
}

export interface RawTaskItem {
  task_key: string;
  task_id: number;
  task_status: number;
  task_reward_view?: { reward_amount?: number };
  task_view?: { title?: string; button_text?: string };
}

export function validateTaskRowsDetailed(rawRows: unknown):
  | { valid: true; rows: RawTaskItem[] }
  | { valid: false; detail: Pick<TaskListFailureDetail, 'reason' | 'rowIndex' | 'field'> } {
  if (!Array.isArray(rawRows)) return { valid: false, detail: { reason: 'TASK_LIST_MISSING' } };
  const rows: RawTaskItem[] = [];
  const seenKeys = new Set<string>();
  const seenIds = new Set<number>();
  let totalCredits = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const item = rawRows[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'row' } };
    }
    const r = item as Record<string, unknown>;
    if (typeof r.task_key !== 'string' || r.task_key.trim() === '') {
      return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'task_key' } };
    }
    if (typeof r.task_id !== 'number' || !Number.isSafeInteger(r.task_id) || r.task_id <= 0) {
      return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'task_id' } };
    }
    if (typeof r.task_status !== 'number' || !Number.isInteger(r.task_status)) {
      return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'task_status' } };
    }

    if (r.task_view !== undefined && r.task_view !== null) {
      if (typeof r.task_view !== 'object' || Array.isArray(r.task_view)) {
        return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'task_view' } };
      }
      const tv = r.task_view as Record<string, unknown>;
      if (tv.title !== undefined && tv.title !== null && typeof tv.title !== 'string') {
        return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'title' } };
      }
      if (tv.button_text !== undefined && tv.button_text !== null && typeof tv.button_text !== 'string') {
        return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'button_text' } };
      }
    }

    if (r.task_reward_view !== undefined && r.task_reward_view !== null) {
      if (typeof r.task_reward_view !== 'object' || Array.isArray(r.task_reward_view)) {
        return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'task_reward_view' } };
      }
      const rw = r.task_reward_view as Record<string, unknown>;
      if (rw.reward_amount !== undefined && rw.reward_amount !== null) {
        if (typeof rw.reward_amount !== 'number' || !Number.isFinite(rw.reward_amount) || rw.reward_amount < 0) {
          return { valid: false, detail: { reason: 'TASK_ROW_INVALID', rowIndex: i, field: 'reward_amount' } };
        }
        totalCredits += rw.reward_amount;
      }
    }
    if (seenKeys.has(r.task_key)) {
      return { valid: false, detail: { reason: 'TASK_DUPLICATE_KEY', rowIndex: i, field: 'task_key' } };
    }
    if (seenIds.has(r.task_id)) {
      return { valid: false, detail: { reason: 'TASK_DUPLICATE_ID', rowIndex: i, field: 'task_id' } };
    }
    seenKeys.add(r.task_key);
    seenIds.add(r.task_id);
    rows.push(r as unknown as RawTaskItem);
  }
  if (!Number.isFinite(totalCredits)) {
    return { valid: false, detail: { reason: 'TASK_TOTAL_INVALID' } };
  }
  return { valid: true, rows };
}

export function validateTaskRows(rawRows: unknown[]): { valid: boolean; rows: RawTaskItem[] } {
  const res = validateTaskRowsDetailed(rawRows);
  if (res.valid) return { valid: true, rows: res.rows };
  return { valid: false, rows: [] };
}

/**
 * Trích xuất User ID số nguyên chuẩn của tài khoản CapCut từ backend (có retry 3 lần).
 */
export async function resolveNumericUserId(page: Page, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal?.throwIfAborted();
    const res = await withinDeadline(
      page.evaluate(async () => {
        try {
          const r1 = await fetch('/passport/web/account/info/');
          const d1 = await r1.json();
          if (d1.data?.user_id_str) return d1.data.user_id_str;
          if (d1.data?.user_id) return String(d1.data.user_id);
        } catch {
          /* ignore error and try next endpoint */
        }
        try {
          const r2 = await fetch('/lv/v1/user/web/user_info');
          const d2 = await r2.json();
          if (d2.data?.user_info?.user_id) return String(d2.data.user_info.user_id);
          if (d2.data?.user_id) return String(d2.data.user_id);
        } catch {
          /* ignore error and return null */
        }
        return null;
      }),
      30000,
      signal
    );
    signal?.throwIfAborted();

    if (res && /^\d+$/.test(res)) {
      return res;
    }
    if (attempt < 3) {
      if (signal) {
        await abortableDelay(1000, signal);
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw new Error('KHONG_LAY_DUOC_USER_ID_SO');
}

/**
 * Thực thi 12 nhiệm vụ hoàn toàn qua HTTP in-session trong Browser context (Hỗ trợ cả Headed và Headless).
 */
export async function executeHttpTasks(input: ExecuteHttpTasksInput): Promise<RunTasksResult> {
  const { page, log, signal } = input;
  signal.throwIfAborted();

  const invocationStartedAt = Date.now();

  log('\n============================================================');
  log('🚀 THỰC THI 12 NHIỆM VỤ BẰNG HTTP IN-SESSION (TỐC ĐỘ CAO)');
  log('============================================================');

  // Đóng các modal/popup che khuất trước khi thao tác
  log('   ℹ️ Kiểm tra popup trước nhiệm vụ [popup-before-tasks]...');
  if (typeof page.locator === 'function') {
    for (const closeSel of [
      'button[aria-label="Close"]',
      '[class*="modal"] [class*="close"]',
      'button:has-text("Skip")',
      'button:has-text("Got it")'
    ]) {
      signal.throwIfAborted();
      const btn = page.locator(closeSel).first();
      const visible = await boundedDomRead(
        () => btn.isVisible(),
        'http-task-popup:visible',
        1000,
        signal
      ).catch((error) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(error)) throw error;
        return false;
      });
      if (visible) {
        signal.throwIfAborted();
        if (input.ui) {
          await foregroundPage(page, { signal, stage: 'http-task-popup', ui: input.ui }, () =>
            btn.click({ timeout: 2000, signal })
          ).catch(() => {});
        }
      }
    }
  }

  // Bước 1: Lấy User ID số
  signal.throwIfAborted();
  const userId = await resolveNumericUserId(page, signal);
  signal.throwIfAborted();
  log(`   🆔 User ID CapCut: ${userId}`);

  const today = new Date().toISOString().slice(0, 10);
  const proofMemory = new Map<string, ActionProof & { errNo: 0 }>();
  if (input.unsettledProofs) {
    for (const item of input.unsettledProofs) {
      if (item.proof && item.proof.errNo === 0) {
        proofMemory.set(item.key, item.proof);
      }
    }
  }
  const currentAcceptedProofs = new Map<string, ActionProof & { errNo: 0 }>();
  const attemptedKeys = new Set<string>();
  let latestSettledAt = invocationStartedAt;

  async function preserveTaskEvidence<T>(
    operation: () => Promise<T>,
    context?: { recoveryStage?: 'popup-before-tasks' | 'popup-after-hydration' | 'task-drawer'; diagnostic?: TaskListFailureDetail }
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof AutomationTerminalError) throw error;
      if (error instanceof TaskEvidenceError) throw error;
      if (proofMemory.size > 0) {
        const diag: TaskListFailureDetail | undefined = context?.diagnostic
          ? {
              ...context.diagnostic,
              ...(context.recoveryStage ? { recoveryStage: context.recoveryStage } : {})
            }
          : undefined;
        throw new TaskEvidenceError(
          error instanceof Error ? error.message : String(error),
          [...proofMemory].map(([key, proof]) => ({ key, proof })),
          { cause: error, ...(diag ? { diagnostic: diag } : {}) }
        );
      }
      throw error;
    }
  }

  // Bước 2: Bắn do_action cho 9 nhiệm vụ lá
  for (const actionKey of LEAF_TASKS) {
    signal.throwIfAborted();
    attemptedKeys.add(actionKey);
    const opId = `${actionKey}_${userId}_${today}`;
    log(`   ⚡ Gửi do_action: ${actionKey}...`);

    signal.throwIfAborted();
    const result = await preserveTaskEvidence(() =>
      withinDeadline(
        page.evaluate(
          async ({ actionKey, opId }) => {
            try {
              const r = await fetch(
                'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?aid=348188&device_platform=web',
                {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action_key: actionKey, op_id: opId })
                }
              );
              const d: unknown = await r.json();
              const body = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
              const numeric = typeof body.err_no === 'number' && Number.isInteger(body.err_no);
              return {
                errNo: r.ok && numeric ? (body.err_no as number) : -1,
                errMsg:
                  typeof body.err_tips === 'string'
                    ? body.err_tips
                    : r.ok && numeric
                      ? ''
                      : 'RESPONSE_INVALID',
                httpStatus: r.status
              };
            } catch (e: unknown) {
              return { errNo: -1, errMsg: (e as Error)?.message || String(e), httpStatus: 0 };
            }
          },
          { actionKey, opId }
        ),
        30000,
        signal
      )
    );

    latestSettledAt = Date.now();

    if (result.errNo === 0) {
      const accepted: ActionProof & { errNo: 0 } = {
        actionKey,
        opId,
        errNo: 0,
        errTips: result.errMsg || '',
        at: latestSettledAt
      };
      proofMemory.set(actionKey, accepted);
      currentAcceptedProofs.set(actionKey, accepted);
      if (input.onAcceptedProof) {
        await input.onAcceptedProof({ key: actionKey, proof: accepted });
      }
      log(`      ✅ ${actionKey}: hoàn thành (err_no=0)`);
    } else {
      log(`      ℹ️  ${actionKey}: trạng thái ${result.errNo} (${result.errMsg || 'đã xong/bỏ qua'})`);
    }

    signal.throwIfAborted();

    // Nhịp jitter tránh spam quá nhanh
    const jitter = input.actionDelayMs !== undefined ? input.actionDelayMs : Math.max(500, paceGapMs(input.pace) || 800);
    if (jitter > 0) {
      await abortableDelay(jitter, signal);
    }
  }

  // Bước 3: Lấy danh sách nhiệm vụ đối soát
  signal.throwIfAborted();
  interface FetchTaskResult {
    valid: boolean;
    tasks: RawTaskItem[];
    errNo?: number;
    errMsg?: string;
    httpStatus?: number;
    error?: string;
    observedAt: number;
    failureDetail?: TaskListFailureDetail;
  }

  const fetchTaskList = async (phase: 'initial' | 'after-hydration' | 'after-claim'): Promise<FetchTaskResult> => {
    signal.throwIfAborted();
    let evaluated: unknown;
    try {
      evaluated = await withinDeadline(
        page.evaluate(async () => {
          try {
            let r: Response;
            try {
              r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ scene: 'capcut_web_task' })
              });
            } catch (fetchErr: unknown) {
              return {
                transportOk: false,
                reason: 'FETCH_FAILED' as const,
                httpStatus: null,
                error: (fetchErr as Error)?.message || String(fetchErr),
                tasks: [],
                observedAt: Date.now()
              };
            }

            if (!r.ok) {
              return {
                transportOk: false,
                reason: 'HTTP_STATUS' as const,
                httpStatus: r.status,
                tasks: [],
                observedAt: Date.now()
              };
            }

            let d: unknown;
            try {
              d = await r.json();
            } catch (jsonErr: unknown) {
              return {
                transportOk: false,
                reason: 'INVALID_JSON' as const,
                httpStatus: r.status,
                error: (jsonErr as Error)?.message || String(jsonErr),
                tasks: [],
                observedAt: Date.now()
              };
            }

            const body = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
            const numeric = typeof body.err_no === 'number' && Number.isInteger(body.err_no);
            if (!numeric) {
              return {
                transportOk: false,
                reason: 'ERR_NO_INVALID' as const,
                httpStatus: r.status,
                tasks: [],
                observedAt: Date.now()
              };
            }
            if (body.err_no !== 0) {
              return {
                transportOk: false,
                reason: 'ERR_NO_NONZERO' as const,
                httpStatus: r.status,
                errNo: body.err_no as number,
                errMsg:
                  typeof body.err_tips === 'string'
                    ? body.err_tips
                    : typeof body.message === 'string'
                      ? body.message
                      : '',
                tasks: [],
                observedAt: Date.now()
              };
            }

            const dataObj = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : null;
            const dataPresent = dataObj !== null;
            let taskListShape: 'missing' | 'null' | 'not-array' | 'array' = 'missing';
            if (dataObj) {
              if (dataObj.task_list === undefined) taskListShape = 'missing';
              else if (dataObj.task_list === null) taskListShape = 'null';
              else if (Array.isArray(dataObj.task_list)) taskListShape = 'array';
              else taskListShape = 'not-array';
            }
            if (!Array.isArray(dataObj?.task_list)) {
              return {
                transportOk: false,
                reason: 'TASK_LIST_MISSING' as const,
                httpStatus: r.status,
                errNo: 0,
                dataPresent,
                taskListShape,
                tasks: [],
                observedAt: Date.now()
              };
            }

            return {
              transportOk: true,
              httpStatus: r.status,
              errNo: 0,
              dataPresent: true,
              taskListShape: 'array' as const,
              tasks: dataObj.task_list,
              errMsg:
                typeof body.err_tips === 'string'
                  ? body.err_tips
                  : typeof body.message === 'string'
                    ? body.message
                    : '',
              observedAt: Date.now()
            };
          } catch (e: unknown) {
            return {
              transportOk: false,
              reason: 'FETCH_FAILED' as const,
              tasks: [],
              errNo: -1,
              error: (e as Error)?.message || String(e),
              httpStatus: null,
              observedAt: Date.now()
            };
          }
        }),
        30000,
        signal
      );
    } catch (error: unknown) {
      signal.throwIfAborted();
      const isTimeout = error instanceof OperationDeadlineError || (error instanceof Error && error.message.includes('deadline'));
      const reason: TaskListFailureReason = isTimeout ? 'HOST_TIMEOUT' : 'EVALUATION_FAILED';
      const failureDetail: TaskListFailureDetail = {
        phase,
        reason,
        httpStatus: null
      };
      throw new TaskEvidenceError(
        error instanceof Error ? error.message : String(error),
        [...proofMemory].map(([key, proof]) => ({ key, proof })),
        { cause: error, diagnostic: failureDetail }
      );
    }
    signal.throwIfAborted();

    if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
      const failureDetail: TaskListFailureDetail = {
        phase,
        reason: 'EVALUATION_FAILED',
        httpStatus: null
      };
      return {
        valid: false,
        tasks: [],
        observedAt: Date.now(),
        error: 'INVALID_EVALUATED_RESULT',
        failureDetail
      };
    }

    const res = evaluated as {
      transportOk: boolean;
      reason?: TaskListFailureReason;
      httpStatus?: number;
      errNo?: number;
      errMsg?: string;
      error?: string;
      dataPresent?: boolean;
      taskListShape?: 'missing' | 'null' | 'not-array' | 'array';
      tasks: unknown[];
      observedAt: number;
    };

    if (!res.transportOk) {
      const failureDetail: TaskListFailureDetail = {
        phase,
        reason: res.reason ?? 'FETCH_FAILED',
        httpStatus: res.httpStatus ?? null,
        errNo: res.errNo,
        dataPresent: res.dataPresent,
        taskListShape: res.taskListShape
      };
      log(
        `   ⚠️ task_list bị loại [${phase}]: reason=${failureDetail.reason}, status=${failureDetail.httpStatus ?? 'none'}${failureDetail.errNo !== undefined ? `, err_no=${failureDetail.errNo}` : ''}`
      );
      return {
        valid: false,
        tasks: [],
        errNo: res.errNo,
        errMsg: res.errMsg,
        error: res.error,
        httpStatus: res.httpStatus ?? undefined,
        observedAt: res.observedAt,
        failureDetail
      };
    }

    const validated = validateTaskRowsDetailed(res.tasks);
    if (!validated.valid) {
      const failureDetail: TaskListFailureDetail = {
        phase,
        reason: validated.detail.reason,
        httpStatus: res.httpStatus ?? 200,
        errNo: res.errNo ?? 0,
        dataPresent: res.dataPresent ?? true,
        taskListShape: res.taskListShape ?? (Array.isArray(res.tasks) ? 'array' : 'not-array'),
        rowIndex: validated.detail.rowIndex,
        field: validated.detail.field
      };
      log(
        `   ⚠️ task_list bị loại [${phase}]: reason=${failureDetail.reason}, status=${failureDetail.httpStatus ?? 'none'}${failureDetail.rowIndex !== undefined ? `, row=${failureDetail.rowIndex}` : ''}${failureDetail.field ? `, field=${failureDetail.field}` : ''}`
      );
      return {
        valid: false,
        tasks: [],
        errNo: res.errNo,
        errMsg: res.errMsg,
        error: res.error,
        httpStatus: res.httpStatus ?? 200,
        observedAt: res.observedAt,
        failureDetail
      };
    }

    return {
      valid: true,
      tasks: validated.rows,
      errNo: res.errNo,
      errMsg: res.errMsg,
      httpStatus: res.httpStatus,
      observedAt: res.observedAt
    };
  };

  let listRes = await fetchTaskList('initial');
  let rawTasks = listRes.tasks;
  const initialFailureDetail = listRes.failureDetail;

  // Nếu chưa có task hoặc list chưa hợp lệ và có thể goto để hydrate
  if ((!listRes.valid || rawTasks.length === 0) && typeof page.goto === 'function') {
    const failureReason = listRes.failureDetail?.reason ?? 'UNKNOWN';
    log(
      `   ℹ️ task_list chưa trả dữ liệu hợp lệ (valid=${listRes.valid}, err_no=${listRes.errNo ?? 'N/A'}, reason=${failureReason}). Đang kích hoạt khu vực nhiệm vụ...`
    );

    signal.throwIfAborted();
    await withinDeadline(
      page.goto('https://www.capcut.com/my-edit?section=inspiration_feeds&enter_source=web_task_earn_credit', {
        waitUntil: 'domcontentloaded',
        timeout: 25000
      }),
      30000,
      signal
    ).catch(() => {});
    await abortableDelay(input.actionDelayMs !== undefined ? input.actionDelayMs : 2000, signal);

    // Đóng popup nếu có
    log('   ℹ️ Kiểm tra popup sau kích hoạt [popup-after-hydration]...');
    if (typeof page.locator === 'function') {
      for (const closeSel of ['button[aria-label="Close"]', 'button:has-text("Skip")', 'button:has-text("Got it")']) {
        signal.throwIfAborted();
        const btn = page.locator(closeSel).first();
        const visible = await preserveTaskEvidence(
          () =>
            boundedDomRead(
              () => btn.isVisible(),
              'http-task-popup:visible',
              1000,
              signal
            ).catch((error) => {
              signal.throwIfAborted();
              if (isDomReadTimeout(error)) throw error;
              return false;
            }),
          { recoveryStage: 'popup-after-hydration', diagnostic: initialFailureDetail }
        );
        if (visible) {
          signal.throwIfAborted();
          if (input.ui) {
            await foregroundPage(page, { signal, stage: 'http-task-popup', ui: input.ui }, () =>
              btn.click({ timeout: 2000, signal })
            ).catch(() => {});
          }
        }
      }

      // Click icon task drawer nếu có
      signal.throwIfAborted();
      const taskEntry = page.locator('[data-id="TitleBarTaskList"], [class*="Lv_Task-wrapper"], button.entry-').first();
      const entryVisible = await preserveTaskEvidence(
        () =>
          boundedDomRead(
            () => taskEntry.isVisible(),
            'http-task-drawer:visible',
            1000,
            signal
          ).catch((error) => {
            signal.throwIfAborted();
            if (isDomReadTimeout(error)) throw error;
            return false;
          }),
        { recoveryStage: 'task-drawer', diagnostic: initialFailureDetail }
      );
      if (entryVisible) {
        signal.throwIfAborted();
        if (input.ui) {
          await foregroundPage(page, { signal, stage: 'http-task-drawer', ui: input.ui }, () =>
            taskEntry.click({ timeout: 2000, signal })
          ).catch(() => {});
        }
        await abortableDelay(input.actionDelayMs !== undefined ? input.actionDelayMs : 1500, signal);
      }
    }

    // Thử lại fetch
    listRes = await fetchTaskList('after-hydration');
    rawTasks = listRes.tasks;
  }

  if (!listRes.valid) {
    const unsettledProofs: UnsettledTaskProof[] = [...proofMemory].map(([key, proof]) => ({ key, proof }));
    return {
      outcomes: [],
      snapshot: null,
      fatalError: listRes.failureDetail
        ? new TaskListResponseError(listRes.failureDetail)
        : new Error('TASK_LIST_RESPONSE_INVALID'),
      unsettledProofs
    };
  }

  log(`   📋 Đối soát danh sách nhiệm vụ: tìm thấy ${rawTasks.length} mục`);

  // Bước 4: Nhận thưởng cho các nhiệm vụ đang ở Status 2 (Claimable) nếu có
  let claimPass = 0;
  while (claimPass < 3) {
    signal.throwIfAborted();
    const claimable = rawTasks.filter((t) => t.task_status === 2);
    if (claimable.length === 0) break;
    claimPass++;
    log(`   🎁 Phát hiện ${claimable.length} nhiệm vụ đang chờ nhận thưởng (vòng ${claimPass}) — kích hoạt claim...`);
    for (const t of claimable) {
      signal.throwIfAborted();
      const grantRes = await preserveTaskEvidence(() =>
        withinDeadline(
          page.evaluate(async (taskKey) => {
            try {
              const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/grant_reward', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ task_key: taskKey, scene: 'capcut_web_task' })
              });
              const d: unknown = await r.json();
              const body = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
              const numeric = typeof body.err_no === 'number' && Number.isInteger(body.err_no);
              return {
                errNo: r.ok && numeric ? (body.err_no as number) : -1,
                errMsg:
                  typeof body.err_tips === 'string'
                    ? body.err_tips
                    : r.ok && numeric
                      ? ''
                      : 'RESPONSE_INVALID',
                httpStatus: r.status
              };
            } catch (e: unknown) {
              return { errNo: -1, errMsg: (e as Error)?.message || String(e), httpStatus: 0 };
            }
          }, t.task_key),
          30000,
          signal
        )
      );
      signal.throwIfAborted();

      latestSettledAt = Date.now();

      if (grantRes.errNo === 0) {
        log(`      ✅ Đã nhận thưởng: ${t.task_key}`);
      } else {
        log(`      ⚠️ Lỗi nhận thưởng ${t.task_key}: err_no=${grantRes.errNo} (${grantRes.errMsg})`);
      }
      const claimDelay = input.actionDelayMs !== undefined ? input.actionDelayMs : 400;
      if (claimDelay > 0) {
        await abortableDelay(claimDelay, signal);
      }
    }

    // Fallback click các nút Claim trực quan nếu còn xuất hiện trên DOM
    if (typeof page.locator === 'function') {
      signal.throwIfAborted();
      const claimButtons = page.locator('button').filter({ hasText: /^Claim$/i });
      const claimCount = await preserveTaskEvidence(() =>
        boundedDomRead(
          () => claimButtons.count(),
          'http-task-claim:count',
          1000,
          signal
        ).catch((error) => {
          signal.throwIfAborted();
          if (isDomReadTimeout(error)) throw error;
          return 0;
        })
      );
      if (claimCount > 0) {
        for (let i = 0; i < claimCount; i++) {
          signal.throwIfAborted();
          const btn = claimButtons.nth(i);
          const btnVisible = await preserveTaskEvidence(() =>
            boundedDomRead(
              () => btn.isVisible(),
              'http-task-claim:visible',
              1000,
              signal
            ).catch((error) => {
              signal.throwIfAborted();
              if (isDomReadTimeout(error)) throw error;
              return false;
            })
          );
          if (btnVisible) {
            signal.throwIfAborted();
            if (input.ui) {
              await foregroundPage(page, { signal, stage: 'http-task-claim', ui: input.ui }, () =>
                btn.click({ timeout: 2000, signal })
              ).catch(() => {});
            }
            await abortableDelay(600, signal);
          }
        }
      }
    }

    // Refresh lại task_list sau khi claim
    listRes = await fetchTaskList('after-claim');
    if (!listRes.valid) {
      break;
    }
    rawTasks = listRes.tasks;
  }

  if (!listRes.valid) {
    const unsettledProofs: UnsettledTaskProof[] = [...proofMemory].map(([key, proof]) => ({ key, proof }));
    return {
      outcomes: [],
      snapshot: null,
      fatalError: listRes.failureDetail
        ? new TaskListResponseError(listRes.failureDetail)
        : new Error('TASK_LIST_RESPONSE_INVALID'),
      unsettledProofs
    };
  }

  // Bước 5: Tổng hợp Snapshot & Outcomes
  const tasks: SnapshotTaskSummary[] = rawTasks.map((t) => ({
    key: t.task_key,
    title: t.task_view?.title || t.task_key,
    reward: t.task_reward_view?.reward_amount || 0,
    status: t.task_status
  }));

  const doneCount = tasks.filter((t) => t.status === 4).length;
  const missingKeys = tasks.filter((t) => t.status !== 4).map((t) => t.key);
  const earnedCredits = tasks.filter((t) => t.status === 4).reduce((sum, t) => sum + t.reward, 0);
  const totalCredits = tasks.reduce((sum, t) => sum + t.reward, 0);

  const observedAt = listRes.observedAt;
  const sessionStartedAt = input.sessionStartedAt ?? invocationStartedAt;
  const requiredAfter = Math.max(sessionStartedAt, latestSettledAt);
  const fresh = listRes.valid && observedAt > requiredAfter;
  const final = fresh && tasks.length > 0 && missingKeys.length === 0;

  const snapshot: TaskSnapshotSummary = {
    observedAt,
    requiredAfter,
    tasks,
    total: tasks.length,
    done: doneCount,
    credits: earnedCredits,
    creditsTotal: totalCredits,
    missing: missingKeys,
    fresh,
    final
  };

  const statusByKey = new Map(tasks.map((task) => [task.key, task.status]));
  const unsettledProofs: UnsettledTaskProof[] = [...proofMemory].flatMap(([key, proof]) =>
    fresh && statusByKey.get(key) === 4 && observedAt > proof.at ? [] : [{ key, proof }]
  );

  const outcomes: TaskOutcome[] = tasks.map((t) => {
    const proof = currentAcceptedProofs.get(t.key);
    return {
      key: t.key,
      title: t.title,
      reward: t.reward,
      done: t.status === 4,
      attempts: attemptedKeys.has(t.key) ? 1 : 0,
      proof
    };
  });

  log(
    `   🏁 Tổng kết nhiệm vụ: Hoàn thành ${doneCount}/${tasks.length} | Đạt ${earnedCredits}/${totalCredits} credits\n`
  );

  signal.throwIfAborted();

  if (input.onCheckpoint) {
    await input.onCheckpoint({
      outcomes,
      snapshot,
      unsettledProofs
    });
  }

  signal.throwIfAborted();

  return {
    outcomes,
    snapshot,
    unsettledProofs
  };
}
