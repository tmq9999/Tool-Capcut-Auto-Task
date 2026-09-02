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
import type { ActionProof, CapcutTask, TaskSnapshot, TaskStore } from './taskApi';
import type { CapcutMissionEnv, MissionGroup } from './types';
import { URLS } from './urls';

export type { CapcutMissionEnv, MissionGroup, TaskOutcome } from './types';

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
  groups: MissionGroup[]
): Array<{ group: MissionGroup; need: Set<string> }> {
  const out: Array<{ group: MissionGroup; need: Set<string> }> = [];
  for (const group of groups) {
    const need = new Set(
      group.keys.filter((k) => {
        const t = snap.byKey.get(k);
        return t !== undefined && t.status !== 4;
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
  '[data-id="TitleBarTaskList"]',
  '#TitleBarTaskList',
  '[class*="Lv_Task-wrapper"]',
  'button.credit-section',
  'button:has-text("Free credits")',
  '[class*="entry-"]:has-text("Free credits")',
  // ĐỂ CUỐI: trên /my-edit đây chỉ là div bọc một span rỗng.
  '[data-id="TitleBarFreeCredits"]',
] as const;

/**
 * Lối vào đầu tiên CÓ KÍCH THƯỚC THẬT. `boundingBox()` trả null cho element ẩn
 * và 0×0 cho vỏ rỗng, nên nó lọc đúng cái bẫy nói trên.
 */
export async function findTaskEntry(page: Page): Promise<Locator | null> {
  for (const sel of TASK_ENTRY_SELECTORS) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 4 && box.height > 4) return loc;
  }
  return null;
}

/** Số dòng nhiệm vụ đang có trong DOM. 0 = popover đã đóng. */
async function countTaskRows(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[class*="taskRow"]').length).catch(() => 0);
}

/**
 * Đóng popover nhiệm vụ. Thứ tự thử theo đúng kết quả đo trên popover kẹt thật
 * (profile 1627342b, 2026-09-02): Escape KHÔNG ăn, click ra ngoài KHÔNG ăn,
 * bấm lại nút mở cũng KHÔNG ăn — CapCut ghim popover ở trạng thái
 * `enter_from=signup`. Chỉ reload mới đóng được.
 *
 * `allowReload = false` khi vừa bấm một nút trong popover: reload lúc đó có thể
 * huỷ request `do_action` đang bay.
 */
export async function closeTaskPopover(page: Page, allowReload: boolean): Promise<boolean> {
  if ((await countTaskRows(page)) === 0) return true;

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
  if ((await countTaskRows(page)) === 0) return true;

  // viewportSize() trả null với connectOverCDP -> lấy kích thước thật từ trang.
  const vp = await page
    .evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    .catch(() => null);
  if (vp) {
    await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h - 40)).catch(() => {});
    await page.waitForTimeout(600);
    if ((await countTaskRows(page)) === 0) return true;
  }

  if (!allowReload) return false;

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  return (await countTaskRows(page)) === 0;
}

/**
 * Popover "Today's tasks" che kín giữa canvas là nguyên nhân 10 lần lỗi
 * `canvas_panel_missing` / `canvas_prompt_missing` đêm 2026-09-01. Bản cũ tự mở
 * nó ra để đọc trạng thái rồi không bao giờ đóng lại.
 *
 * Gọi TRƯỚC `act()` nên reload ở đây là an toàn: chưa có thao tác nào để mất.
 */
export async function assertNoPopover(page: Page, log: LogFn = NO_LOG): Promise<void> {
  if (await closeTaskPopover(page, true)) return;
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
export async function runGroup(
  group: MissionGroup,
  env: CapcutMissionEnv,
  store: TaskStore,
  need: Set<string>
): Promise<Map<string, ActionProof | Error>> {
  const mark = Date.now();
  const result = new Map<string, ActionProof | Error>();

  await assertNoPopover(env.page, env.log);

  let actError: Error | null = null;
  try {
    await group.act(env, need);
  } catch (e) {
    actError = e instanceof Error ? e : new Error(String(e));
  }

  // Chờ song song: do_action có thể tới theo thứ tự bất kỳ.
  // Nếu act() đã ném thì không chờ lâu — chỉ thu những bằng chứng đã tới.
  const timeoutMs = actError ? 3000 : group.proofTimeoutMs;

  await Promise.all(
    [...need].map(async (key) => {
      try {
        const proof = await store.waitForAction(key, timeoutMs, mark);
        if (proof.errNo !== 0) {
          result.set(key, new Error(`do_action err_no=${proof.errNo} ${proof.errTips}`.trim()));
          return;
        }
        result.set(key, proof);
      } catch (e) {
        result.set(key, actError ?? (e instanceof Error ? e : new Error(String(e))));
      }
    })
  );

  return result;
}

/**
 * Tìm đúng MỘT dòng nhiệm vụ trong popover, khớp cả title VÀ reward.
 *
 * Hai dòng "Chat with AI agent" chỉ khác nhau ở reward (+110 Design Studio vs
 * +130 Video Studio). Bản cũ lọc chỉ theo title rồi `.first()`, nên lần nào
 * claim nhiệm vụ +130 cũng bốc trúng dòng +110 và báo thành công sai.
 *
 * Ném lỗi nếu không ra đúng 1 dòng — thà fail rõ hơn là bốc bừa.
 */
export async function findTaskRow(page: Page, title: string, reward: number): Promise<Locator> {
  const row = page
    .locator('[class*="taskRow"]')
    .filter({ hasText: title })
    .filter({ hasText: `+${reward}` });

  const n = await row.count().catch(() => 0);
  if (n !== 1) {
    throw new StepError(
      `Tìm dòng "${title}" +${reward} ra ${n} kết quả, cần đúng 1`,
      await dump(page, 'task_row_ambiguous')
    );
  }
  return row.first();
}

/** Mở popover nhiệm vụ, chạy `fn`, rồi cố đóng lại (không reload — xem closeTaskPopover). */
export async function withTaskPopover<T>(
  page: Page,
  fn: () => Promise<T>,
  log: LogFn = NO_LOG
): Promise<T> {
  if ((await countTaskRows(page)) === 0) {
    // Tab nền bị Chrome tiết chế nên animation popover không chạy tới đâu —
    // nhiệm vụ "bật thông báo" mở TAB MỚI nên hay rơi vào đúng cảnh này.
    await page.bringToFront().catch(() => {});

    const entryOnPage = await findTaskEntry(page);
    let entry = entryOnPage;
    if (!entry) {
      /**
       * Trang hiện tại KHÔNG có lối vào nhiệm vụ nào — `/ai-design` là đúng ca
       * đó: header chỉ có chip `credit-balance`, và dump
       * `.debug/005_task_row_ambiguous.html` (2026-09-02 19:06) cho
       * `TitleBarTaskList=0`, `taskRow=0`.
       *
       * Đó là lý do task CHA `capcut_web_design_studio_picture_creation` (+80)
       * của yrqfvwwk67499 mắc ở `status=2` mà không ai nhận được: `claimIfPending`
       * chạy trên `/ai-design`, nơi popover không thể mở. Ở tình huống này thì
       * không còn gì để mất — sang `/my-edit` nơi có icon nhiệm vụ.
       */
      log('   ℹ️  Trang hiện tại không có lối vào nhiệm vụ — sang /my-edit');
      await page.goto(URLS.main, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(5000);
      entry = await findTaskEntry(page);
    }

    if (!entry) {
      log('   ℹ️  Không có lối vào nhiệm vụ nào có kích thước thật trên trang này');
    } else if ((await countTaskRows(page)) === 0) {
      /**
       * NÓI RÕ element nào bị bấm — trước đây `.first()` trên selector gộp bốc
       * trúng `[data-id="TitleBarFreeCredits"]` là div bọc một span RỖNG, nên
       * bấm 2 lần vẫn 0 dòng (jksqtiqa24961, 2026-09-02 19:00).
       */
      const what = await entry
        .evaluate((el: Element) => {
          const cls = (el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.');
          return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}` +
            `${el.getAttribute('data-id') ? `[data-id=${el.getAttribute('data-id')}]` : ''}` +
            ` "${(el.textContent ?? '').trim().slice(0, 30)}"`;
        })
        .catch(() => '(không đọc được)');
      log(`   ℹ️  Lối vào nhiệm vụ sẽ bấm: ${what}`);

      for (let attempt = 1; attempt <= 2; attempt++) {
        // force: nut hien thi nhung Playwright coi la chua actionable (do tren
        // tab that 2026-09-02: click thuong timeout 6s, force thi an).
        await entry
          .click({ timeout: 5000, force: true })
          .catch((e: unknown) =>
            log(`   ℹ️  Bấm lối vào nhiệm vụ lỗi: ${(e as Error).message.slice(0, 90)}`)
          );
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && (await countTaskRows(page)) === 0) {
          await page.waitForTimeout(500);
        }
        const rows = await countTaskRows(page);
        if (rows > 0) {
          log(`   ℹ️  Sau lần bấm ${attempt}: ${rows} dòng nhiệm vụ trong popover`);
          break;
        }
        log(`   ℹ️  Sau lần bấm ${attempt}: popover vẫn 0 dòng`);
      }
    }
  }

  try {
    return await fn();
  } finally {
    // KHÔNG reload ở đây: request do_action vừa bắn có thể còn đang bay.
    // Nếu không đóng được thì assertNoPopover của nhóm sau sẽ reload.
    await closeTaskPopover(page, false);
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
  log: LogFn = NO_LOG
): Promise<boolean> {
  if (task.status !== 2) return false;

  const mark = Date.now();
  await withTaskPopover(
    page,
    async () => {
      const row = await findTaskRow(page, task.title, task.reward);
      await row.locator('button').first().click({ timeout: 8000 }).catch(() => {});
    },
    log
  );

  const snap = await store.waitForSnapshot(mark, 30000).catch(() => null);
  const after = snap?.byKey.get(task.taskKey)?.status;
  const granted = store.seenGrants().some((g) => g.at >= mark && g.errNo === 0);
  return after === 4 || granted;
}
