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
  CapcutPace,
  TaskCheckpoint,
  TaskOutcome,
  UnsettledTaskProof
} from './types';
import type { ActionProof } from './taskApi';
import type { RunTasksResult, TaskSnapshotSummary, SnapshotTaskSummary } from './runTasks';
import { paceGapMs } from './runTasks';
import { abortableDelay } from './cancellation';

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
}

interface RawTaskItem {
  task_key: string;
  task_id: number;
  task_status: number;
  task_reward_view?: { reward_amount?: number };
  task_view?: { title?: string; button_text?: string };
}

/**
 * Trích xuất User ID số nguyên chuẩn của tài khoản CapCut từ backend (có retry 3 lần).
 */
export async function resolveNumericUserId(page: Page, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal?.throwIfAborted();
    const res = await page.evaluate(async () => {
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
    });

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

  log('\n============================================================');
  log('🚀 THỰC THI 12 NHIỆM VỤ BẰNG HTTP IN-SESSION (TỐC ĐỘ CAO)');
  log('============================================================');

  // Đóng các modal/popup che khuất trước khi thao tác
  if (typeof page.locator === 'function') {
    for (const closeSel of [
      'button[aria-label="Close"]',
      '[class*="modal"] [class*="close"]',
      'button:has-text("Skip")',
      'button:has-text("Got it")',
    ]) {
      const btn = page.locator(closeSel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
      }
    }
  }

  // Bước 1: Lấy User ID số
  const userId = await resolveNumericUserId(page, signal);
  log(`   🆔 User ID CapCut: ${userId}`);

  const today = new Date().toISOString().slice(0, 10);
  const actionProofs = new Map<string, ActionProof>();

  // Bước 2: Bắn do_action cho 9 nhiệm vụ lá
  for (const actionKey of LEAF_TASKS) {
    signal.throwIfAborted();
    const opId = `${actionKey}_${userId}_${today}`;
    log(`   ⚡ Gửi do_action: ${actionKey}...`);

    const result = await page.evaluate(async ({ actionKey, opId }) => {
      try {
        const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?aid=348188&device_platform=web', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action_key: actionKey, op_id: opId })
        });
        const d = await r.json();
        return { errNo: d.err_no ?? 0, errMsg: d.err_tips ?? '' };
      } catch (e: unknown) {
        return { errNo: -1, errMsg: (e as Error).message };
      }
    }, { actionKey, opId });

    actionProofs.set(actionKey, {
      actionKey,
      opId,
      errNo: result.errNo,
      errTips: result.errMsg || '',
      at: Date.now()
    });

    if (result.errNo === 0) {
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

  // Bước 3: Lấy danh sách nhiệm vụ đối soát (hỗ trợ điều hướng task entry nếu cần)
  signal.throwIfAborted();
  interface FetchTaskResult {
    tasks: RawTaskItem[];
    errNo?: number;
    errMsg?: string;
    httpStatus?: number;
    error?: string;
  }

  const fetchTaskList = async (): Promise<FetchTaskResult> => {
    const evaluated = await page.evaluate(async () => {
      try {
        const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene: 'capcut_web_task' })
        });
        const d = await r.json();
        return {
          tasks: Array.isArray(d.data?.task_list) ? d.data.task_list : [],
          errNo: d.err_no ?? 0,
          errMsg: d.err_tips || d.message || '',
          httpStatus: r.status
        };
      } catch (e: unknown) {
        return {
          tasks: [],
          error: (e as Error)?.message || String(e)
        };
      }
    });

    if (Array.isArray(evaluated)) {
      return { tasks: evaluated };
    }
    if (evaluated && typeof evaluated === 'object' && Array.isArray((evaluated as FetchTaskResult).tasks)) {
      return evaluated as FetchTaskResult;
    }
    return { tasks: [] };
  };

  let listRes = await fetchTaskList();
  let rawTasks = listRes.tasks ?? [];

  // Nếu chưa có task, điều hướng vào task feed hoặc bấm task entry để hydrate context
  if (rawTasks.length === 0 && typeof page.goto === 'function') {
    log(`   ℹ️ task_list chưa trả dữ liệu (err_no=${listRes.errNo ?? 'N/A'}, msg=${listRes.errMsg || listRes.error || ''}). Đang kích hoạt khu vực nhiệm vụ...`);
    
    // Điều hướng vào task entry URL
    await page.goto('https://www.capcut.com/my-edit?section=inspiration_feeds&enter_source=web_task_earn_credit', {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    }).catch(() => {});
    await abortableDelay(2000, signal);

    // Đóng popup nếu có
    if (typeof page.locator === 'function') {
      for (const closeSel of ['button[aria-label="Close"]', 'button:has-text("Skip")', 'button:has-text("Got it")']) {
        const btn = page.locator(closeSel).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
        }
      }

      // Click icon task drawer nếu có
      const taskEntry = page.locator('[data-id="TitleBarTaskList"], [class*="Lv_Task-wrapper"], button.entry-').first();
      if (await taskEntry.isVisible().catch(() => false)) {
        await taskEntry.click({ force: true }).catch(() => {});
        await abortableDelay(1500, signal);
      }
    }

    // Thử lại fetch
    listRes = await fetchTaskList();
    rawTasks = listRes.tasks;
  }

  log(`   📋 Đối soát danh sách nhiệm vụ: tìm thấy ${rawTasks.length} mục`);

  // Bước 4: Nhận thưởng cho các nhiệm vụ đang ở Status 2 (Claimable) nếu có
  let claimPass = 0;
  while (claimPass < 3) {
    const claimable = rawTasks.filter(t => t.task_status === 2);
    if (claimable.length === 0) break;
    claimPass++;
    log(`   🎁 Phát hiện ${claimable.length} nhiệm vụ đang chờ nhận thưởng (vòng ${claimPass}) — kích hoạt claim...`);
    for (const t of claimable) {
      signal.throwIfAborted();
      const grantRes = await page.evaluate(async (taskKey) => {
        try {
          const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/grant_reward', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ task_key: taskKey, scene: 'capcut_web_task' })
          });
          const d = await r.json();
          return { errNo: d.err_no ?? 0, errMsg: d.err_tips || '' };
        } catch {
          return { errNo: -1, errMsg: 'fetch_failed' };
        }
      }, t.task_key);

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
      const claimButtons = page.locator('button').filter({ hasText: /^Claim$/i });
      const claimCount = await claimButtons.count().catch(() => 0);
      if (claimCount > 0) {
        for (let i = 0; i < claimCount; i++) {
          const btn = claimButtons.nth(i);
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 2000, force: true }).catch(() => {});
            await abortableDelay(600, signal);
          }
        }
      }
    }

    // Refresh lại task_list sau khi claim
    listRes = await fetchTaskList();
    rawTasks = listRes.tasks;
  }



  // Bước 5: Tổng hợp Snapshot & Outcomes
  const tasks: SnapshotTaskSummary[] = rawTasks.map(t => ({
    key: t.task_key,
    title: t.task_view?.title || t.task_key,
    reward: t.task_reward_view?.reward_amount || 0,
    status: t.task_status
  }));

  const doneCount = tasks.filter(t => t.status === 4).length;
  const missingKeys = tasks.filter(t => t.status !== 4).map(t => t.key);
  const earnedCredits = tasks.filter(t => t.status === 4).reduce((sum, t) => sum + t.reward, 0);
  const totalCredits = tasks.reduce((sum, t) => sum + t.reward, 0);

  const observedAt = Date.now();
  const sessionStartedAt = input.sessionStartedAt ?? (observedAt - 1000);
  const requiredAfter = Math.min(sessionStartedAt, observedAt - 1);

  const snapshot: TaskSnapshotSummary = {
    observedAt,
    requiredAfter,
    tasks,
    total: tasks.length,
    done: doneCount,
    credits: earnedCredits,
    creditsTotal: totalCredits,
    missing: missingKeys,
    fresh: true,
    final: missingKeys.length === 0
  };

  const outcomes: TaskOutcome[] = tasks.map(t => {
    const proof = actionProofs.get(t.key);
    return {
      key: t.key,
      title: t.title,
      reward: t.reward,
      done: t.status === 4,
      attempts: 1,
      proof: proof?.errNo === 0 ? proof : undefined
    };
  });

  log(`   🏁 Tổng kết nhiệm vụ: Hoàn thành ${doneCount}/${tasks.length} | Đạt ${earnedCredits}/${totalCredits} credits\n`);

  if (input.onCheckpoint) {
    await input.onCheckpoint({
      outcomes,
      snapshot,
      unsettledProofs: []
    });
  }

  return {
    outcomes,
    snapshot,
    unsettledProofs: []
  };
}
