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

import { dump, StepError } from './diag';
import { dismissOperationFeatureModal, skipOnboardingSurvey } from './overlays';
import type { AccountUiInteraction } from './types';
import { foregroundPage } from './human';
import {
  abortable,
  abortableDelay,
  boundedDomRead,
  isDomReadTimeout,
  withinDeadline,
} from './cancellation';
import { readAuthFinalState, hasAuthenticatedWorkspace } from './authState';

/**
 * Thông tin đăng nhập tối thiểu mà engine cần. Bản gốc là `Credentials` trong
 * `src/config.ts` (CLI đọc `.env`); trong app nguồn là bảng `accounts` của
 * SQLite nên engine chỉ nhận đúng hai trường này, không đọc `.env`.
 */
export interface CapcutCredentials {
  email: string;
  password: string;
}

export interface LoginOptions {
  ui: AccountUiInteraction;
  signal: AbortSignal;
}

function rethrowInterrupted(error: unknown, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
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
  ui: AccountUiInteraction,
  signal: AbortSignal,
  stage: string,
  attempts = 3
): Promise<void> {
  await boundedDomRead(
    () => input.waitFor({ state: 'visible', timeout: 20000 }),
    `${stage}:input-visible`,
    20000,
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
          () => input.pressSequentially(value, { delay: 110 }),
          `${stage}:type`,
          Math.max(5000, value.length * 110 + 5000),
          signal
        );
        return boundedDomRead(() => input.inputValue(), `${stage}:validate`, 2000, signal);
      }
    );
    if (matches === value) {
      log(`   ✅ Đã điền ${name}`);
      return;
    }
    await abortableDelay(500, signal);
  }
  throw new Error(`Không điền được ${name} sau ${attempts} lần thử`);
}

/** Bấm trigger nhiều lần cho tới khi target hiện ra (UI CapCut hay lag khi load) */
async function clickUntilVisible(
  trigger: Locator,
  target: Locator,
  ui: AccountUiInteraction,
  signal: AbortSignal,
  attempts = 60
): Promise<void> {
  await boundedDomRead(
    () => trigger.waitFor({ state: 'visible', timeout: 20000 }),
    'login:trigger-visible',
    20000,
    signal
  );

  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted();
    await foregroundPage(trigger.page(), { signal, stage: 'login:open-email-form', ui }, async () => {
      await trigger.click({ timeout: 3000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    if (await target.isVisible({ timeout: 600 }).catch(() => false)) return;
  }
  // Không có hiện trường thì lỗi này chỉ là một câu chữ: CHANGELOG đã ghi một
  // account chết vì `waitFor: Timeout 25000ms` mà không ai điều tra tiếp được.
  throw new StepError(
    'Không mở được form đăng nhập bằng email',
    await dump(trigger.page(), 'login_form_email_khong_mo')
  );
}

/** Kiểm tra đã đăng nhập chưa (đang ở trong app và không còn ở trang login/signup) */
export async function isLoggedIn(page: Page, signal?: AbortSignal): Promise<boolean> {
  const effectiveSignal = signal ?? new AbortController().signal;
  effectiveSignal.throwIfAborted();
  try {
    const state = await readAuthFinalState(page, effectiveSignal);
    return hasAuthenticatedWorkspace(state);
  } catch (error) {
    effectiveSignal.throwIfAborted();
    if (isDomReadTimeout(error)) throw error;
    return false;
  }
}

/**
 * Đăng nhập CapCut. Idempotent: nếu profile đã có session sẵn thì bỏ qua.
 * @throws nếu email chưa được đăng ký (cần OTP) hoặc sai mật khẩu
 */
export async function loginCapcut(
  page: Page,
  _context: BrowserContext,
  creds: CapcutCredentials,
  log: LogFn,
  options: LoginOptions
): Promise<void> {
  if (!options.ui) throw new Error('UI_INTERACTION_REQUIRED');
  if (!options.signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  const { signal, ui } = options;
  signal.throwIfAborted();

  log('\n============================================================');
  log('🔐 ĐĂNG NHẬP CAPCUT WEB');
  log('============================================================');

  try {
    await withinDeadline(
      page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }),
      90000,
      signal
    );
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  signal.throwIfAborted();
  await abortableDelay(4000, signal);

  // Trường hợp profile đã có cookie session -> CapCut tự redirect vào my-edit
  if (await isLoggedIn(page, signal)) {
    signal.throwIfAborted();
    log('   ✅ Profile đã có session sẵn, không cần đăng nhập lại');
    return;
  }

  // --- Bước 1: mở form email ---
  const continueEmail = page.getByText(/^(Continue with email|Tiếp tục bằng email)$/);
  const inputEmail = page.locator('input[type="email"]');
  await clickUntilVisible(continueEmail, inputEmail, ui, signal);
  log('   → Đã mở form email');

  // --- Bước 2: điền email và Continue ---
  await fillVerified(inputEmail, creds.email, 'Email', log, ui, signal, 'login:fill-email');

  const continueBtn = page.getByRole('button', { name: /^(Continue|Tiếp tục)$/ });
  await boundedDomRead(
    () => continueBtn.waitFor({ state: 'visible', timeout: 20000 }),
    'login:continue-visible',
    20000,
    signal
  );
  await foregroundPage(page, { signal, stage: 'login:continue-email', ui }, () =>
    continueBtn.click({ timeout: 20000 })
  );
  log('   → Đã bấm Continue');

  // --- Bước 3: xác định trạng thái tài khoản ---
  const heading = page.getByRole('heading', {
    level: 2,
    name: /^(Create an account|Tạo tài khoản|Welcome back|Chào mừng bạn trở lại)$/,
  });
  /**
   * `waitFor` 25s ném lỗi Playwright TRẦN — không ảnh, không DOM. CHANGELOG ghi
   * `yuzhpxhu31823` chết đúng ở đây (`locator.waitFor: Timeout 25000ms`) và đến
   * giờ vẫn "chưa có nguyên nhân gốc" vì không có hiện trường để xem.
   */
  await withinDeadline(
    heading.waitFor({ state: 'visible', timeout: 25000 }),
    25000,
    signal
  ).catch(async (e: unknown) => {
    signal.throwIfAborted();
    throw new StepError(
      'Không thấy heading Welcome back / Create an account sau 25s: ' + (e as Error).message,
      await dump(page, 'login_heading_khong_hien')
    );
  });
  const headingText = (
    await boundedDomRead(
      () => heading.textContent(),
      'login:heading-text',
      5000,
      signal
    )
  )?.replace(/\s+/g, ' ').trim() ?? '';

  if (/Create an account|Tạo tài khoản/.test(headingText)) {
    throw new Error(
      `Email ${creds.email} CHƯA được đăng ký trên CapCut. ` +
        'Luồng này chỉ hỗ trợ đăng nhập tài khoản có sẵn (đăng ký mới cần OTP email).'
    );
  }
  log(`   → Tài khoản đã tồn tại ("${headingText}"), tiến hành điền mật khẩu`);

  // --- Bước 4: điền password và đăng nhập ---
  const inputPassword = page.locator('input[type="password"]').first();
  await fillVerified(inputPassword, creds.password, 'Password', log, ui, signal, 'login:fill-password');

  const signInBtn = page
    .getByRole('button', { name: /^(Sign in|Log in|Continue|Đăng nhập|Tiếp tục)$/ })
    .first();
  await boundedDomRead(
    () => signInBtn.waitFor({ state: 'visible', timeout: 20000 }),
    'login:sign-in-visible',
    20000,
    signal
  );
  await foregroundPage(page, { signal, stage: 'login:sign-in', ui }, () =>
    signInBtn.click({ timeout: 20000 })
  );
  log('   → Đã bấm đăng nhập, chờ chuyển trang...');

  // --- Bước 5: chờ vào app ---
  try {
    await abortable(
      page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 60000 }),
      signal
    ).catch((error: unknown) => {
      rethrowInterrupted(error, signal);
    });
  } catch (error) {
    rethrowInterrupted(error, signal);
  }
  signal.throwIfAborted();
  await abortableDelay(5000, signal);

  // Bỏ khảo sát onboarding — và kiểm modal đã tắt thật (xem `onboarding.ts`)
  await skipOnboardingSurvey(page, log, ui, signal);
  await dismissOperationFeatureModal(page, log, ui, signal);

  // Đóng modal quảng cáo / onboarding nếu che UI
  const closeModal = page
    .locator('button[aria-label="Close"], div[aria-label="Close"], .semi-modal-close')
    .first();
  if (await closeModal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await foregroundPage(page, { signal, stage: 'login:close-modal', ui }, async () => {
      await closeModal.click({ timeout: 5000 }).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    });
    await abortableDelay(1500, signal);
  }

  if (!(await isLoggedIn(page, signal))) {
    // Cố gắng điều hướng thủ công một lần nữa trước khi báo lỗi
    try {
      await abortable(
        page.goto('https://www.capcut.com/my-edit?start_tab=video', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        }),
        signal
      ).catch((error: unknown) => {
        rethrowInterrupted(error, signal);
      });
    } catch (error) {
      rethrowInterrupted(error, signal);
    }
    signal.throwIfAborted();
    await abortableDelay(5000, signal);
  }

  if (!(await isLoggedIn(page, signal))) {
    throw new StepError(
      `Đăng nhập thất bại (URL hiện tại: ${page.url()}). Có thể sai mật khẩu hoặc bị chặn captcha.`,
      await dump(page, 'dang_nhap_that_bai')
    );
  }

  log('   ✅ ĐĂNG NHẬP THÀNH CÔNG\n');
}
