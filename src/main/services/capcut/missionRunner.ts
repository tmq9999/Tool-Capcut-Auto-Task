/**
 * =============================================================================
 * MISSION RUNNER — CHỖ DUY NHẤT ĐƯỢC KẾT LUẬN THÀNH CÔNG
 * =============================================================================
 * Một `MissionGroup` chỉ biết thao tác UI. Nó KHÔNG được tự khai đã xong.
 * Runner mới là nơi đối chiếu với bằng chứng: `do_action` đúng `action_key` với
 * `err_no === 0`, rồi soi lại `task_status` trong snapshot của CapCut.
 *
 * Bản cũ sai ở chỗ ngược lại: mỗi bước tự in "✅" rồi đi tìm nút Claim không
 * tồn tại, nên báo cáo 7/10 trong khi CapCut ghi nhận 6/10.
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';

import { dump, StepError } from './diag';
import { ensurePageUsable } from './overlays';
import { foregroundPage } from './human';
import { createDirectUiInteraction } from './uiInteractionScheduler';
import type { ActionProof, CapcutTask, TaskSnapshot, TaskStore } from './taskApi';
import type { AccountUiInteraction, CapcutMissionEnv, MissionGroup } from './types';
import { URLS } from './urls';
import { measureStage } from '../stageTiming';
import { abortable, abortableDelay } from './cancellation';

export type { CapcutMissionEnv, MissionGroup, TaskOutcome } from './types';

export interface MissionEvidence {
  key: string;
  proof?: ActionProof;
  snapshotStatus?: number;
  state: 'verified' | 'proved-awaiting-snapshot' | 'failed';
  error?: Error;
}

export interface MissionGroupResult {
  evidence: Map<string, MissionEvidence>;
  snapshot: TaskSnapshot | null;
  actionSettledAt: number;
  fatalError?: Error;
}

/**
 * Log được INJECT, không dùng `console.log`: engine chạy trong main process của
 * Electron nên mọi dòng phải đi qua `LogBus` để có `accountId` (AGENTS.md §16).
 * Mặc định no-op để hàm vẫn gọi được từ chỗ không có logger.
 */
type LogFn = (msg: string) => void;

const NO_LOG: LogFn = () => {};

/**
 * Nhóm nào còn việc, và còn đúng những key nào. Thuần, test được.
 *
 * Key KHÔNG có trong snapshot nghĩa là account này không có nhiệm vụ đó — phải
 * BỎ QUA, không phải "coi như chưa xong". Đo được trên
 * arcgxxod38164@oldevlk.com (2026-09-02): account đó chỉ có 10 nhiệm vụ / 1380
 * credits, không có `capcut_web_pwa_install` lẫn `capcut_web_push_authorize`
 * (thay bằng `Daily sign-in`). Bản trước coi chúng là chưa xong nên đứng chờ
 * `do_action` 45 giây × 2 nhóm × 2 lần thử cho những nhiệm vụ không tồn tại.
 */
export function selectGroups(
  snap: TaskSnapshot,
  groups: MissionGroup[],
  proofBacked: ReadonlySet<string> = new Set()
): Array<{ group: MissionGroup; need: Set<string> }> {
  const out: Array<{ group: MissionGroup; need: Set<string> }> = [];
  for (const group of groups) {
    const need = new Set(
      group.keys.filter((key) => {
        const task = snap.byKey.get(key);
        return task !== undefined && task.status !== 4 && !proofBacked.has(key);
      })
    );
    if (need.size > 0) out.push({ group, need });
  }
  return out;
}

/**
 * Mọi lối vào popover nhiệm vụ đã ĐO ĐƯỢC, THEO ĐÚNG THỨ TỰ ƯU TIÊN.
 *
 * Thứ tự quan trọng vì `locator(a, b).first()` lấy theo THỨ TỰ DOM, không theo
 * thứ tự mình viết — và trong header thì vỏ rỗng lại đứng trước lối vào thật.
 *
 * Đo trên `.debug/004_no_task_list.html` (2026-09-02, qfvyjsly29972, trang
 * `/my-edit` đã đăng nhập):
 *
 *   <div data-id="TitleBarFreeCredits">
 *     <span id="SubmissionCampaignGuideFreeCreditsEntry" style="display:inline-flex"></span>
 *   </div>                                   ← RỖNG, bấm không ra gì
 *   <div data-id="TitleBarTaskList">
 *     <div id="TitleBarTaskList">
 *       <div class="Lv_Task-wrapper" style="width:40px;height:40px">  ← lối vào THẬT
 *
 * Chữ "Free credits" trên trang đó xuất hiện 0 lần, nên selector cũ không thể
 * khớp. Đây là nguyên nhân của CẢ HAI lỗi: `bootstrap` không bắt được
 * `task_list`, và bước bật thông báo báo "không thấy dòng nhiệm vụ".
 */
export const TASK_ENTRY_SELECTORS = [
  // ĐÃ CHỨNG MINH mở được popover: 2026-09-03 04:4x trên /ai-design, bấm
  // `button.entry-dGtF_I "Free creditsNew"` ra 10 dòng ngay lần đầu.
  'button:has-text("Free credits")',
  '[class*="entry-"]:has-text("Free credits")',
  // Icon nhiệm vụ 40×40. Thử element TRONG CÙNG trước, vì `[data-id=…]` chỉ là vỏ
  // bọc: cùng lượt đó, bấm vỏ ngoài 2 lần × 2 trang đều ra 0 dòng.
  '[class*="Lv_Task-wrapper"]',
  '#TitleBarTaskList',
  '[data-id="TitleBarTaskList"]',
  // ĐỂ CUỐI: trên /my-edit đây chỉ là div bọc một span rỗng.
  '[data-id="TitleBarFreeCredits"]',
] as const;

/** Mô tả ngắn của một element, để log nói rõ nó bấm vào cái gì. */
async function describe(entry: Locator): Promise<string> {
  return entry
    .evaluate((el: Element) => {
      const cls = (el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}` +
        `${el.getAttribute('data-id') ? `[data-id=${el.getAttribute('data-id')}]` : ''}` +
        ` "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    })
    .catch(() => '(không đọc được)');
}

/**
 * MỌI lối vào có kích thước thật trên trang, theo thứ tự ưu tiên.
 *
 * Trả về danh sách chứ không phải một cái, vì tiêu chí đúng là "popover CÓ MỌC
 * hay không" — không element nào được coi là lối vào chỉ vì nó tồn tại.
 */
export async function findTaskEntries(page: Page): Promise<Locator[]> {
  const found: Locator[] = [];
  for (const sel of TASK_ENTRY_SELECTORS) {
    const loc = page.locator(sel).first();
    // boundingBox auto-waits for a missing node; discovery must be a snapshot.
    if (await loc.count() === 0) continue;
    const box = await loc.boundingBox({ timeout: 250 }).catch(() => null);
    if (box && box.width > 4 && box.height > 4) found.push(loc);
  }
  return found;
}

/**
 * Lối vào đầu tiên CÓ KÍCH THƯỚC THẬT. `boundingBox()` trả null cho element ẩn
 * và 0×0 cho vỏ rỗng, nên nó lọc đúng cái bẫy nói trên.
 *
 * `button.credit-section` ĐÃ BỊ LOẠI khỏi danh sách: đo được trên account vừa
 * đăng ký (rklqbfsgcvuemg55910, 2026-09-03 04:1x) rằng nó là nút **credits +
 * Upgrade** — chẩn đoán in ra `button.credit-section "552200Upgrade"` (số 520 bị
 * rolling-digits nhân đôi, kèm chữ Upgrade). `trial.ts` dùng đúng nút đó để mở
 * modal nâng cấp. Để nó trong danh sách này thì nó vừa che mất lối vào thật, vừa
 * làm nhánh dự phòng `/my-edit` không bao giờ chạy vì "đã tìm được lối vào".
 */
export async function findTaskEntry(page: Page): Promise<Locator | null> {
  const [first] = await findTaskEntries(page);
  return first ?? null;
}

/** Số dòng nhiệm vụ đang có trong DOM. 0 = popover đã đóng. */
async function countTaskRows(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[class*="taskRow"]').length).catch(() => 0);
}

/**
 * Đóng popover nhiệm vụ. Thứ tự thử theo đúng kết quả đo trên popover kẹt thật
 * Escape may leave signup popovers pinned. Never click arbitrary background:
 * live 2026-09-05 hit an Inspiration card, opening a video modal over the header.
 * Only a canvas-safe boundary may reload; Go/Claim cleanup cannot navigate.
 *
 * `allowReload = false` khi vừa bấm một nút trong popover: reload lúc đó có thể
 * huỷ request `do_action` đang bay.
 */
export async function closeTaskPopover(
  page: Page,
  allowReload: boolean,
  signal?: AbortSignal,
  ui?: AccountUiInteraction
): Promise<boolean> {
  signal?.throwIfAborted();
  if ((await countTaskRows(page)) === 0) return true;
  const wait = (ms: number): Promise<void> => signal ? abortableDelay(ms, signal) : page.waitForTimeout(ms);

  const targetSig = signal ?? new AbortController().signal;
  const targetUi = ui ?? createDirectUiInteraction(targetSig);
  await foregroundPage(page, { signal: targetSig, stage: 'popover:escape', ui: targetUi }, () =>
    page.keyboard.press('Escape')
  ).catch(() => {});
  await wait(600);
  if ((await countTaskRows(page)) === 0) return true;

  if (!allowReload) return false;

  signal?.throwIfAborted();
  const reload = page.reload({ waitUntil: 'domcontentloaded', timeout: 12_000 });
  await (signal ? abortable(reload, signal) : reload).catch(() => { signal?.throwIfAborted(); });
  await wait(5000);
  return (await countTaskRows(page)) === 0;
}

/**
 * Popover "Today's tasks" che kín giữa canvas là nguyên nhân 10 lần lỗi
 * `canvas_panel_missing` / `canvas_prompt_missing` đêm 2026-09-01. Bản cũ tự mở
 * nó ra để đọc trạng thái rồi không bao giờ đóng lại.
 *
 * Gọi TRƯỚC `act()` nên reload ở đây là an toàn: chưa có thao tác nào để mất.
 */
export async function assertNoPopover(
  page: Page,
  log: LogFn = NO_LOG,
  signal?: AbortSignal,
  ui?: AccountUiInteraction
): Promise<void> {
  if (await closeTaskPopover(page, true, signal, ui)) return;
  // Câu này vừa đi vào log (LogBus) vừa là message của StepError: người đọc log
  // thấy ngay lý do, chỗ bắt lỗi vẫn có nguyên văn để báo cáo.
  const why = 'Popover nhiệm vụ không đóng được kể cả sau khi reload — nó sẽ che canvas';
  log(why);
  throw new StepError(why, await dump(page, 'popover_stuck'));
}

/**
 * Chạy một nhóm rồi CHỜ BẰNG CHỨNG cho từng key cần thiết.
 * Không có đường nào để `act()` tự khai thành công.
 *
 * Quan trọng: `act()` ném lỗi KHÔNG có nghĩa cả nhóm thất bại. Một nhóm làm
 * nhiều nhiệm vụ, vỡ ở bước cuối thì các bước trước vẫn đã xong thật. Lượt chạy
 * 2026-09-02 04:02 là ví dụ: export vỡ nhưng `send_msg` và `generate_done` đều
 * có `do_action err_no=0`, vậy mà báo cáo đổ lỗi cho cả ba.
 */
export async function reconcileMissionEvidence(
  group: MissionGroup,
  env: CapcutMissionEnv,
  store: TaskStore,
  need: Set<string>
): Promise<MissionGroupResult> {
  const actionStartedAt = Date.now();
  let actError: Error | null = null;
  try {
    const runAct = () => group.act(env, need);
    if (group.workspace === 'editor' && env.ui?.editor) {
      await measureStage(
        'mission-action:' + group.name,
        () => env.ui.editor('mission:' + group.id, runAct),
        env.log
      );
    } else {
      await measureStage(
        'mission-action:' + group.name,
        runAct,
        env.log
      );
    }
  } catch (error: unknown) {
    env.signal.throwIfAborted();
    // Keep reconciliation alive long enough to retain proofs emitted before a
    // renderer timeout; the account owner will still fail/cleanup the page.
    actError = error instanceof Error ? error : new Error(String(error));
  }

  const actionSettledAt = Date.now();

  return measureStage(
    'mission-reconciliation:' + group.name,
    async () => {
      const budgetMs = actError ? Math.min(3000, group.proofTimeoutMs) : group.proofTimeoutMs;
      const deadlineAt = actionSettledAt + budgetMs;
      const remaining = (): number => Math.max(0, deadlineAt - Date.now());

      const proofEntries = await Promise.all([...need].map(async (key) => {
        try {
          const proof = await store.waitForAction(
            key,
            remaining(),
            actionStartedAt,
            env.signal
          );
          return [key, proof] as const;
        } catch (error: unknown) {
          env.signal.throwIfAborted();
          return [key, error instanceof Error ? error : new Error(String(error))] as const;
        }
      }));

      // Confirmations often arrive while act() is still waiting for UI cleanup.
      // Require a snapshot after the proof, not after unrelated cleanup finishes.
      const proofAt = Math.max(actionStartedAt, ...proofEntries.map(([, value]) =>
        value instanceof Error ? actionStartedAt : value.at));
      let snapshot = store.snapshot();
      if (!snapshot || snapshot.at <= proofAt) {
        snapshot = remaining() > 0
          ? await store.waitForSnapshot(proofAt, remaining(), env.signal).catch(() => {
              env.signal.throwIfAborted();
              return null;
            })
          : null;
      }

      const evidence = new Map<string, MissionEvidence>();
      for (const [key, value] of proofEntries) {
        if (value instanceof Error) {
          evidence.set(key, { key, state: 'failed', error: actError ?? value });
          continue;
        }
        if (value.errNo !== 0) {
          evidence.set(key, {
            key,
            proof: value,
            state: 'failed',
            error: new Error(('do_action err_no=' + value.errNo + ' ' + value.errTips).trim())
          });
          continue;
        }

        const snapshotStatus = snapshot?.byKey.get(key)?.status;
        evidence.set(key, {
          key,
          proof: value,
          snapshotStatus,
          state: snapshotStatus === 4 ? 'verified' : 'proved-awaiting-snapshot'
        });
      }

      return { evidence, snapshot, actionSettledAt, ...((actError as { code?: string } | null)?.code === 'DOM_READ_TIMEOUT' ? { fatalError: actError! } : {}) };
    },
    env.log
  );
}

export async function runGroup(
  group: MissionGroup,
  env: CapcutMissionEnv,
  store: TaskStore,
  need: Set<string>
): Promise<MissionGroupResult> {
  env.signal.throwIfAborted();
  if (!await ensurePageUsable(env.page, env.log)) {
    throw new StepError('Modal vẫn phủ trang; không thao tác nhiệm vụ.', await dump(env.page, 'mission_overlay_blocked'));
  }
  // Simple tasks need this popover closed. Workspace groups navigate away from
  // the task page themselves, which is the reliable escape when CapCut pins
  // the popover and ignores Escape/reload.
  const workspaceGroup = group.workspace === 'editor';
  if (!workspaceGroup && !group.keys.every((key) => key === 'capcut_web_pwa_install' || key === 'capcut_web_push_authorize')) {
    await assertNoPopover(env.page, env.log, env.signal, env.ui);
  }
  env.signal.throwIfAborted();
  return reconcileMissionEvidence(group, env, store, need);
}

/**
 * Tìm đúng MỘT dòng nhiệm vụ trong popover, ưu tiên task_key.
 *
 * Hai dòng "Chat with AI agent" có thể trùng title giữa các nhóm. Vì reward
 * thay đổi theo account/IP, không dùng reward hardcode để chọn dòng.
 *
 * Một số DOM không đưa task_key ra row, nên có fallback title-only nhưng chỉ
 * chấp nhận khi title là duy nhất; không bốc bừa khi title trùng.
 *
 * Ném lỗi nếu không ra đúng 1 dòng — thà fail rõ hơn là bốc bừa.
 */
export async function findTaskRow(
  page: Page,
  taskKey: string,
  title: string,
  log: LogFn = NO_LOG
): Promise<Locator> {
  const byKey = page.locator(
    `[data-task-key="${taskKey}"], [data-task-id="${taskKey}"], [data-key="${taskKey}"]`
  );
  if (await byKey.count().catch(() => 0) === 1) return byKey.first();

  const byTitle = page.locator('[class*="taskRow"]').filter({ hasText: title });
  const onlyTitle = await byTitle.count().catch(() => 0);
  if (onlyTitle === 1) {
    log(
      `   ℹ️  Không thấy data task_key ${taskKey}; dùng dòng duy nhất "${title}" ` +
        '(reward lấy động từ task_list)'
    );
    return byTitle.first();
  }

  throw new StepError(
    `Tìm task ${taskKey} ("${title}") ra ${onlyTitle} dòng, cần đúng 1`,
    await dump(page, 'task_row_ambiguous')
  );
}

/** Mở popover nhiệm vụ, chạy `fn`, rồi cố đóng lại (không reload — xem closeTaskPopover). */
export async function withTaskPopover<T>(
  page: Page,
  fn: () => Promise<T>,
  log: LogFn = NO_LOG,
  options: { signal?: AbortSignal; deadlineAt?: number; ui?: AccountUiInteraction } = {}
): Promise<T> {
  const signal = options.signal ?? new AbortController().signal;
  const deadlineAt = options.deadlineAt ?? Date.now() + 20_000;
  const ui = options.ui ?? createDirectUiInteraction(signal);
  const remaining = (): number => {
    signal.throwIfAborted();
    if (page.isClosed()) throw new StepError('Tab đã đóng khi mở nhiệm vụ.');
    const ms = deadlineAt - Date.now();
    if (ms <= 0) throw new StepError('Hết thời hạn mở popover nhiệm vụ.');
    return ms;
  };
  const waitRows = async (budget: number): Promise<boolean> => {
    const until = Math.min(deadlineAt, Date.now() + budget);
    while (Date.now() < until) {
      remaining();
      if (await countTaskRows(page) > 0) return true;
      await abortableDelay(Math.min(200, until - Date.now()), signal);
    }
    return await countTaskRows(page) > 0;
  };
  const tryHere = async (budget: number): Promise<boolean> => {
    const until = Math.min(deadlineAt, Date.now() + budget);
    while (Date.now() < until) {
      remaining();
      if (await countTaskRows(page) > 0) return true;
      const entries = await findTaskEntries(page);
      for (const entry of entries) {
        const ms = Math.min(remaining(), until - Date.now());
        if (ms <= 0) break;
        log('Thử lối vào nhiệm vụ: ' + await describe(entry));
        await foregroundPage(page, { signal, stage: 'popover:entry-click', ui }, () =>
          abortable(entry.click({ timeout: Math.min(1500, ms), force: true }), signal)
        ).catch(() => { signal.throwIfAborted(); });
        if (await waitRows(Math.min(1000, Math.max(0, until - Date.now())))) return true;
      }
      if (Date.now() < until) await abortableDelay(Math.min(200, until - Date.now()), signal);
    }
    return false;
  };

  await measureStage('popover-open', async () => {
    remaining();
    if (await countTaskRows(page) > 0) return;
    if (!await ensurePageUsable(page, log)) throw new StepError('Modal vẫn phủ trang nhiệm vụ.');
    remaining();
    await foregroundPage(page, { signal, stage: 'popover:bring-to-front', ui }, () =>
      abortable(page.bringToFront(), signal)
    );
    if (await tryHere(Math.min(5000, remaining()))) return;
    remaining();
    if (!page.url().includes('enter_source=web_task_earn_credit')) {
      log('Vào route nhiệm vụ; vẫn dùng cùng deadline.');
      await abortable(page.goto(URLS.tasks, { waitUntil: 'domcontentloaded', timeout: remaining() }), signal);
      if (!await ensurePageUsable(page, log)) throw new StepError('Modal vẫn phủ trang nhiệm vụ.');
    }
    if (!await tryHere(remaining())) throw new StepError('Không mở được popover trong thời hạn.');
  }, log);
  remaining();
  try {
    return await fn();
  } finally {
    // Reload here destroys the deferred PWA prompt and can cancel do_action.
    // A pinned popover is handled at the next canvas-safe mission boundary.
    if (!signal.aborted && !page.isClosed()) {
      await measureStage('popover-close', async () => {
        if (!await closeTaskPopover(page, false, signal, ui)) log('Popover còn ghim; xử lý ở ranh giới nhóm kế tiếp.');
      }, log).catch(() => {});
    }
  }
}

/**
 * Nhánh DỰ PHÒNG: chỉ dùng khi `task_status` kẹt ở 2 sau khi đã có `do_action`.
 *
 * Trong lượt capture 12/12 nhiệm vụ, nhánh này không bao giờ chạy — mọi nhiệm
 * vụ nhảy thẳng 1→4 và không có `grant_reward` nào. Nhưng ảnh
 * `.debug/1788282967023_*` của một account khác (tổng +580/1800) có render nút
 * `Claim` thật, nên không kết luận Claim vô dụng từ một lượt đo.
 */
export async function claimIfPending(
  page: Page,
  task: CapcutTask,
  store: TaskStore,
  log: LogFn = NO_LOG,
  signal?: AbortSignal,
  ui?: AccountUiInteraction
): Promise<boolean> {
  if (task.status !== 2) return false;

  const mark = Date.now();
  const targetSig = signal ?? new AbortController().signal;
  const targetUi = ui ?? createDirectUiInteraction(targetSig);
  await withTaskPopover(
    page,
    async () => {
      targetSig.throwIfAborted();
      const row = await findTaskRow(page, task.taskKey, task.title, log);
      await foregroundPage(page, { signal: targetSig, stage: 'popover:claim', ui: targetUi }, () =>
        row.locator('button').first().click({ timeout: 8000 })
      ).catch(() => {});
    },
    log,
    { signal: targetSig, ui: targetUi }
  );

  const deadline = Date.now() + 30_000;
  let after: number | undefined;
  let since = mark;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const snap = await store.waitForSnapshot(since, deadline - Date.now(), signal)
      .catch(() => {
        signal?.throwIfAborted();
        return null;
      });
    if (!snap) break;
    since = snap.at;
    after = snap.byKey.get(task.taskKey)?.status;
    if (after === 4) return true;
  }
  return after === 4;
}
