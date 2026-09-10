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
import { abortableDelay, withinDeadline, boundedDomRead, isDomReadTimeout } from './cancellation';
import { foregroundPage } from './human';

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
  ui?: AccountUiInteraction;
}

interface RawTaskItem {
  task_key: string;
  task_id: number;
  task_status: number;
  task_reward_view?: { reward_amount?: number };
  task_view?: { title?: string; button_text?: string };
}

function validateTaskRows(rawRows: unknown[]): { valid: boolean; rows: RawTaskItem[] } {
  if (!Array.isArray(rawRows)) return { valid: false, rows: [] };
  const rows: RawTaskItem[] = [];
  const seenKeys = new Set<string>();
  const seenIds = new Set<number>();
  for (const item of rawRows) {
    if (!item || typeof item !== 'object') return { valid: false, rows: [] };
    const r = item as Record<string, unknown>;
    if (typeof r.task_key !== 'string' || r.task_key.trim() === '') return { valid: false, rows: [] };
    if (typeof r.task_id !== 'number' || !Number.isInteger(r.task_id) || r.task_id <= 0) return { valid: false, rows: [] };
    if (typeof r.task_status !== 'number' || !Number.isInteger(r.task_status)) return { valid: false, rows: [] };

    if (r.task_reward_view !== undefined && r.task_reward_view !== null) {
      if (typeof r.task_reward_view !== 'object') return { valid: false, rows: [] };
      const rw = r.task_reward_view as Record<string, unknown>;
      if (rw.reward_amount !== undefined && rw.reward_amount !== null) {
        if (typeof rw.reward_amount !== 'number' || !Number.isFinite(rw.reward_amount) || rw.reward_amount < 0) {
          return { valid: false, rows: [] };
        }
      }
    }
    if (seenKeys.has(r.task_key) || seenIds.has(r.task_id)) {
      return { valid: false, rows: [] };
    }
    seenKeys.add(r.task_key);
    seenIds.add(r.task_id);
    rows.push(r as unknown as RawTaskItem);
  }
  return { valid: true, rows };
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

  // Bước 2: Bắn do_action cho 9 nhiệm vụ lá
  for (const actionKey of LEAF_TASKS) {
    signal.throwIfAborted();
    attemptedKeys.add(actionKey);
    const opId = `${actionKey}_${userId}_${today}`;
    log(`   ⚡ Gửi do_action: ${actionKey}...`);

    signal.throwIfAborted();
    const result = await withinDeadline(
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
    );
    signal.throwIfAborted();

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
      log(`      ✅ ${actionKey}: hoàn thành (err_no=0)`);
    } else {
      log(`      ℹ️  ${actionKey}: trạng thái ${result.errNo} (${result.errMsg || 'đã xong/bỏ qua'})`);
    }

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
  }

  const fetchTaskList = async (): Promise<FetchTaskResult> => {
    signal.throwIfAborted();
    const evaluated = await withinDeadline(
      page.evaluate(async () => {
        try {
          const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scene: 'capcut_web_task' })
          });
          const d: unknown = await r.json();
          const body = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
          const dataObj = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
          const hasTaskList = Array.isArray(dataObj.task_list);
          const rawList = hasTaskList ? dataObj.task_list : [];
          const numeric = typeof body.err_no === 'number' && Number.isInteger(body.err_no);
          const valid = r.ok && numeric && body.err_no === 0 && hasTaskList;
          return {
            valid,
            tasks: rawList,
            errNo: numeric ? (body.err_no as number) : -1,
            errMsg:
              typeof body.err_tips === 'string'
                ? body.err_tips
                : typeof body.message === 'string'
                  ? body.message
                  : '',
            httpStatus: r.status,
            observedAt: Date.now()
          };
        } catch (e: unknown) {
          return {
            valid: false,
            tasks: [],
            errNo: -1,
            error: (e as Error)?.message || String(e),
            httpStatus: 0,
            observedAt: Date.now()
          };
        }
      }),
      30000,
      signal
    );
    signal.throwIfAborted();

    if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
      return {
        valid: false,
        tasks: [],
        observedAt: Date.now(),
        error: 'INVALID_EVALUATED_RESULT'
      };
    }

    const res = evaluated as FetchTaskResult;
    if (!res.valid) {
      return {
        ...res,
        valid: false,
        tasks: []
      };
    }

    const validated = validateTaskRows(res.tasks);
    if (!validated.valid) {
      return {
        ...res,
        valid: false,
        tasks: []
      };
    }

    return {
      ...res,
      valid: true,
      tasks: validated.rows
    };
  };

  let listRes = await fetchTaskList();
  let rawTasks = listRes.tasks;

  // Nếu chưa có task hoặc list chưa hợp lệ và có thể goto để hydrate
  if ((!listRes.valid || rawTasks.length === 0) && typeof page.goto === 'function') {
    log(
      `   ℹ️ task_list chưa trả dữ liệu hợp lệ (valid=${listRes.valid}, err_no=${listRes.errNo ?? 'N/A'}, msg=${listRes.errMsg || listRes.error || ''}). Đang kích hoạt khu vực nhiệm vụ...`
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
    await abortableDelay(2000, signal);

    // Đóng popup nếu có
    if (typeof page.locator === 'function') {
      for (const closeSel of ['button[aria-label="Close"]', 'button:has-text("Skip")', 'button:has-text("Got it")']) {
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

      // Click icon task drawer nếu có
      signal.throwIfAborted();
      const taskEntry = page.locator('[data-id="TitleBarTaskList"], [class*="Lv_Task-wrapper"], button.entry-').first();
      const entryVisible = await boundedDomRead(
        () => taskEntry.isVisible(),
        'http-task-drawer:visible',
        1000,
        signal
      ).catch((error) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(error)) throw error;
        return false;
      });
      if (entryVisible) {
        signal.throwIfAborted();
        if (input.ui) {
          await foregroundPage(page, { signal, stage: 'http-task-drawer', ui: input.ui }, () =>
            taskEntry.click({ timeout: 2000, signal })
          ).catch(() => {});
        }
        await abortableDelay(1500, signal);
      }
    }

    // Thử lại fetch
    listRes = await fetchTaskList();
    rawTasks = listRes.tasks;
  }

  if (!listRes.valid) {
    const unsettledProofs: UnsettledTaskProof[] = [...proofMemory].map(([key, proof]) => ({ key, proof }));
    return {
      outcomes: [],
      snapshot: null,
      fatalError: new Error('TASK_LIST_RESPONSE_INVALID'),
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
      const grantRes = await withinDeadline(
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
      const claimCount = await boundedDomRead(
        () => claimButtons.count(),
        'http-task-claim:count',
        1000,
        signal
      ).catch((error) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(error)) throw error;
        return 0;
      });
      if (claimCount > 0) {
        for (let i = 0; i < claimCount; i++) {
          signal.throwIfAborted();
          const btn = claimButtons.nth(i);
          const btnVisible = await boundedDomRead(
            () => btn.isVisible(),
            'http-task-claim:visible',
            1000,
            signal
          ).catch((error) => {
            signal.throwIfAborted();
            if (isDomReadTimeout(error)) throw error;
            return false;
          });
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
    listRes = await fetchTaskList();
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
      fatalError: new Error('TASK_LIST_RESPONSE_INVALID'),
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
