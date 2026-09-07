/**
 * =============================================================================
 * TRIAL — CỔNG KIỂM TRA ƯU ĐÃI DÙNG THỬ PRO
 * =============================================================================
 * Chỉ làm nhiệm vụ cho account CÓ ưu đãi dùng thử Pro miễn phí >= 7 ngày.
 *
 * BÀI HỌC ĐẮT: ở đây API KHÔNG phải nguồn sự thật.
 *
 * Tôi đã đọc 11 trường API và cả 11 đều nói không có trial:
 *   can_free_trial: false      can_trial: false        hit_vip_trial: false
 *   can_free_trial_days: 0     trial_tips: ""          send_vip_days: 0
 *   is_free_trial: false       can_low_price_trial: false ...
 *
 * Trong khi modal Upgrade của CHÍNH account đó hiển thị rõ:
 *   Pro   222,000₫ → 0₫   for 7 days   [Start free trial]
 *
 * Nên với nhiệm vụ (`task_list`/`do_action`) thì tin API; còn với trial thì phải
 * đọc DOM. Cấu trúc đo được 2026-09-02 trên account pthxdszn65494:
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
import { createDirectUiInteraction } from './uiInteractionScheduler';
import type { AccountUiInteraction } from './types';

export interface TrialInfo {
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

/** Mở modal nâng cấp. Trả về false nếu không bấm được lối vào nào. */
async function openUpgradeModal(
  page: Page,
  log: (m: string) => void,
  ui?: AccountUiInteraction,
  signal?: AbortSignal
): Promise<boolean> {
  const targetSig = signal ?? new AbortController().signal;
  const targetUi = ui ?? createDirectUiInteraction(targetSig);

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
        { signal: targetSig, stage: 'trial:banner-close', ui: targetUi },
        () => el.click({ timeout: 3000, force: true })
      ).catch(() => {});
      await page.waitForTimeout(800);
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
    await foregroundPage(
      page,
      { signal: targetSig, stage: 'trial:open-upgrade', ui: targetUi },
      () => el.click({ timeout: 5000, force: true })
    ).catch(() => {});
    log(`đã bấm ${label}`);
    await page.waitForTimeout(rand(6000, 8000));

    const opened = await page
      .locator('[class*="subscriptionProduct"]')
      .first()
      .isVisible({ timeout: 6000 })
      .catch(() => false);
    if (opened) return true;
  }
  return false;
}

/**
 * Kiểm tra ưu đãi dùng thử Pro của account đang đăng nhập.
 *
 * FAIL-OPEN: không đọc được thì trả `canTrial: true` kèm `error` — một trục trặc
 * giao diện thoáng qua không nên âm thầm bỏ qua cả batch. Người gọi quyết định
 * có tin hay không dựa vào `error`.
 */
export async function checkProTrial(
  page: Page,
  _context: BrowserContext,
  log: (m: string) => void,
  ui?: AccountUiInteraction,
  signal?: AbortSignal
): Promise<TrialInfo> {
  const fallback = (error: string, dumpName?: string | null): TrialInfo => ({
    canTrial: true,
    days: 0,
    trialPrice: '',
    listPrice: '',
    hasStartButton: false,
    error,
    dumpName,
  });

  await page
    .goto('https://www.capcut.com/my-edit?start_tab=video', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    .catch(() => {});
  await page.waitForTimeout(rand(6000, 9000));

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
  if (info.error) return true; // fail-open, xem checkProTrial
  return info.canTrial && info.days >= MIN_TRIAL_DAYS;
}
