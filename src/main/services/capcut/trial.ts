/**
 * =============================================================================
 * TRIAL — CỔNG KIỂM TRA ƯU ĐÃI DÙNG THỬ PRO
 * =============================================================================
 * Chỉ làm nhiệm vụ cho account CÓ ưu đãi dùng thử Pro miễn phí >= 7 ngày.
 *
 * Đây là đường DOM legacy hiện vẫn được production engine gọi trực tiếp.
 *
 * Lần đo cũ chỉ đọc 11 trường API không đúng nguồn offer, và chúng đều nói
 * không có trial:
 *   can_free_trial: false      can_trial: false        hit_vip_trial: false
 *   can_free_trial_days: 0     trial_tips: ""          send_vip_days: 0
 *   is_free_trial: false       can_low_price_trial: false ...
 *
 * Trong khi modal Upgrade của CHÍNH account đó hiển thị rõ:
 *   Pro   222,000₫ → 0₫   for 7 days   [Start free trial]
 *
 * Capture mới xác nhận keyed pricing batch là một nguồn offer hợp lệ; parser và
 * request read-only của nguồn đó nằm riêng trong `http/trialOffers.ts` và
 * `http/trialApi.ts`, chưa được tích hợp vào engine này. Trong lúc production
 * còn giữ đường DOM, cấu trúc đo được 2026-09-02 là:
 *   .subscriptionProductSection-pro        thẻ gói Pro (class KHÔNG hash)
 *   text: "Pro | 222,000₫ | 0₫ | for 7 days | ..."
 *   button "Start free trial"              nút bắt đầu dùng thử
 * =============================================================================
 *
 * GHI CHÚ KHI PORT VÀO APP: `log` KHÔNG còn giá trị mặc định `console.log`.
 * Engine chạy trong main process của Electron nên mọi dòng phải đi qua `LogBus`
 * để có `accountId` (AGENTS.md §16) — người gọi buộc phải truyền `log`.
 */

import type { BrowserContext, Page } from 'playwright-core';

import { dump } from './diag';
import { foregroundPage, rand } from './human';
import {
  abortableDelay,
  boundedDomRead,
  isDomReadTimeout,
  withinDeadline,
  OperationDeadlineError,
} from './cancellation';
import { skipOnboardingSurvey } from './overlays';
import type { AccountUiInteraction } from './types';

export interface TrialInfo {
  /** `unknown` luôn chặn; policy caller quyết định cách xử lý eligible/ineligible. */
  status: 'eligible' | 'ineligible' | 'unknown';
  /** Có ưu đãi dùng thử miễn phí không */
  canTrial: boolean;
  /** Số ngày dùng thử đọc được từ "for N days" */
  days: number;
  /** Giá sau khi giảm, ví dụ "0₫" — chuỗi nguyên văn để log */
  trialPrice: string;
  /** Giá gốc, ví dụ "222,000₫" */
  listPrice: string;
  /** Có nút "Start free trial" hiện ra không */
  hasStartButton: boolean;
  /** Vì sao không đọc được, nếu thất bại */
  error?: string;
  dumpName?: string | null;
}

/** Số ngày tối thiểu để chấp nhận một account. */
export const MIN_TRIAL_DAYS = 7;

/**
 * Đọc trong trang, không dùng API. Trả về thông tin trial của gói Pro.
 * Code chạy trong trang được truyền dưới dạng CHUỖI để tránh esbuild chèn
 * `__name` (đã gặp lỗi "__name is not defined" trước đây).
 */
const READ_TRIAL = `(() => {
  var NL = String.fromCharCode(10);
  var card = document.querySelector('[class*="subscriptionProductSection-pro"]');
  if (!card) {
    // Dự phòng: tìm thẻ nào có tên gói Pro và mẫu "for N days"
    var all = [].slice.call(document.querySelectorAll('[class*="subscriptionProduct"]'));
    for (var i = 0; i < all.length; i++) {
      var t = all[i].innerText || '';
      if (/\\bPro\\b/.test(t) && /for\\s+\\d+\\s+days?/i.test(t)) { card = all[i]; break; }
    }
  }
  if (!card) return { found: false };

  var text = (card.innerText || '').split(NL).map(function (s) { return s.trim(); }).filter(Boolean);
  var joined = text.join(' | ');

  var dm = /for\\s+(\\d+)\\s+days?/i.exec(joined);
  // Giá: dòng đầu là giá gốc bị gạch, dòng sau là giá ưu đãi
  var prices = text.filter(function (s) { return /[0-9][0-9,.]*\\s*[₫$]|^[₫$]/.test(s); });

  var btn = null;
  var cands = [].slice.call(document.querySelectorAll('button, [role="button"]'));
  for (var j = 0; j < cands.length; j++) {
    if (/start free trial|free trial/i.test(cands[j].innerText || '')) {
      var r = cands[j].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { btn = true; break; }
    }
  }

  return {
    found: true,
    days: dm ? parseInt(dm[1], 10) : 0,
    listPrice: prices.length > 0 ? prices[0] : '',
    trialPrice: prices.length > 1 ? prices[1] : '',
    hasStartButton: !!btn,
    raw: joined.slice(0, 200)
  };
})()`;

/**
 * Xử lý onboarding survey che khuất Upgrade modal.
 * Nhận diện modal khảo sát cụ thể có nút Skip; đóng xong xác nhận lại xem đã biến mất chưa.
 */
async function clearTrialSurvey(
  page: Page,
  log: (message: string) => void,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  const survey = page
    .locator('.lv-modal-wrapper:visible')
    .filter({ has: page.locator('.skip-mrkR37, [class*="skip-"]') })
    .first();
  const present = await boundedDomRead(
    () => survey.isVisible(),
    'trial:survey-visible',
    1000,
    signal
  );
  if (!present) return true;
  await skipOnboardingSurvey(page, log, ui, signal);
  signal.throwIfAborted();
  return !(await boundedDomRead(
    () => survey.isVisible(),
    'trial:survey-after-skip',
    1000,
    signal
  ));
}

/**
 * Mở modal bảng giá Upgrade từ header CapCut.
 *
 * Thử lần lượt các vị trí nút Upgrade đã biết cho đến khi thấy thẻ gói Pro
 * xuất hiện trong modal. Trả `true` nếu mở thành công, `false` nếu đã thử hết
 * mà modal không hiện ra.
 */
export async function openUpgradeModal(
  page: Page,
  log: (m: string) => void,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<boolean> {
  signal.throwIfAborted();

  const pricingCard = page.locator('[class*="subscriptionProduct"]').first();
  const alreadyOpen = await boundedDomRead(
    () => pricingCard.isVisible(),
    'trial:pricing-already-open',
    1000,
    signal
  ).catch(() => false);
  if (alreadyOpen) return true;

  // Các popup che header phải dẹp trước: banner xin email, và onboarding "Got it".
  for (const sel of [
    'button.lv-btn-primary:has-text("Got it")',
    'button:has-text("Got it")',
    '[class*="banner"] [class*="close"]',
    'button[aria-label="Close"]',
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await foregroundPage(
        page,
        { signal, stage: 'trial:banner-close', ui },
        () => el.click({ timeout: 3000, force: true })
      ).catch((error: unknown) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(error)) throw error;
      });
      await abortableDelay(800, signal);
    }
  }

  /**
   * Lối vào khác nhau giữa các biến thể trang — đo được 2026-09-02:
   *   account MỚI  : `span.upgrade-text` trong header
   *   account CŨ   : chỉ có `[data-id="TitleBarUpgradeVip"]`, KHÔNG có
   *                  `span.upgrade-text` lẫn `button.credit-section`
   * `data-id` là thuộc tính không hash nên đặt lên đầu danh sách.
   */
  const entries: Array<[string, string]> = [
    ['[data-id="TitleBarUpgradeVip"]', 'TitleBarUpgradeVip (data-id)'],
    ['[data-id*="Upgrade"]', 'data-id chứa Upgrade'],
    ['span.upgrade-text', 'chữ Upgrade trên header'],
    ['[class*="UpgradeVip"]', 'nút UpgradeVip'],
    ['[data-id="TitleBarFreeCredits"]', 'ô Free credits (data-id)'],
    ['button.credit-section', 'ô credits'],
  ];

  for (const [sel, label] of entries) {
    const el = page.locator(sel).first();
    if ((await el.count().catch(() => 0)) === 0) continue;

    // `[data-id=...]` là div rỗng bọc ngoài; click vào chính nó vẫn nổi bọt
    // xuống component React bên trong, nên dùng force thay vì đòi visible.
    let clickSucceeded = false;
    await foregroundPage(
      page,
      { signal, stage: 'trial:open-upgrade', ui },
      () => el.click({ timeout: 5000, force: true })
    ).then(() => {
      clickSucceeded = true;
    }).catch((error: unknown) => {
      signal.throwIfAborted();
      if (isDomReadTimeout(error)) throw error;
      log(`bấm ${label} thất bại: ${error instanceof Error ? error.message : String(error)}`);
    });

    if (clickSucceeded) {
      log(`đã bấm ${label}`);
    }

    await abortableDelay(rand(6000, 8000), signal);

    const opened = await boundedDomRead(
      () => page.locator('[class*="subscriptionProduct"]').first().isVisible(),
      'trial:pricing-opened',
      6000,
      signal
    ).catch(() => false);
    if (opened) return true;
  }
  return false;
}

/**
 * Kiểm tra ưu đãi dùng thử Pro của account đang đăng nhập.
 *
 * Chỉ ĐỌC thông tin và trả về kết quả — KHÔNG bấm "Claim" / "Start free trial".
 * Việc kích hoạt (nếu có) do người gọi quyết định.
 */
export async function checkProTrial(
  page: Page,
  _context: BrowserContext,
  log: (m: string) => void,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<TrialInfo> {
  if (!ui) throw new Error('UI_INTERACTION_REQUIRED');
  if (!signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  signal.throwIfAborted();
  const fallback = (error: string, dumpName?: string | null): TrialInfo => ({
    status: 'unknown',
    canTrial: false,
    days: 0,
    trialPrice: '',
    listPrice: '',
    hasStartButton: false,
    error,
    dumpName,
  });

  try {
    await withinDeadline(
      page.goto('https://www.capcut.com/my-edit?start_tab=video', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }),
      60000,
      signal
    );
  } catch {
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  await abortableDelay(rand(6000, 9000), signal);

  signal.throwIfAborted();
  let surveyCleared: boolean;
  try {
    surveyCleared = await clearTrialSurvey(page, log, ui, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (isDomReadTimeout(error) || error instanceof OperationDeadlineError) throw error;
    return fallback('Không xác minh được trạng thái khảo sát onboarding');
  }
  signal.throwIfAborted();
  if (!surveyCleared) {
    return fallback('Khảo sát onboarding vẫn che trang', await dump(page, 'upgrade_modal_missing'));
  }

  if (!(await openUpgradeModal(page, log, ui, signal))) {
    return fallback('không mở được modal nâng cấp', await dump(page, 'upgrade_modal_missing'));
  }

  const raw = (await page.evaluate(READ_TRIAL).catch(() => null)) as {
    found?: boolean;
    days?: number;
    listPrice?: string;
    trialPrice?: string;
    hasStartButton?: boolean;
    raw?: string;
  } | null;

  if (!raw || !raw.found) {
    return fallback('không thấy thẻ gói Pro trong modal', await dump(page, 'pro_card_missing'));
  }

  const days = Number(raw.days ?? 0);
  const info: TrialInfo = {
    status: days >= MIN_TRIAL_DAYS ? 'eligible' : 'ineligible',
    canTrial: days > 0,
    days,
    trialPrice: String(raw.trialPrice ?? ''),
    listPrice: String(raw.listPrice ?? ''),
    hasStartButton: Boolean(raw.hasStartButton),
  };

  log(`gói Pro: ${info.listPrice} → ${info.trialPrice} cho ${days} ngày`);
  return info;
}

/** Account có đủ điều kiện làm nhiệm vụ không. */
export function isEligible(info: TrialInfo): boolean {
  return info.status === 'eligible' && !info.error && info.canTrial && info.days >= MIN_TRIAL_DAYS;
}
