/**
 * =============================================================================
 * ĐĂNG NHẬP CAPCUT WEB BẰNG EMAIL + PASSWORD
 * =============================================================================
 * Luồng thực tế của CapCut Web:
 *   1. Mở /login?redirect_url=...my-edit
 *   2. Click "Continue with email" -> hiện input email
 *   3. Điền email -> click "Continue"
 *   4. CapCut kiểm tra email:
 *        - Đã đăng ký  -> heading "Welcome back"     -> điền password -> Sign in
 *        - Chưa đăng ký -> heading "Create an account" -> cần OTP (không hỗ trợ
 *          trong luồng đăng nhập, sẽ báo lỗi rõ ràng để người dùng biết)
 *   5. Sau khi vào được /my-edit có thể xuất hiện màn hình khảo sát -> bấm Skip
 * =============================================================================
 *
 * GHI CHÚ KHI PORT VÀO APP:
 *   - `Credentials` của engine đến từ `src/config.ts` (đọc `.env` cho CLI).
 *     File đó KHÔNG được port, nên kiểu được khai tại chỗ dưới dạng
 *     `CapcutCredentials` và `signup.ts`/`auth.ts` dùng lại từ đây.
 *   - Không còn `console.log`: mọi câu log giữ nguyên nguyên văn nhưng đi qua
 *     `log()` được inject để `LogBus` gắn `accountId` (AGENTS.md §16).
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

/**
 * Thông tin đăng nhập tối thiểu mà engine cần. Bản gốc là `Credentials` trong
 * `src/config.ts` (CLI đọc `.env`); trong app nguồn là bảng `accounts` của
 * SQLite nên engine chỉ nhận đúng hai trường này, không đọc `.env`.
 */
export interface CapcutCredentials {
  email: string;
  password: string;
}

/** Kênh log được inject — engine không được `console.log`. */
export type LogFn = (msg: string) => void;

const LOGIN_URL =
  'https://www.capcut.com/login?redirect_url=https%3A%2F%2Fwww.capcut.com%2Fmy-edit&lang=en';

/** Điền input từng ký tự (giống người thật) và xác minh giá trị đã vào đúng */
async function fillVerified(
  input: Locator,
  value: string,
  name: string,
  log: LogFn,
  attempts = 3
): Promise<void> {
  await input.waitFor({ state: 'visible', timeout: 20000 });

  for (let i = 0; i < attempts; i++) {
    await input.clear();
    await input.pressSequentially(value, { delay: 110 });
    if ((await input.inputValue()) === value) {
      log(`   ✅ Đã điền ${name}`);
      return;
    }
    await input.page().waitForTimeout(500);
  }
  throw new Error(`Không điền được ${name} sau ${attempts} lần thử`);
}

/** Bấm trigger nhiều lần cho tới khi target hiện ra (UI CapCut hay lag khi load) */
async function clickUntilVisible(trigger: Locator, target: Locator, attempts = 60): Promise<void> {
  await trigger.waitFor({ state: 'visible', timeout: 20000 });

  for (let i = 0; i < attempts; i++) {
    await trigger.click({ timeout: 3000 }).catch(() => {});
    if (await target.isVisible({ timeout: 600 }).catch(() => false)) return;
  }
  throw new Error('Không mở được form đăng nhập bằng email');
}

/** Kiểm tra đã đăng nhập chưa (đang ở trong app và không còn ở trang login/signup) */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signup')) return false;
  if (!url.includes('capcut.com')) return false;

  // Nếu URL đang ở trong app (my-edit, ai-design, ai-creator, workspace, tools) -> đã đăng nhập
  if (
    url.includes('/my-edit') ||
    url.includes('/ai-design') ||
    url.includes('/ai-creator') ||
    url.includes('/workspace') ||
    url.includes('/tools')
  ) {
    return true;
  }

  // Có nút Free credits, avatar, credit-section
  const marker = page
    .locator(
      'button:has-text("Free credits"), .credit-section, button[class*="credit"], [class*="avatar"], [class*="userProfile"], [class*="account"]'
    )
    .first();
  return marker.isVisible({ timeout: 4000 }).catch(() => false);
}

/**
 * Đăng nhập CapCut. Idempotent: nếu profile đã có session sẵn thì bỏ qua.
 * @throws nếu email chưa được đăng ký (cần OTP) hoặc sai mật khẩu
 */
export async function loginCapcut(
  page: Page,
  _context: BrowserContext,
  creds: CapcutCredentials,
  log: LogFn
): Promise<void> {
  log('\n============================================================');
  log('🔐 ĐĂNG NHẬP CAPCUT WEB');
  log('============================================================');

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);

  // Trường hợp profile đã có cookie session -> CapCut tự redirect vào my-edit
  if (await isLoggedIn(page)) {
    log('   ✅ Profile đã có session sẵn, không cần đăng nhập lại');
    return;
  }

  // --- Bước 1: mở form email ---
  const continueEmail = page.getByText(/^(Continue with email|Tiếp tục bằng email)$/);
  const inputEmail = page.locator('input[type="email"]');
  await clickUntilVisible(continueEmail, inputEmail);
  log('   → Đã mở form email');

  // --- Bước 2: điền email và Continue ---
  await fillVerified(inputEmail, creds.email, 'Email', log);

  const continueBtn = page.getByRole('button', { name: /^(Continue|Tiếp tục)$/ });
  await continueBtn.waitFor({ state: 'visible', timeout: 20000 });
  await continueBtn.click({ timeout: 20000 });
  log('   → Đã bấm Continue');

  // --- Bước 3: xác định trạng thái tài khoản ---
  const heading = page.getByRole('heading', {
    level: 2,
    name: /^(Create an account|Tạo tài khoản|Welcome back|Chào mừng bạn trở lại)$/,
  });
  await heading.waitFor({ state: 'visible', timeout: 25000 });
  const headingText = (await heading.textContent())?.replace(/\s+/g, ' ').trim() ?? '';

  if (/Create an account|Tạo tài khoản/.test(headingText)) {
    throw new Error(
      `Email ${creds.email} CHƯA được đăng ký trên CapCut. ` +
        'Luồng này chỉ hỗ trợ đăng nhập tài khoản có sẵn (đăng ký mới cần OTP email).'
    );
  }
  log(`   → Tài khoản đã tồn tại ("${headingText}"), tiến hành điền mật khẩu`);

  // --- Bước 4: điền password và đăng nhập ---
  const inputPassword = page.locator('input[type="password"]').first();
  await fillVerified(inputPassword, creds.password, 'Password', log);

  const signInBtn = page
    .getByRole('button', { name: /^(Sign in|Log in|Continue|Đăng nhập|Tiếp tục)$/ })
    .first();
  await signInBtn.waitFor({ state: 'visible', timeout: 20000 });
  await signInBtn.click({ timeout: 20000 });
  log('   → Đã bấm đăng nhập, chờ chuyển trang...');

  // --- Bước 5: chờ vào app ---
  await page
    .waitForURL((u) => !u.toString().includes('/login'), { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(5000);

  // Bỏ qua màn hình khảo sát nếu có
  const skipBtn = page
    .locator('.skip-mrkR37, button:has-text("Skip"), div[role="button"]:text-is("Skip")')
    .first();
  if (await skipBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await skipBtn.click({ timeout: 8000 }).catch(() => {});
    log('   → Đã bấm Skip khảo sát');
    await page.waitForTimeout(3000);
  }

  // Đóng modal quảng cáo / onboarding nếu che UI
  const closeModal = page
    .locator('button[aria-label="Close"], div[aria-label="Close"], .semi-modal-close')
    .first();
  if (await closeModal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeModal.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  if (!(await isLoggedIn(page))) {
    // Cố gắng điều hướng thủ công một lần nữa trước khi báo lỗi
    await page
      .goto('https://www.capcut.com/my-edit?start_tab=video', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch(() => {});
    await page.waitForTimeout(5000);
  }

  if (!(await isLoggedIn(page))) {
    throw new Error(
      `Đăng nhập thất bại (URL hiện tại: ${page.url()}). Có thể sai mật khẩu hoặc bị chặn captcha.`
    );
  }

  log('   ✅ ĐĂNG NHẬP THÀNH CÔNG\n');
}
