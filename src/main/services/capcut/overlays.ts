/**
 * =============================================================================
 * OVERLAYS — HAI THỨ PHỦ TRANG VÀ LÀM MỌI CLICK SAU ĐÓ VÔ NGHĨA
 * =============================================================================
 *   1. Khảo sát onboarding 3 bước  → `skipOnboardingSurvey`
 *   2. Bảng giá "Choose your plan" → `closeBlockingPricingModal`
 *
 * Cả hai đều dùng `lv-modal-mask` `display: block` phủ toàn trang, nên triệu
 * chứng giống nhau và giống nhau một cách nguy hiểm: click "thành công" mà không
 * tới đích, im lặng cho tới khi một bước sau timeout ở chỗ khác. Đúng lớp lỗi mà
 * `assertHittable` sinh ra để chặn.
 * =============================================================================
 */

/**
 * ---------------------------------------------------------------------------
 * 1. KHẢO SÁT ONBOARDING
 * ---------------------------------------------------------------------------
 * CapCut chèn một modal khảo sát 3 bước ngay sau khi đăng ký / đăng nhập:
 *
 *   "Which of the following roles best describes you?"   (1 / 3)
 *   <div aria-hidden="true" class="lv-modal-mask" style="display: block">
 *   <div class="lv-modal-wrapper" style="z-index: 1101; display: block">
 *   <div class="skip-mrkR37">Skip</div>
 *
 * ĐO ĐƯỢC 04/09/2026 05:44 — ngay sau khi `signupCapcut` in
 * "✅ ĐĂNG KÝ THÀNH CÔNG" và "→ Đã bấm Skip khảo sát", mask VẪN còn
 * `display: block`. Trong cùng lượt đó: Design Studio trượt cả 4 nhiệm vụ với
 * "Không thấy panel chat AI agent", popover nhiệm vụ mở ra 0 dòng, và
 * `isInsideApp` vẫn trả true vì nó chỉ đọc URL `/my-edit`.
 *
 * NGUYÊN NHÂN GỐC không phải selector — đã đo trên dump
 * `tools/fixtures/dom-role-survey-modal.html`: OR-list Skip phân giải ra ĐÚNG
 * MỘT element và đó đúng là `.skip-mrkR37`. Nguyên nhân là bản cũ:
 *
 *   await skip.click({ timeout: 8000 }).catch(() => {});   // nuốt lỗi
 *   log('   → Đã bấm Skip khảo sát');                       // báo thành công vô điều kiện
 *   await page.waitForTimeout(3000);                        // không đọc lại DOM
 *
 * Cùng một lớp lỗi mà `assertHittable` sinh ra để chặn: click báo thành công mà
 * không tới đích. Nên ở đây phải ĐỌC LẠI DOM, và lặp vì khảo sát có 3 bước.
 */

import type { Page } from 'playwright-core';

import { dump } from './diag';
import { clickIfVisible } from './human';
import type { LogFn } from './login';

/**
 * Mask phủ toàn trang của modal khảo sát. Lọc theo `display: block` có chủ ý:
 * CapCut để mask lại trong DOM sau khi đóng, chỉ đổi `display`.
 */
/**
 * Mask phủ toàn trang. Lọc theo `display: block` có chủ ý: CapCut để mask lại
 * trong DOM sau khi đóng, chỉ đổi `display`. Cả ba modal đã đo được (khảo sát,
 * bảng giá, trang lỗi) đều dùng đúng mask này.
 */
const BLOCKING_MASK = '.lv-modal-mask[style*="display: block"]';

/**
 * Nút thoát. `.skip-mrkR37` là cái đã đo được; ba lựa chọn còn lại giữ nguyên từ
 * bản cũ cho các biến thể modal khác (đo được 0 kết quả trên dump 05:44, nên
 * chúng không phải là thủ phạm và cũng không gây hại).
 */
const SURVEY_SKIP =
  '.skip-mrkR37, button:has-text("Skip"), div[role="button"]:text-is("Skip"), button:has-text("Not now")';

/** Còn mask nào đang phủ trang không? */
async function isSurveyBlocking(page: Page): Promise<boolean> {
  return (await page.locator(BLOCKING_MASK).count().catch(() => 0)) > 0;
}

/**
 * Bỏ khảo sát onboarding, bấm Skip tối đa `maxSteps` lần (khảo sát có 3 bước) và
 * sau MỖI lần đọc lại DOM xem mask đã tắt chưa.
 *
 * @returns `true` khi không còn mask phủ trang (kể cả trường hợp chưa bao giờ có
 *          khảo sát), `false` khi khảo sát vẫn còn sau khi đã thử hết.
 *
 * KHÔNG ném lỗi: tới bước này account đã đăng ký xong và đã tốn tiền hộp thư,
 * nên huỷ cả luồng là mất account. Nhưng cũng KHÔNG được báo thành công khống —
 * người gọi nhận về `false` kèm một dòng log có địa chỉ hiện trường.
 */
export async function skipOnboardingSurvey(
  page: Page,
  log: LogFn,
  maxSteps = 3
): Promise<boolean> {
  let clicks = 0;

  const succeed = (): boolean => {
    if (clicks > 0) log(`   → Đã bỏ khảo sát onboarding sau ${clicks} lần Skip`);
    return true;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (!(await isSurveyBlocking(page))) return succeed();

    const skip = page.locator(SURVEY_SKIP).first();
    if (!(await skip.isVisible({ timeout: 3000 }).catch(() => false))) break;

    await skip.click({ timeout: 8000 }).catch(() => {});
    clicks += 1;

    // Bước bản cũ thiếu: chờ mask thật sự biến mất. Mask đổi `display` nên nó
    // rời khỏi selector — `detached` bắt được cả xoá node và đổi style.
    await page
      .locator(BLOCKING_MASK)
      .first()
      .waitFor({ state: 'detached', timeout: 4000 })
      .catch(() => {});
  }

  if (!(await isSurveyBlocking(page))) return succeed();

  const shot = await dump(page, 'khao_sat_onboarding_khong_tat');
  log(
    `   ⚠️  Khảo sát onboarding VẪN CÒN sau ${clicks} lần Skip — modal sẽ che nhiệm vụ` +
      (shot ? ` (hiện trường: ${shot})` : '')
  );
  return false;
}

/**
 * ---------------------------------------------------------------------------
 * 2. BẢNG GIÁ "CHOOSE YOUR PLAN"
 * ---------------------------------------------------------------------------
 * Bảng giá phủ kín trang, và nó mở ra vì có ai bấm `Continue` trên card upsell
 * Pro (bản cũ của Video Studio làm đúng thế). Mở rồi thì mọi bước sau vô nghĩa.
 *
 * ĐO ĐƯỢC 04/09/2026 06:29, dump `tools/fixtures/dom-canvas-pricing-modal.html`:
 * nhiệm vụ `capcut_web_design_studio_canvas_edit` báo `canvas_send_no_effect`,
 * và trong DOM lúc đó có `subscriptionModal-wrapper` `display: block` cùng
 * `lv-modal-mask` `display: block` — Send không thể tới đích.
 *
 * Hàm này trước đây chỉ tồn tại trong `missions/videoStudio.ts`, nên luồng
 * Design Studio không có gì đóng bảng giá. Cùng kiểu thiếu sót như khảo sát
 * onboarding: năng lực đã có, chỉ không được gọi ở nơi cần.
 *
 * @returns `true` khi không còn bảng giá nào phủ trang.
 */
export async function closeBlockingPricingModal(page: Page, log: LogFn): Promise<boolean> {
  const modal = page.locator('[class*="subscriptionModal"]').first();
  if ((await modal.count().catch(() => 0)) === 0) return true;
  if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) return true;

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(900);

  if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
    await clickIfVisible(
      page,
      page.locator(
        '[class*="subscriptionModal"] [aria-label="Close"], [class*="subscriptionModal"] [class*="close"]'
      ),
      2500
    );
    await page.waitForTimeout(600);
  }

  // Đọc lại DOM: cùng luật với khảo sát — không báo đã đóng khi chưa đóng.
  const still = await modal.isVisible({ timeout: 400 }).catch(() => false);
  if (still) {
    const shot = await dump(page, 'bang_gia_khong_dong');
    log(
      '   ⚠️  Bảng giá Pro VẪN mở sau Escape và nút Close — mọi click sau sẽ trượt' +
        (shot ? ` (hiện trường: ${shot})` : '')
    );
    return false;
  }

  log('   ⚠️  Bảng giá Pro đang mở — đã đóng để luồng đi tiếp');
  return true;
}

/**
 * ---------------------------------------------------------------------------
 * 3. MODAL "TRANG LỖI" CỦA CAPCUT
 * ---------------------------------------------------------------------------
 * ĐO ĐƯỢC 04/09/2026 06:40, dump `tools/fixtures/dom-page-error-modal.html`:
 * nhiệm vụ `capcut_web_design_studio_ai_chat` báo "Không thấy nút Send message",
 * nhưng `aria-label="Send message"` CÓ trong DOM. Thứ chặn nó là một mask
 * `display: block` của modal do CapCut tự bung:
 *
 *   页面异常 — 页面异常，请刷新页面重试   ("trang lỗi, hãy refresh rồi thử lại")
 *   [ Refresh ]
 *
 * Modal này có nút hành động rõ ràng, nên cách đúng là bấm đúng nút nó đòi.
 * Báo "không thấy nút Send message" là chỉ sai địa chỉ — nút vẫn ở đó.
 */
const PAGE_ERROR_TEXT = /页面异常|Page (error|exception)/;

async function closePageErrorModal(page: Page, log: LogFn): Promise<boolean> {
  const wrapper = page.locator('.lv-modal-wrapper').filter({ hasText: PAGE_ERROR_TEXT }).first();
  if ((await wrapper.count().catch(() => 0)) === 0) return true;

  const refresh = wrapper.getByRole('button', { name: /Refresh|刷新/i }).first();
  if (await refresh.isVisible({ timeout: 800 }).catch(() => false)) {
    await refresh.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  await page.waitForTimeout(4000);

  const still = (await page.locator('.lv-modal-wrapper').filter({ hasText: PAGE_ERROR_TEXT }).count().catch(() => 0)) > 0;
  if (still) {
    const shot = await dump(page, 'trang_loi_khong_dong');
    log('   ⚠️  CapCut báo "trang lỗi" và không dẹp được kể cả sau Refresh' + (shot ? ` (hiện trường: ${shot})` : ''));
    return false;
  }

  log('   ⚠️  CapCut báo "trang lỗi" — đã bấm Refresh để luồng đi tiếp');
  return true;
}

/**
 * ---------------------------------------------------------------------------
 * MỘT CHỖ DUY NHẤT BIẾT MỌI THỨ PHỦ TRANG
 * ---------------------------------------------------------------------------
 * Gọi trước mỗi nhóm nhiệm vụ. Ba lần trong ngày 04/09/2026, ba modal KHÁC NHAU
 * cùng chặn một nhiệm vụ khác nhau, và cả ba lần engine báo sai địa chỉ:
 *
 *   khảo sát onboarding → "Không thấy panel chat AI agent" (4 nhiệm vụ)
 *   bảng giá Pro        → "canvas_send_no_effect"
 *   trang lỗi           → "Không thấy nút Send message"
 *
 * Modal lạ thì KHÔNG đoán: ghi lại tiêu đề của nó + dump và trả `false`, để lần
 * sau có địa chỉ thật thay vì lại đi tìm một cái nút vẫn đang ở đó.
 */
export async function ensurePageUsable(page: Page, log: LogFn): Promise<boolean> {
  if ((await page.locator(BLOCKING_MASK).count().catch(() => 0)) === 0) return true;

  await skipOnboardingSurvey(page, log);
  await closeBlockingPricingModal(page, log);
  await closePageErrorModal(page, log);

  if ((await page.locator(BLOCKING_MASK).count().catch(() => 0)) === 0) return true;

  const title = await page
    .locator('.lv-modal-wrapper')
    .first()
    .innerText()
    .then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 120))
    .catch(() => '(không đọc được)');
  const shot = await dump(page, 'modal_la_phu_trang');
  log(
    `   ⚠️  Còn một modal chưa nhận diện được đang phủ trang: "${title}" — ` +
      'mọi click sau sẽ trượt' + (shot ? ` (hiện trường: ${shot})` : '')
  );
  return false;
}
