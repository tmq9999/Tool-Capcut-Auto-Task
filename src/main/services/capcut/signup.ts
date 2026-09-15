/**
 * =============================================================================
 * ĐĂNG KÝ TÀI KHOẢN CAPCUT WEB (SIGNUP)
 * =============================================================================
 * Luồng thực tế đầy đủ trên CapCut Web:
 *
 *   1. Mở /signup (hoặc /login rồi chọn "Continue with email")
 *   2. Điền email -> Continue
 *   3. CapCut phân nhánh theo email:
 *        - Chưa tồn tại -> heading "Sign up" / "Create an account"
 *        - Đã tồn tại   -> heading "Welcome back" -> chuyển sang đăng nhập
 *   4. Điền password (+ xác nhận nếu có ô thứ 2), tick điều khoản -> Sign up
 *   5. Màn hình "When's your birthday?":
 *        - Điền Year (1998)
 *        - Chọn Month + Day
 *        - Bấm Continue
 *   6. Màn hình "Confirm your Email":
 *        - Tự động lấy OTP 6 số qua mail server API (oldevlk.com)
 *        - Điền mã xác minh -> bấm Confirm/Continue
 *   7. Màn hình "Get started with space" -> Bấm "Open CapCut"
 *   8. Bỏ qua khảo sát / onboarding -> vào workspace /my-edit
 * =============================================================================
 *
 * GHI CHÚ KHI PORT VÀO APP:
 *   - `mail-otp.ts` (`pollOtpFromApi`) KHÔNG được port: app đã có
 *     `Gmail94Provider` / `DongVanFBProvider` / `EmailPurchaseService`. Nguồn OTP
 *     giờ là tham số `getOtp` do người gọi cấp.
 *   - Bản engine còn nhánh HỎI QUA TERMINAL (`node:readline/promises`) khi API
 *     mail lỗi. Trong app không có stdin nên nhánh đó bị xoá: thiếu `getOtp` thì
 *     NÉM lỗi rõ ràng chứ không treo chờ người nhập.
 *   - Không còn `console.log`: mọi câu log giữ nguyên nguyên văn nhưng đi qua
 *     `log()` được inject để `LogBus` gắn `accountId` (AGENTS.md §16).
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

import type { CapcutCredentials, LogFn } from './login';
import { dump, StepError } from './diag';
import { dismissOperationFeatureModal, skipOnboardingSurvey } from './overlays';
import type { AccountUiInteraction } from './types';
import { foregroundPage } from './human';
import { generateBirthday, type BirthdayInfo, MONTH_NAMES } from './birthday';
import { readAuthFinalState, hasAuthenticatedWorkspace } from './authState';
import {
  abortable,
  abortableDelay,
  boundedDomRead,
  isDomReadTimeout,
  withinDeadline,
} from './cancellation';

const SIGNUP_URL =
  'https://www.capcut.com/signup?redirect_url=https%3A%2F%2Fwww.capcut.com%2Fmy-edit&lang=en';

/** Kết quả đăng ký */
export interface SignupResult {
  /** true nếu tài khoản đã được tạo mới trong lần chạy này */
  created: boolean;
  /** true nếu email đã tồn tại từ trước (không cần đăng ký) */
  alreadyExists: boolean;
  /** URL cuối cùng sau khi hoàn tất */
  finalUrl: string;
}

/** Những gì người gọi phải cấp cho luồng đăng ký. */
export interface SignupOptions {
  /** Kênh log — thay cho `console.log` của bản engine. */
  log: LogFn;
  /**
   * Nguồn mã xác minh 6 số, thay cho `pollOtpFromApi` của `mail-otp.ts`.
   * App nối hàm này vào `EmailPurchaseService.readOtp` (có vòng poll riêng).
   * Không truyền mà CapCut lại đòi OTP thì `getOtpCode` ném lỗi rõ ràng.
   */
  getOtp?: (email: string) => Promise<string>;
  ui: AccountUiInteraction;
  signal: AbortSignal;
  birthday?: BirthdayInfo;
}

function rethrowInterrupted(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
}


// -----------------------------------------------------------------------------
// TIỆN ÍCH
// -----------------------------------------------------------------------------

/** Điền input từng ký tự như người thật rồi xác minh giá trị đã vào đúng */
async function fillVerified(
  input: Locator,
  value: string,
  name: string,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal,
  stage: string,
  attempts = 3
): Promise<void> {
  await boundedDomRead(
    () => input.waitFor({ state: 'visible', timeout: 25000 }),
    `${stage}:input-visible`,
    25000,
    signal
  );

  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted();
    const matches = await foregroundPage(
      input.page(),
      { signal, stage: `${stage}:attempt-${i + 1}`, ui },
      async () => {
        await boundedDomRead(() => input.clear(), `${stage}:clear`, 5000, signal);
        await boundedDomRead(
          () => input.pressSequentially(value, { delay: 100 }),
          `${stage}:type`,
          Math.max(5000, value.length * 100 + 5000),
          signal
        );
        return boundedDomRead(() => input.inputValue(), `${stage}:validate`, 2000, signal);
      }
    );
    if (matches === value) {
      log(`   ✅ Đã điền ${name}`);
      return;
    }
    await abortableDelay(400, signal);
  }
  throw new Error(`Không điền được ${name} sau ${attempts} lần thử`);
}

/** Bấm trigger nhiều lần cho tới khi target xuất hiện (UI CapCut hay lag) */
async function clickUntilVisible(
  trigger: Locator,
  target: Locator,
  ui: AccountUiInteraction,
  signal: AbortSignal,
  attempts = 60
): Promise<void> {
  await boundedDomRead(
    () => trigger.waitFor({ state: 'visible', timeout: 25000 }),
    'signup:trigger-visible',
    25000,
    signal
  );
  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted();
    await foregroundPage(trigger.page(), { signal, stage: 'signup:open-email-form', ui }, async () => {
      await trigger.click({ timeout: 3000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    if (await target.isVisible({ timeout: 600 }).catch(() => false)) return;
  }
  throw new StepError(
    'Không mở được form email',
    await dump(trigger.page(), 'signup_form_email_khong_mo')
  );
}

/**
 * Lấy mã xác minh qua nguồn OTP do người gọi cấp.
 *
 * Bản engine thử `pollOtpFromApi` cho email @oldevlk.com rồi FALLBACK hỏi qua
 * terminal. App không có terminal: không có `getOtp` thì ném lỗi ngay thay vì
 * treo chờ stdin. Việc poll hộp thư là việc của người gọi
 * (`EmailPurchaseService`), ở đây chỉ kiểm mã có đúng 6 số.
 */
async function getOtpCode(
  email: string,
  log: LogFn,
  getOtp?: (email: string) => Promise<string>,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  if (!getOtp) {
    throw new Error(
      `Không có nguồn lấy OTP cho ${email}: app không có terminal để nhập tay, ` +
        'người gọi phải truyền `getOtp` (nối vào EmailPurchaseService).'
    );
  }

  try {
    const answer = (await getOtp(email)).trim();
    signal?.throwIfAborted();
    const code = answer.replace(/\D/g, '');
    if (code.length === 6) return code;
    throw new Error(`"${answer}" không phải mã 6 số`);
  } catch (e) {
    signal?.throwIfAborted();
    log(`   ⚠️ Lỗi lấy OTP từ API: ${(e as Error).message}`);
    throw new Error('Không nhận được mã xác minh hợp lệ');
  }
}

/** Điền mã OTP vào ô nhập (hỗ trợ cả 1 input dài và 6 input rời) */
async function fillOtp(
  page: Page,
  code: string,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<void> {
  // Kiểu 1: nhiều input rời, mỗi ô 1 chữ số
  const boxes = page.locator(
    'input[maxlength="1"], .verify-code-input input, div[class*="codeInput"] input'
  );
  const boxCount = await boxes.count().catch(() => 0);

  if (boxCount >= 6) {
    for (let i = 0; i < 6; i++) {
      signal.throwIfAborted();
      await foregroundPage(page, { signal, stage: 'signup:fill-otp-digit', ui }, () =>
        boxes.nth(i).fill(code[i])
      );
      await abortableDelay(140, signal);
    }
    log('   ✅ Đã điền mã OTP (6 ô rời)');
    return;
  }

  // Kiểu 2: một input duy nhất (hoặc .lv-input trên màn Confirm your Email)
  const single = page
    .locator(
      'input[maxlength="6"], input[name*="code" i], input[placeholder*="code" i], input[type="tel"], input[inputmode="numeric"], input.lv-input'
    )
    .first();

  if (await single.isVisible({ timeout: 8000 }).catch(() => false)) {
    await fillVerified(single, code, 'Mã xác minh', log, ui, signal, 'signup:fill-otp');
    return;
  }

  throw new Error('Không tìm thấy ô nhập mã xác minh trên trang');
}

/** Tick các checkbox điều khoản nếu chúng đang bắt buộc */
async function acceptTermsIfAny(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<void> {
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count().catch(() => 0);
  let acceptedCount = 0;

  for (let i = 0; i < n; i++) {
    signal.throwIfAborted();
    const box = boxes.nth(i);
    const visible = await box.isVisible({ timeout: 600 }).catch(() => false);
    if (!visible) continue;

    const alreadyChecked = await boundedDomRead(
      () => box.isChecked(),
      'signup:terms-check-state',
      1000,
      signal
    );

    if (alreadyChecked) continue;

    // Dùng click thay vì check() vì CapCut bọc checkbox trong label custom
    await foregroundPage(page, { signal, stage: 'signup:accept-terms', ui }, async () => {
      await box.click({ timeout: 2500, force: true }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });

    const isNowChecked = await boundedDomRead(
      () => box.isChecked(),
      'signup:terms-readback',
      1000,
      signal
    ).catch((error: unknown) => {
      rethrowInterrupted(error, signal);
      return false;
    });

    if (!isNowChecked) {
      throw new Error('SIGNUP_TERMS_NOT_ACCEPTED');
    }
    acceptedCount++;
  }
  if (acceptedCount > 0) log(`   → Đã xử lý ${acceptedCount} checkbox điều khoản`);
}

/** Đọc heading để biết CapCut đang ở nhánh nào */
async function readAuthHeading(page: Page, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const heading = page
    .getByRole('heading', {
      name: /Create an account|Tạo tài khoản|Welcome back|Chào mừng|Sign up|Đăng ký/i,
    })
    .first();

  const isVisible = await boundedDomRead(
    () => heading.isVisible({ timeout: 25000 }),
    'signup:read-heading-visible',
    25000,
    signal
  ).catch((error: unknown) => {
    rethrowInterrupted(error, signal);
    return false;
  });
  if (!isVisible) return '';
  signal?.throwIfAborted();
  const headingText = signal
    ? await boundedDomRead(() => heading.textContent(), 'signup:heading-text', 5000, signal)
    : await heading.textContent();
  return headingText?.replace(/\s+/g, ' ').trim() ?? '';
}

export function assertBirthdayMatches(
  actual: Pick<BirthdayInfo, 'year' | 'month' | 'day'>,
  intended: BirthdayInfo
): void {
  if (actual.year !== intended.year || actual.month !== intended.month || actual.day !== intended.day) {
    throw new Error('SIGNUP_BIRTHDAY_READBACK_MISMATCH');
  }
}

async function selectBirthdayDropdownOption(
  page: Page,
  selector: Locator,
  pattern: RegExp,
  ownerType: 'month' | 'day',
  targetDisplay: string,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  await foregroundPage(page, { signal, stage: `signup:birthday-${ownerType}-open`, ui }, () =>
    selector.click()
  );
  await abortableDelay(600, signal);

  // Scope to the active dropdown container
  const ariaControls = await boundedDomRead(
    () => selector.getAttribute('aria-controls'),
    `signup:birthday-${ownerType}-aria-controls`,
    2000,
    signal
  );

  let container: Locator;
  if (ariaControls) {
    const escapedId = ariaControls.replace(/["\\]/g, '\\$&');
    container = page.locator(`[id="${escapedId}"]`).first();
  } else {
    const triggerId = await boundedDomRead(
      () => selector.getAttribute('id'),
      `signup:birthday-${ownerType}-trigger-id`,
      2000,
      signal
    );
    if (!triggerId) {
      throw new Error(`SIGNUP_BIRTHDAY_${ownerType.toUpperCase()}_OWNER_MISSING: ${targetDisplay}`);
    }
    const escapedTriggerId = triggerId.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    const panels = page.locator(
      `[role="listbox"]:visible[aria-labelledby~="${escapedTriggerId}"], .lv-select-dropdown:visible[aria-labelledby~="${escapedTriggerId}"], .semi-select-option-list:visible[aria-labelledby~="${escapedTriggerId}"]`
    );
    const panelCount = await boundedDomRead(
      () => panels.count(),
      `signup:birthday-${ownerType}-panels-count`,
      2000,
      signal
    );
    if (panelCount === 0) {
      throw new Error(`SIGNUP_BIRTHDAY_${ownerType.toUpperCase()}_OWNER_MISSING: ${targetDisplay}`);
    }
    if (panelCount > 1) {
      throw new Error(`SIGNUP_BIRTHDAY_${ownerType.toUpperCase()}_OWNER_AMBIGUOUS: ${targetDisplay}`);
    }
    container = panels.first();
  }

  // Scoped options list inside the container
  const scopedOptions = container.locator('.lv-select-option, [role="option"]');
  const matchingOptions = typeof scopedOptions.filter === 'function'
    ? scopedOptions.filter({ hasText: pattern })
    : scopedOptions;

  const count = await boundedDomRead(
    () => matchingOptions.count(),
    `signup:birthday-${ownerType}-count`,
    3000,
    signal
  );

  signal.throwIfAborted();

  // Enforce visible uniqueness: inspect matching candidates for actual visibility
  const visibleMatches: Locator[] = [];
  for (let i = 0; i < count; i++) {
    signal.throwIfAborted();
    const candidate = matchingOptions.nth(i);
    const isVis = await boundedDomRead(
      () => candidate.isVisible({ timeout: 1000 }),
      `signup:birthday-${ownerType}-opt-vis-${i}`,
      1500,
      signal
    );
    if (isVis) {
      visibleMatches.push(candidate);
    }
  }

  if (visibleMatches.length === 0) {
    const errCode = ownerType === 'month' ? 'SIGNUP_BIRTHDAY_MONTH_OPTION_MISSING' : 'SIGNUP_BIRTHDAY_DAY_OPTION_MISSING';
    throw new Error(`${errCode}: ${targetDisplay}`);
  }

  if (visibleMatches.length > 1) {
    const errCode = ownerType === 'month' ? 'SIGNUP_BIRTHDAY_MONTH_OPTION_DUPLICATE' : 'SIGNUP_BIRTHDAY_DAY_OPTION_DUPLICATE';
    throw new Error(`${errCode}: ${targetDisplay}`);
  }

  const chosenOpt = visibleMatches[0];
  await foregroundPage(page, { signal, stage: `signup:birthday-${ownerType}-select`, ui }, () =>
    chosenOpt.click()
  );
  await abortableDelay(400, signal);
  log(`   → Đã chọn ${ownerType === 'month' ? 'Month' : 'Day'}: ${targetDisplay}`);
}

/** Xử lý màn hình "When's your birthday?" nếu CapCut yêu cầu */
async function handleBirthdayIfPresent(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal,
  birthday?: BirthdayInfo
): Promise<BirthdayInfo | undefined> {
  const isBirthday =
    (await boundedDomRead(
      () => page.getByRole('heading', { name: /birthday|ngày sinh/i }).isVisible({ timeout: 12000 }),
      'signup:birthday-heading-visible',
      14000,
      signal
    ).catch((err: unknown) => {
      signal.throwIfAborted();
      if (isDomReadTimeout(err)) throw err;
      return false;
    })) ||
    (await boundedDomRead(
      () => page.locator('.gate_birthday-picker-input, input[placeholder="Year"], .gate_birthday-picker-selector').first().isVisible({ timeout: 4000 }),
      'signup:birthday-input-visible',
      6000,
      signal
    ).catch((err: unknown) => {
      signal.throwIfAborted();
      if (isDomReadTimeout(err)) throw err;
      return false;
    }));

  if (!isBirthday) {
    return birthday;
  }

  // Lazy generate only after birthday presence is confirmed
  const resolvedBirthday: BirthdayInfo = birthday ?? generateBirthday({ startYear: 1990, endYear: 2004 });

  if (birthday) {
    log(
      `   🎂 Phát hiện màn hình "When's your birthday?" -> dùng birthday được chỉ định (${resolvedBirthday.year}-${resolvedBirthday.month}-${resolvedBirthday.day})...`
    );
  } else {
    log(
      `   🎂 Phát hiện màn hình "When's your birthday?" -> đang điền thông tin ngẫu nhiên (${resolvedBirthday.year}-${resolvedBirthday.month}-${resolvedBirthday.day})...`
    );
  }

  // 1. Điền Year
  const yearInput = page
    .locator('input[placeholder="Year"], .gate_birthday-picker-input')
    .first();
  const isYearVisible = await boundedDomRead(
    () => yearInput.isVisible({ timeout: 5000 }),
    'signup:birthday-year-visible',
    5000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });

  if (isYearVisible) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-year', ui }, async () => {
      await yearInput.click();
      await yearInput.fill(String(resolvedBirthday.year));
    });
    await abortableDelay(400, signal);
    log(`   → Đã điền Year: ${resolvedBirthday.year}`);
  }

  // 2. Chọn Month
  const monthSelector = page.locator('.gate_birthday-picker-selector').first();
  const isMonthVisible = await boundedDomRead(
    () => monthSelector.isVisible({ timeout: 3000 }),
    'signup:birthday-month-visible',
    3000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });

  if (isMonthVisible) {
    const monthPattern = new RegExp(`^0?${resolvedBirthday.month}$|^${resolvedBirthday.monthName}$`, 'i');
    await selectBirthdayDropdownOption(
      page,
      monthSelector,
      monthPattern,
      'month',
      resolvedBirthday.monthName,
      log,
      ui,
      signal
    );
  }

  // 3. Chọn Day
  const daySelector = page.locator('.gate_birthday-picker-selector').last();
  const isDayVisible = await boundedDomRead(
    () => daySelector.isVisible({ timeout: 3000 }),
    'signup:birthday-day-visible',
    3000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });

  if (isDayVisible) {
    const dayPattern = new RegExp(`^0?${resolvedBirthday.day}$`);
    await selectBirthdayDropdownOption(
      page,
      daySelector,
      dayPattern,
      'day',
      String(resolvedBirthday.day),
      log,
      ui,
      signal
    );
  }

  // 4. Đọc lại để kiểm chứng khớp ngày trước khi bấm Continue
  const actualYearStr = await boundedDomRead(
    () => yearInput.inputValue(),
    'signup:birthday-readback-year',
    3000,
    signal
  );
  const actualYear = parseInt(actualYearStr, 10);

  const actualMonthText = (
    await boundedDomRead(
      () => monthSelector.textContent(),
      'signup:birthday-readback-month',
      3000,
      signal
    )
  )?.trim() ?? '';
  let actualMonth = parseInt(actualMonthText, 10);
  if (isNaN(actualMonth)) {
    const foundIdx = MONTH_NAMES.findIndex(
      m => m.toLowerCase() === actualMonthText.toLowerCase()
    );
    if (foundIdx !== -1) actualMonth = foundIdx + 1;
  }

  const actualDayText = (
    await boundedDomRead(
      () => daySelector.textContent(),
      'signup:birthday-readback-day',
      3000,
      signal
    )
  )?.trim() ?? '';
  const actualDay = parseInt(actualDayText, 10);

  assertBirthdayMatches(
    { year: actualYear, month: actualMonth, day: actualDay },
    resolvedBirthday
  );

  // 5. Bấm Continue
  const continueBtn = page
    .locator(
      '.lv_sign_in_panel_wide-birthday-next, button:has-text("Continue"), div[role="button"]:has-text("Continue")'
    )
    .first();
  const isContinueVisible = await boundedDomRead(
    () => continueBtn.isVisible({ timeout: 5000 }),
    'signup:birthday-continue-visible',
    5000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });

  if (isContinueVisible) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-continue', ui }, () =>
      continueBtn.click({ timeout: 10000 })
    );
    log('   → Đã bấm Continue ở màn hình Birthday');
    await abortableDelay(5000, signal);
  }

  return resolvedBirthday;
}

/** Kiểm tra đã vào được app chưa */
export async function isInsideApp(page: Page, signal?: AbortSignal): Promise<boolean> {
  const effectiveSignal = signal ?? new AbortController().signal;
  effectiveSignal.throwIfAborted();
  try {
    const state = await readAuthFinalState(page, effectiveSignal);
    return hasAuthenticatedWorkspace(state);
  } catch (error) {
    rethrowInterrupted(error, effectiveSignal);
    return false;
  }
}

/** Bỏ qua khảo sát / modal onboarding / màn Get started with space */
async function dismissOnboarding(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<void> {
  // Màn hình "Get started with space" -> Bấm "Open CapCut"
  const openCapcutBtn = page
    .locator('.lv-create-teamspace-confirm, button:has-text("Open CapCut")')
    .first();
  const openCapcutVisible = await boundedDomRead(
    () => openCapcutBtn.isVisible({ timeout: 5000 }),
    'signup:open-capcut-visible',
    7000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });
  if (openCapcutVisible) {
    await foregroundPage(page, { signal, stage: 'signup:open-capcut-space', ui }, async () => {
      await openCapcutBtn.click({ timeout: 8000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    log('   → Đã bấm "Open CapCut"');
    await abortableDelay(4000, signal);
  }

  // Khảo sát onboarding 3 bước: bấm Skip rồi ĐỌC LẠI DOM xem mask đã tắt chưa.
  // Bản cũ bấm một lần, nuốt lỗi, in "Đã bấm Skip khảo sát" vô điều kiện — nên
  // modal phủ trang suốt phiên mà không ai biết (xem `onboarding.ts`).
  await skipOnboardingSurvey(page, log, ui, signal);
  await dismissOperationFeatureModal(page, log, ui, signal);

  const close = page
    .locator('button[aria-label="Close"], div[aria-label="Close"], .semi-modal-close')
    .first();
  const closeVisible = await boundedDomRead(
    () => close.isVisible({ timeout: 3000 }),
    'signup:close-onboarding-visible',
    5000,
    signal
  ).catch((err: unknown) => {
    signal.throwIfAborted();
    if (isDomReadTimeout(err)) throw err;
    return false;
  });
  if (closeVisible) {
    await foregroundPage(page, { signal, stage: 'signup:close-onboarding-modal', ui }, async () => {
      await close.click({ timeout: 5000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    await abortableDelay(1500, signal);
  }
}

// -----------------------------------------------------------------------------
// LUỒNG CHÍNH
// -----------------------------------------------------------------------------

/**
 * Đăng ký tài khoản CapCut mới bằng email + password.
 *
 * @returns `alreadyExists: true` nếu email đã tồn tại (khi đó nên dùng luồng
 *          đăng nhập thay vì đăng ký) — không coi đây là lỗi.
 */
export async function signupCapcut(
  page: Page,
  _context: BrowserContext,
  creds: CapcutCredentials,
  opts: SignupOptions
): Promise<SignupResult> {
  const { log, getOtp } = opts;
  if (!opts.ui) throw new Error('UI_INTERACTION_REQUIRED');
  if (!opts.signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  const { signal, ui } = opts;
  signal.throwIfAborted();

  log('\n============================================================');
  log('📝 ĐĂNG KÝ TÀI KHOẢN CAPCUT WEB');
  log('============================================================');

  try {
    await withinDeadline(
      page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }),
      90000,
      signal
    );
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  signal.throwIfAborted();
  await abortableDelay(4000, signal);

  // Profile đã có session sẵn -> không cần đăng ký
  if (await isInsideApp(page, signal)) {
    signal.throwIfAborted();
    log('   ℹ️  Profile đã đăng nhập sẵn, không cần đăng ký');
    return { created: false, alreadyExists: true, finalUrl: page.url() };
  }

  // --- Bước 1: mở form email ---
  const emailInput = page.locator('input[type="email"]');
  if (!(await emailInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    const continueEmail = page.getByText(
      /^(Continue with email|Tiếp tục bằng email|Sign up with email)$/
    );
    await clickUntilVisible(continueEmail, emailInput, ui, signal);
  }
  log('   → Đã mở form email');

  // --- Bước 2: điền email -> Continue ---
  await fillVerified(emailInput, creds.email, 'Email', log, ui, signal, 'signup:fill-email');

  const continueBtn = page.getByRole('button', { name: /^(Continue|Tiếp tục|Next)$/ }).first();
  await boundedDomRead(
    () => continueBtn.waitFor({ state: 'visible', timeout: 25000 }),
    'signup:continue-email-visible',
    25000,
    signal
  );
  await foregroundPage(page, { signal, stage: 'signup:continue-email', ui }, () =>
    continueBtn.click({ timeout: 25000 })
  );
  log('   → Đã bấm Continue');
  await abortableDelay(3000, signal);

  // --- Bước 3: xác định nhánh ---
  const heading = await readAuthHeading(page, signal);
  log(`   → Heading: "${heading || '(không đọc được)'}"`);

  if (/Welcome back|Chào mừng/i.test(heading)) {
    log(`   ℹ️  Email ${creds.email} ĐÃ TỒN TẠI -> dùng script đăng nhập (npm run login)`);
    return { created: false, alreadyExists: true, finalUrl: page.url() };
  }

  // --- Bước 4: điền password ---
  const pwInputs = page.locator('input[type="password"]');
  const pwCount = await pwInputs.count();
  if (pwCount === 0) {
    throw new StepError(
      `Không tìm thấy ô nhập password (heading hiện tại: "${heading}")`,
      await dump(page, 'signup_khong_thay_o_password')
    );
  }

  await fillVerified(pwInputs.first(), creds.password, 'Password', log, ui, signal, 'signup:fill-password');
  if (pwCount > 1) {
    await fillVerified(
      pwInputs.nth(1),
      creds.password,
      'Xác nhận password',
      log,
      ui,
      signal,
      'signup:fill-password-confirmation'
    );
  }

  await acceptTermsIfAny(page, log, ui, signal);

  const submitBtn = page
    .getByRole('button', { name: /^(Sign up|Continue|Create account|Đăng ký|Tiếp tục|Next)$/ })
    .first();
  await boundedDomRead(
    () => submitBtn.waitFor({ state: 'visible', timeout: 25000 }),
    'signup:submit-visible',
    25000,
    signal
  );
  await foregroundPage(page, { signal, stage: 'signup:submit-account', ui }, () =>
    submitBtn.click({ timeout: 25000 })
  );
  log('   → Đã gửi thông tin đăng ký');
  await abortableDelay(5000, signal);

  // --- Bước 5: màn hình "When's your birthday?" (nếu có) ---
  await handleBirthdayIfPresent(page, log, ui, signal, opts.birthday);

  // --- Bước 6: màn hình "Confirm your Email" (OTP) ---
  const isConfirmEmail =
    (await page.getByRole('heading', { name: /Confirm your Email|xác minh/i }).isVisible({ timeout: 10000 }).catch(() => false)) ||
    (await page.locator('input[maxlength="6"], input[maxlength="1"], input[name*="code" i]').first().isVisible({ timeout: 3000 }).catch(() => false));

  if (isConfirmEmail) {
    log('   📩 Phát hiện yêu cầu OTP -> bắt đầu lấy mã xác minh...');
    const code = await getOtpCode(creds.email, log, getOtp, signal);
    await fillOtp(page, code, log, ui, signal);
    await abortableDelay(1000, signal);

    // Bấm nút xác nhận / Continue / Confirm sau khi điền mã nếu có
    const verifyBtn = page
      .getByRole('button', {
        name: /^(Verify|Confirm|Continue|Next|Xác nhận|Tiếp tục|Confirm your Email)$/i,
      })
      .first();
    if (await verifyBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await foregroundPage(page, { signal, stage: 'signup:verify-otp', ui }, async () => {
        await verifyBtn.click({ timeout: 15000 }).catch((error: unknown) => {
          rethrowInterrupted(error, signal);
        });
      });
    }
    log('   → Đã gửi mã xác minh, chờ chuyển trang...');
    await abortableDelay(6000, signal);
  } else {
    log('   ℹ️  CapCut không yêu cầu mã xác minh ở bước này');
  }

  // --- Bước 7: xử lý "Open CapCut" & bỏ qua khảo sát ---
  await dismissOnboarding(page, log, ui, signal);

  try {
    await abortable(
      page.waitForURL((u) => !/\/(login|signup)/.test(u.toString()), { timeout: 90000 }),
      signal
    ).catch((error: unknown) => {
      rethrowInterrupted(error, signal);
    });
  } catch (error) {
    rethrowInterrupted(error, signal);
  }
  signal.throwIfAborted();
  await abortableDelay(5000, signal);
  await dismissOnboarding(page, log, ui, signal);

  let finalState = await readAuthFinalState(page, signal);
  log(
    `   🔍 Trạng thái trang sau đăng ký: kind=${finalState.kind}, path=${finalState.path}, workspace=${finalState.workspaceMarker}, authForm=${finalState.authFormVisible}, landing=${finalState.publicLandingVisible}`
  );

  if (!hasAuthenticatedWorkspace(finalState)) {
    log('   ℹ️ Chưa thấy workspace marker, thử chuyển trang tới /my-edit...');
    try {
      await abortable(
        page.goto('https://www.capcut.com/my-edit?start_tab=video', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        }),
        signal
      ).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
        log(`   ⚠️ Lỗi fallback goto /my-edit: ${(error as Error)?.message || String(error)}`);
      });
    } catch (error) {
      rethrowInterrupted(error, signal);
      log(`   ⚠️ Lỗi fallback goto /my-edit: ${(error as Error)?.message || String(error)}`);
    }
    signal.throwIfAborted();
    await abortableDelay(5000, signal);
    await dismissOnboarding(page, log, ui, signal);
    finalState = await readAuthFinalState(page, signal);
    log(
      `   🔍 Trạng thái trang sau fallback goto: kind=${finalState.kind}, path=${finalState.path}, workspace=${finalState.workspaceMarker}, authForm=${finalState.authFormVisible}, landing=${finalState.publicLandingVisible}`
    );
  }

  if (!hasAuthenticatedWorkspace(finalState)) {
    // Đăng ký hỏng ở bước cuối là mất một hộp thư đã trả tiền — bắt buộc phải có
    // hiện trường, không thì lần sau vẫn không biết vì sao.
    const shot = await dump(page, 'dang_ky_chua_hoan_tat');
    if (finalState.kind === 'public-landing') {
      throw new StepError(
        `Đăng ký chưa hoàn tất [AUTH_FINAL_PUBLIC_LANDING]: kết thúc ở public-landing (path: ${finalState.path}), chưa vào workspace.`,
        shot
      );
    }
    if (finalState.kind === 'auth-form') {
      throw new StepError(
        `Đăng ký chưa hoàn tất [AUTH_FINAL_FORM]: form xác thực vẫn mở (path: ${finalState.path}). Có thể mã sai hoặc email bị chặn.`,
        shot
      );
    }
    throw new StepError(
      `Đăng ký chưa hoàn tất [AUTH_FINAL_${finalState.kind.toUpperCase()}]: kết thúc ở ${finalState.kind} (path: ${finalState.path}), chưa vào workspace.`,
      shot
    );
  }

  log('   ✅ ĐĂNG KÝ THÀNH CÔNG\n');
  return { created: true, alreadyExists: false, finalUrl: page.url() };
}
