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

import { dump, StepError } from './diag';
import { clickIfVisible, foregroundPage } from './human';
import { boundedDomRead, isDomReadTimeout } from './cancellation';
import type { AccountUiInteraction } from './types';
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

function requireInteraction(ui: AccountUiInteraction, signal: AbortSignal): void {
  if (!signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  if (!ui) throw new Error('UI_INTERACTION_REQUIRED');
  signal.throwIfAborted();
}

function rethrowInterrupted(error: unknown, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
}

function getSurveyWrapper(page: Page) {
  const wrapper = page.locator('.lv-modal-wrapper');
  if (typeof wrapper.filter === 'function') {
    return wrapper
      .filter({ has: page.locator(SURVEY_SKIP) })
      .filter({ hasNot: page.locator('.operation-features-modal, .subscriptionModal') });
  }
  return page.locator('.lv-modal-wrapper');
}

/** Còn mask khảo sát nào đang phủ trang không? (Chỉ đếm khi có mask và survey skip button thật thuộc survey wrapper) */
async function isSurveyBlocking(page: Page, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const maskCount = await boundedDomRead(
    () => page.locator(BLOCKING_MASK).count(),
    'overlay:survey-mask-count',
    3000,
    signal
  ).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (isDomReadTimeout(error)) throw error;
    return 0;
  });
  if (maskCount === 0) return false;

  const surveyWrapper = getSurveyWrapper(page).first();
  const wrapperCount = await boundedDomRead(
    () => surveyWrapper.count(),
    'overlay:survey-wrapper-count',
    2000,
    signal
  ).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (isDomReadTimeout(error)) throw error;
    return 0;
  });
  if (wrapperCount === 0) return false;

  const skip = typeof surveyWrapper.locator === 'function'
    ? surveyWrapper.locator(SURVEY_SKIP).first()
    : page.locator(SURVEY_SKIP).first();

  const skipVisible = await boundedDomRead(
    () => skip.isVisible({ timeout: 1000 }),
    'overlay:survey-skip-visible',
    1500,
    signal
  ).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (isDomReadTimeout(error)) throw error;
    return false;
  });

  return skipVisible;
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
  ui: AccountUiInteraction,
  signal: AbortSignal,
  maxSteps = 3
): Promise<boolean> {
  requireInteraction(ui, signal);
  let clicks = 0;

  const succeed = (): boolean => {
    if (clicks > 0) log(`   → Đã bỏ khảo sát onboarding sau ${clicks} lần Skip`);
    return true;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (!(await isSurveyBlocking(page, signal))) return succeed();

    const surveyWrapper = getSurveyWrapper(page).first();
    const skip = typeof surveyWrapper.locator === 'function'
      ? surveyWrapper.locator(SURVEY_SKIP).first()
      : page.locator(SURVEY_SKIP).first();

    const skipVisible = await boundedDomRead(
      () => skip.isVisible({ timeout: 3000 }),
      'overlay:survey-skip-visible',
      4000,
      signal
    ).catch((error: unknown) => {
      signal.throwIfAborted();
      if (isDomReadTimeout(error)) throw error;
      return false;
    });
    if (!skipVisible) break;

    const clicked = await foregroundPage(
      page,
      { signal, stage: 'overlay:survey-skip', ui },
      () => skip.click({ timeout: 8000 })
    )
      .then(() => true)
      .catch((error: unknown) => {
        rethrowInterrupted(error, signal);
        return false;
      });
    if (!clicked) break;
    clicks += 1;

    // Bước bản cũ thiếu: chờ mask thật sự biến mất. Mask đổi `display` nên nó
    // rời khỏi selector — `detached` bắt được cả xoá node và đổi style.
    await boundedDomRead(
      async () => {
        try {
          await page.locator(BLOCKING_MASK).first().waitFor({
            state: 'detached',
            timeout: 4000,
          });
          return true;
        } catch (error) {
          signal.throwIfAborted();
          if (isDomReadTimeout(error)) throw error;
          if (error instanceof Error && error.name === 'TimeoutError') return false;
          throw error;
        }
      },
      'overlay:survey-mask-detached',
      6000,
      signal
    );
  }

  if (!(await isSurveyBlocking(page, signal))) return succeed();

  const shot = await dump(page, 'khao_sat_onboarding_khong_tat');
  log(
    `   ⚠️  Khảo sát onboarding VẪN CÒN sau ${clicks} lần Skip — modal sẽ che nhiệm vụ` +
      (shot ? ` (hiện trường: ${shot})` : '')
  );
  return false;
}

/**
 * ---------------------------------------------------------------------------
 * 1.5. MODAL GIỚI THIỆU TÍNH NĂNG ("Got it")
 * ---------------------------------------------------------------------------
 * Gặp sau khi vào workspace / homepage: modal `.operation-features-modal`
 * có nút "Got it", không có Skip. Tách biệt hoàn toàn khỏi khảo sát onboarding
 * để không ghi nhận nhầm là khảo sát thất bại.
 */
const FEATURE_MODAL_CONTAINER = '.operation-features-modal';
const FEATURE_GOT_IT_BUTTON =
  'button:has-text("Got it"), div[role="button"]:text-is("Got it"), [class*="gotIt"], button:text-is("Got it")';
const FEATURE_CLOSE_SELECTOR =
  '.lv-modal-close-icon, [aria-label="Close"], button[aria-label="Close"], [role="button"][aria-label="Close"]';

function getFeatureModalWrappers(page: Page) {
  const wrapper = page.locator('.lv-modal-wrapper');
  if (typeof wrapper.filter === 'function') {
    return wrapper.filter({ has: page.locator(FEATURE_MODAL_CONTAINER) });
  }
  return page.locator(FEATURE_MODAL_CONTAINER);
}

export async function dismissOperationFeatureModal(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  requireInteraction(ui, signal);
  const wrappers = getFeatureModalWrappers(page);
  const count = await boundedDomRead(
    () => wrappers.count(),
    'overlay:feature-modal-count',
    2000,
    signal
  );

  const visibleOwners: ReturnType<Page['locator']>[] = [];

  if (count > 0) {
    for (let i = 0; i < count; i += 1) {
      const candidate = typeof wrappers.nth === 'function' ? wrappers.nth(i) : (i === 0 ? wrappers.first() : null);
      if (!candidate) break;
      const visible = await boundedDomRead(
        () => candidate.isVisible({ timeout: 1000 }),
        'overlay:feature-modal-present',
        2000,
        signal
      );
      if (visible) {
        visibleOwners.push(candidate);
      }
    }
  }

  if (visibleOwners.length === 0) {
    const directWrappers = page.locator(FEATURE_MODAL_CONTAINER);
    const directCount = await boundedDomRead(
      () => directWrappers.count(),
      'overlay:feature-modal-direct-count',
      2000,
      signal
    );

    if (directCount > 0) {
      for (let i = 0; i < directCount; i += 1) {
        const candidate = typeof directWrappers.nth === 'function' ? directWrappers.nth(i) : (i === 0 ? directWrappers.first() : null);
        if (!candidate) break;
        const visible = await boundedDomRead(
          () => candidate.isVisible({ timeout: 1000 }),
          'overlay:feature-modal-direct-present',
          2000,
          signal
        );
        if (visible) {
          visibleOwners.push(candidate);
        }
      }
    }
  }

  if (visibleOwners.length === 0) return true;

  if (visibleOwners.length > 1) {
    throw new Error('FEATURE_MODAL_OWNER_AMBIGUOUS: Multiple visible feature modal wrappers found');
  }

  const targetWrapper = visibleOwners[0];

  // 1. Ưu tiên tìm accessible Close button thuộc chính wrapper
  let closeBtn: ReturnType<Page['locator']> | null = null;
  let closeType: 'close' | 'got-it' = 'close';

  if (typeof targetWrapper.getByRole === 'function') {
    const accessibleClose = targetWrapper.getByRole('button', { name: 'Close', exact: true });
    let accessibleCount = 0;
    if (typeof accessibleClose.count === 'function') {
      accessibleCount = await boundedDomRead(
        () => accessibleClose.count(),
        'overlay:feature-modal-close-count',
        2000,
        signal
      );
    } else {
      const isVis = await boundedDomRead(
        () => accessibleClose.isVisible({ timeout: 1000 }),
        'overlay:feature-modal-close-visible',
        2000,
        signal
      );
      accessibleCount = isVis ? 1 : 0;
    }

    if (accessibleCount > 1) {
      throw new Error('FEATURE_MODAL_CLOSE_AMBIGUOUS: Multiple accessible Close buttons found');
    }

    if (accessibleCount === 1) {
      const hasClose = await boundedDomRead(
        () => accessibleClose.isVisible({ timeout: 1000 }),
        'overlay:feature-modal-close-visible',
        2000,
        signal
      );
      if (hasClose) {
        closeBtn = accessibleClose;
        closeType = 'close';
      }
    }
  }

  if (!closeBtn && typeof targetWrapper.locator === 'function') {
    const closeCandidates = targetWrapper.locator(FEATURE_CLOSE_SELECTOR);
    const candidateCount = typeof closeCandidates.count === 'function'
      ? await boundedDomRead(
          () => closeCandidates.count(),
          'overlay:feature-modal-close-icon-count',
          2000,
          signal
        )
      : 1;

    const visibleIcons: ReturnType<Page['locator']>[] = [];
    for (let i = 0; i < candidateCount; i += 1) {
      const candidate = typeof closeCandidates.nth === 'function' ? closeCandidates.nth(i) : closeCandidates.first();
      const hasCloseIcon = await boundedDomRead(
        () => candidate.isVisible({ timeout: 1000 }),
        'overlay:feature-modal-close-icon-visible',
        2000,
        signal
      );
      if (hasCloseIcon) {
        visibleIcons.push(candidate);
      }
    }

    if (visibleIcons.length > 1) {
      throw new Error('FEATURE_MODAL_CLOSE_AMBIGUOUS: Multiple visible close icon controls found');
    }
    if (visibleIcons.length === 1) {
      closeBtn = visibleIcons[0];
      closeType = 'close';
    }
  }

  // 2. Chỉ hỗ trợ biến thể "Got it" nếu chính wrapper này chứa "Got it" (không dùng fallback ra ngoài)
  if (!closeBtn && typeof targetWrapper.locator === 'function') {
    const gotItCandidates = targetWrapper.locator(FEATURE_GOT_IT_BUTTON);
    const candidateCount = typeof gotItCandidates.count === 'function'
      ? await boundedDomRead(
          () => gotItCandidates.count(),
          'overlay:feature-modal-got-it-count',
          2000,
          signal
        )
      : 1;

    const visibleGotIt: ReturnType<Page['locator']>[] = [];
    for (let i = 0; i < candidateCount; i += 1) {
      const candidate = typeof gotItCandidates.nth === 'function' ? gotItCandidates.nth(i) : gotItCandidates.first();
      const hasGotIt = await boundedDomRead(
        () => candidate.isVisible({ timeout: 1000 }),
        'overlay:feature-modal-got-it-visible',
        2000,
        signal
      );
      if (hasGotIt) {
        visibleGotIt.push(candidate);
      }
    }

    if (visibleGotIt.length > 1) {
      throw new Error('FEATURE_MODAL_CONTROL_AMBIGUOUS: Multiple visible Got it buttons found');
    }
    if (visibleGotIt.length === 1) {
      closeBtn = visibleGotIt[0];
      closeType = 'got-it';
    }
  }

  if (!closeBtn) {
    const shot = await dump(page, 'modal_tinh_nang_khong_thay_nut');
    log('   ⚠️  Modal tính năng đang mở nhưng không thấy nút Close hoặc Got it' + (shot ? ` (hiện trường: ${shot})` : ''));
    return false;
  }

  const clicked = await foregroundPage(
    page,
    { signal, stage: closeType === 'close' ? 'overlay:feature-modal-close' : 'overlay:feature-modal-got-it', ui },
    () => closeBtn.click({ timeout: 5000 })
  )
    .then(() => true)
    .catch((error: unknown) => {
      rethrowInterrupted(error, signal);
      return false;
    });

  if (!clicked) return false;

  await boundedDomRead(
    async () => {
      try {
        await targetWrapper.waitFor({
          state: 'hidden',
          timeout: 4000,
        });
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (isDomReadTimeout(error)) throw error;
        if (error instanceof Error && error.name === 'TimeoutError') return false;
        throw error;
      }
    },
    'overlay:feature-modal-hidden',
    6000,
    signal
  );

  const still = await boundedDomRead(
    () => targetWrapper.isVisible({ timeout: 500 }),
    'overlay:feature-modal-still-visible',
    1500,
    signal
  );

  if (still) {
    const shot = await dump(page, 'modal_tinh_nang_khong_dong');
    log(
      `   ⚠️  Modal tính năng ("${closeType === 'close' ? 'Close' : 'Got it'}") VẪN MỞ sau khi bấm — có thể che nhiệm vụ` +
        (shot ? ` (hiện trường: ${shot})` : '')
    );
    return false;
  }

  log(`   → Đã đóng modal giới thiệu tính năng ("${closeType === 'close' ? 'Close' : 'Got it'}")`);
  return true;
}

/**
 * ---------------------------------------------------------------------------
 * 2. BẢNG GIÁ "CHOOSE YOUR PLAN"
 * ---------------------------------------------------------------------------
 * ĐO ĐƯỢC 04/09/2026 06:29, dump `tools/fixtures/dom-pricing-modal.html`:
 * `missions/designStudio.ts` báo "Bấm Send canvas xong không thấy Stop
 * generating", nhưng prompt đã vào, ảnh đã có. Nguyên nhân: modal
 * `subscriptionModal-wrapper` mở đè lên toàn bộ canvas. Nút Send không bấm
 * được vì bị mask `display: block` chặn.
 *
 * Cách đóng:
 *   1. Phím Escape (CapCut hỗ trợ Escape trên modal này)
 *   2. Nút Close `[aria-label="Close"]` góc trên phải modal (fallback khi Escape không ăn)
 *
 * Hàm này trước đây chỉ tồn tại trong `missions/videoStudio.ts`, nên luồng
 * Design Studio không có gì đóng bảng giá. Cùng kiểu thiếu sót như khảo sát
 * onboarding: năng lực đã có, chỉ không được gọi ở nơi cần.
 *
 * @returns `true` khi không còn bảng giá nào phủ trang.
 */
export async function closeBlockingPricingModal(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  requireInteraction(ui, signal);
  const modal = page.locator('[class*="subscriptionModal"]').first();
  if ((await modal.count().catch(() => 0)) === 0) return true;
  if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) return true;

  await foregroundPage(
    page,
    { signal, stage: 'overlay:pricing-escape', ui },
    () => page.keyboard.press('Escape')
  ).catch((error: unknown) => { rethrowInterrupted(error, signal); });
  await page.waitForTimeout(900);

  if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
    await clickIfVisible(
      page,
      page.locator(
        '[class*="subscriptionModal"] [aria-label="Close"], [class*="subscriptionModal"] [class*="close"]'
      ),
      2500,
      { signal, stage: 'overlay:pricing-close', ui }
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

async function closePageErrorModal(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  requireInteraction(ui, signal);
  const wrapper = page.locator('.lv-modal-wrapper').filter({ hasText: PAGE_ERROR_TEXT }).first();
  if ((await wrapper.count().catch(() => 0)) === 0) return true;

  const refresh = wrapper.getByRole('button', { name: /Refresh|刷新/i }).first();
  if (await refresh.isVisible({ timeout: 800 }).catch(() => false)) {
    await foregroundPage(
      page,
      { signal, stage: 'overlay:page-error-refresh', ui },
      () => refresh.click({ timeout: 5000 })
    ).catch((error: unknown) => { rethrowInterrupted(error, signal); });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch((error: unknown) => {
      rethrowInterrupted(error, signal);
    });
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
 * A remaining blocker throws so every caller, including nested missions,
 * stops before clicking covered controls. The boolean return is success-only.
 */
export async function ensurePageUsable(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  requireInteraction(ui, signal);
  if ((await page.locator(BLOCKING_MASK).count().catch(() => 0)) === 0) return true;

  await skipOnboardingSurvey(page, log, ui, signal);
  await dismissOperationFeatureModal(page, log, ui, signal);
  await closeBlockingPricingModal(page, log, ui, signal);
  await closePageErrorModal(page, log, ui, signal);

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
  throw new StepError('Modal vẫn phủ trang; đã dừng thao tác để tránh click nhầm.', shot);
}
