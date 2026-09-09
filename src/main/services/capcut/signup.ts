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
import { skipOnboardingSurvey } from './overlays';
import type { AccountUiInteraction } from './types';
import { foregroundPage } from './human';
import { abortableDelay, boundedDomRead, isDomReadTimeout } from './cancellation';

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
}

function rethrowInterrupted(error: unknown, signal: AbortSignal): void {
  signal.throwIfAborted();
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
  await input.waitFor({ state: 'visible', timeout: 25000 });

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
  await trigger.waitFor({ state: 'visible', timeout: 25000 });
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
  getOtp?: (email: string) => Promise<string>
): Promise<string> {
  if (!getOtp) {
    throw new Error(
      `Không có nguồn lấy OTP cho ${email}: app không có terminal để nhập tay, ` +
        'người gọi phải truyền `getOtp` (nối vào EmailPurchaseService).'
    );
  }

  try {
    const answer = (await getOtp(email)).trim();
    const code = answer.replace(/\D/g, '');
    if (code.length === 6) return code;
    throw new Error(`"${answer}" không phải mã 6 số`);
  } catch (e) {
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
      await page.waitForTimeout(140);
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
  const boxes = page.locator('input[type="checkbox"]:not(:checked)');
  const n = await boxes.count().catch(() => 0);

  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (!(await box.isVisible({ timeout: 600 }).catch(() => false))) continue;
    // Dùng click thay vì check() vì CapCut bọc checkbox trong label custom
    await foregroundPage(page, { signal, stage: 'signup:accept-terms', ui }, async () => {
      await box.click({ timeout: 2500, force: true }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
  }
  if (n > 0) log(`   → Đã xử lý ${n} checkbox điều khoản`);
}

/** Đọc heading để biết CapCut đang ở nhánh nào */
async function readAuthHeading(page: Page): Promise<string> {
  const heading = page
    .getByRole('heading', {
      name: /Create an account|Tạo tài khoản|Welcome back|Chào mừng|Sign up|Đăng ký/i,
    })
    .first();

  if (!(await heading.isVisible({ timeout: 25000 }).catch(() => false))) return '';
  return (await heading.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Xử lý màn hình "When's your birthday?" nếu CapCut yêu cầu */
async function handleBirthdayIfPresent(
  page: Page,
  log: LogFn,
  ui: AccountUiInteraction,
  signal: AbortSignal
): Promise<void> {
  const isBirthday =
    (await page.getByRole('heading', { name: /birthday/i }).isVisible({ timeout: 12000 }).catch(() => false)) ||
    (await page.locator('.gate_birthday-picker-input, input[placeholder="Year"], .gate_birthday-picker-selector').first().isVisible({ timeout: 4000 }).catch(() => false));

  if (!isBirthday) {
    return;
  }

  log('   🎂 Phát hiện màn hình "When\'s your birthday?" -> đang điền thông tin...');

  // 1. Điền Year (1998)
  const yearInput = page
    .locator('input[placeholder="Year"], .gate_birthday-picker-input')
    .first();
  if (await yearInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-year', ui }, async () => {
      await yearInput.click();
      await yearInput.fill('1998');
    });
    await page.waitForTimeout(400);
    log('   → Đã điền Year: 1998');
  }

  // 2. Chọn Month
  const monthSelector = page.locator('.gate_birthday-picker-selector').first();
  if (await monthSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-month-open', ui }, () =>
      monthSelector.click()
    );
    await page.waitForTimeout(600);
    const monthOpt = page.locator('.lv-select-option, [role="option"]').first();
    if (await monthOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
      await foregroundPage(page, { signal, stage: 'signup:birthday-month-select', ui }, () =>
        monthOpt.click()
      );
      await page.waitForTimeout(400);
      log('   → Đã chọn Month');
    }
  }

  // 3. Chọn Day (ngày 15)
  const daySelector = page.locator('.gate_birthday-picker-selector').last();
  if (await daySelector.isVisible({ timeout: 3000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-day-open', ui }, () =>
      daySelector.click()
    );
    await page.waitForTimeout(600);
    const dayOpt = page.locator('.lv-select-option, [role="option"]').nth(14);
    if (await dayOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
      await foregroundPage(page, { signal, stage: 'signup:birthday-day-select', ui }, () =>
        dayOpt.click()
      );
    } else {
      await foregroundPage(page, { signal, stage: 'signup:birthday-day-select-fallback', ui }, async () => {
        await page.locator('.lv-select-option, [role="option"]').first().click().catch((error: unknown) => {
          rethrowInterrupted(error, signal);
        });
      });
    }
    await page.waitForTimeout(400);
    log('   → Đã chọn Day');
  }

  // 4. Bấm Continue
  const continueBtn = page
    .locator(
      '.lv_sign_in_panel_wide-birthday-next, button:has-text("Continue"), div[role="button"]:has-text("Continue")'
    )
    .first();
  if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:birthday-continue', ui }, () =>
      continueBtn.click({ timeout: 10000 })
    );
    log('   → Đã bấm Continue ở màn hình Birthday');
    await page.waitForTimeout(5000);
  }
}

/** Kiểm tra đã vào được app chưa */
export async function isInsideApp(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signup')) return false;
  if (url.includes('/my-edit') || url.includes('/ai-design') || url.includes('/ai-creator')) return true;

  const btn = page
    .locator('button:has-text("Free credits"), .credit-section, button[class*="credit"], [class*="avatar"]')
    .first();
  return btn.isVisible({ timeout: 10000 }).catch(() => false);
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
  if (await openCapcutBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:open-capcut-space', ui }, async () => {
      await openCapcutBtn.click({ timeout: 8000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    log('   → Đã bấm "Open CapCut"');
    await page.waitForTimeout(4000);
  }

  // Khảo sát onboarding 3 bước: bấm Skip rồi ĐỌC LẠI DOM xem mask đã tắt chưa.
  // Bản cũ bấm một lần, nuốt lỗi, in "Đã bấm Skip khảo sát" vô điều kiện — nên
  // modal phủ trang suốt phiên mà không ai biết (xem `onboarding.ts`).
  await skipOnboardingSurvey(page, log, ui, signal);

  const close = page
    .locator('button[aria-label="Close"], div[aria-label="Close"], .semi-modal-close')
    .first();
  if (await close.isVisible({ timeout: 3000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'signup:close-onboarding-modal', ui }, async () => {
      await close.click({ timeout: 5000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    await page.waitForTimeout(1500);
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

  await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);

  // Profile đã có session sẵn -> không cần đăng ký
  if (await isInsideApp(page)) {
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
  await continueBtn.waitFor({ state: 'visible', timeout: 25000 });
  await foregroundPage(page, { signal, stage: 'signup:continue-email', ui }, () =>
    continueBtn.click({ timeout: 25000 })
  );
  log('   → Đã bấm Continue');
  await page.waitForTimeout(3000);

  // --- Bước 3: xác định nhánh ---
  const heading = await readAuthHeading(page);
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
  await submitBtn.waitFor({ state: 'visible', timeout: 25000 });
  await foregroundPage(page, { signal, stage: 'signup:submit-account', ui }, () =>
    submitBtn.click({ timeout: 25000 })
  );
  log('   → Đã gửi thông tin đăng ký');
  await page.waitForTimeout(5000);

  // --- Bước 5: màn hình "When's your birthday?" (nếu có) ---
  await handleBirthdayIfPresent(page, log, ui, signal);

  // --- Bước 6: màn hình "Confirm your Email" (OTP) ---
  const isConfirmEmail =
    (await page.getByRole('heading', { name: /Confirm your Email|xác minh/i }).isVisible({ timeout: 10000 }).catch(() => false)) ||
    (await page.locator('input[maxlength="6"], input[maxlength="1"], input[name*="code" i]').first().isVisible({ timeout: 3000 }).catch(() => false));

  if (isConfirmEmail) {
    log('   📩 Phát hiện yêu cầu OTP -> bắt đầu lấy mã xác minh...');
    const code = await getOtpCode(creds.email, log, getOtp);
    await fillOtp(page, code, log, ui, signal);
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(6000);
  } else {
    log('   ℹ️  CapCut không yêu cầu mã xác minh ở bước này');
  }

  // --- Bước 7: xử lý "Open CapCut" & bỏ qua khảo sát ---
  await dismissOnboarding(page, log, ui, signal);

  await page
    .waitForURL((u) => !/\/(login|signup)/.test(u.toString()), { timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(5000);
  await dismissOnboarding(page, log, ui, signal);

  if (!(await isInsideApp(page))) {
    await page
      .goto('https://www.capcut.com/my-edit?start_tab=video', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch(() => {});
    await page.waitForTimeout(5000);
    await dismissOnboarding(page, log, ui, signal);
  }

  if (!(await isInsideApp(page))) {
    // Đăng ký hỏng ở bước cuối là mất một hộp thư đã trả tiền — bắt buộc phải có
    // hiện trường, không thì lần sau vẫn không biết vì sao.
    throw new StepError(
      `Đăng ký chưa hoàn tất (URL: ${page.url()}). Có thể mã sai, bị captcha, hoặc email bị chặn.`,
      await dump(page, 'dang_ky_chua_hoan_tat')
    );
  }

  log('   ✅ ĐĂNG KÝ THÀNH CÔNG\n');
  return { created: true, alreadyExists: false, finalUrl: page.url() };
}
