/**
 * =============================================================================
 * AUTH — QUYẾT ĐỊNH ĐĂNG KÝ HAY ĐĂNG NHẬP
 * =============================================================================
 * Đây là module thứ tư, và nó chỉ làm ĐÚNG MỘT việc: đưa profile vào trong app,
 * bằng đường nào cũng được. Nó không biết gì về nhiệm vụ, không biết gì về
 * proxy — chỉ gọi lại hai module đã có:
 *
 *   src/signup.ts  →  signupCapcut()
 *   src/login.ts   →  loginCapcut(), isLoggedIn()
 *
 * Nhờ vậy orchestrator không cần cờ `--signup` thủ công nữa: tài khoản có sẵn
 * thì đăng nhập, chưa có thì đăng ký.
 *
 * FALLBACK HAI CHIỀU — cả hai đều đã gặp thật:
 *   - đăng ký mà CapCut báo email đã tồn tại  →  chuyển sang đăng nhập
 *   - đăng nhập mà không vào được app         →  thử đăng ký (email chưa tồn tại)
 * =============================================================================
 *
 * GHI CHÚ KHI PORT VÀO APP:
 *   - `Account` của engine đến từ `src/accounts.ts` (file phẳng `accounts.txt`).
 *     File đó KHÔNG được port (app dùng bảng `accounts` trong SQLite), nên kiểu
 *     tối thiểu `AuthAccount` được khai tại chỗ ở dưới.
 *   - `opts` không còn tuỳ chọn: `log` bắt buộc vì `console.log` đã bị bỏ hẳn.
 */

import type { BrowserContext, Page } from 'playwright-core';

import { isLoggedIn, loginCapcut, type CapcutCredentials } from './login';
import { signupCapcut } from './signup';
import type { AccountUiInteraction } from './types';
import { isDomReadTimeout } from './cancellation';

/**
 * Tài khoản tối thiểu mà tầng xác thực cần: email + password, cộng NGUỒN lấy
 * tài khoản để biết nó đã tồn tại trên CapCut hay chưa (xem `looksExisting`).
 * Hai giá trị của bản engine được giữ nguyên để quyết định không đổi; `'db'` là
 * nguồn của app (bảng `accounts` trong SQLite) — cũng là tài khoản đã từng được
 * tạo nên đi đường đăng nhập.
 */
export interface AuthAccount extends CapcutCredentials {
  source?: 'cli' | 'accounts.txt' | '.env' | 'db';
}

/** Đường đã thật sự dùng để vào app. */
export type AuthMode = 'already' | 'login' | 'signup' | 'signup-then-login' | 'login-then-signup';

export interface AuthResult {
  mode: AuthMode;
  /** true nếu tài khoản được tạo mới trong lần chạy này (cần ghi vào accounts.txt) */
  created: boolean;
}

export interface AuthOptions {
  /**
   * Bắt buộc đi đường đăng ký, kể cả khi tài khoản đến từ accounts.txt.
   *
   * Trong app: `CapcutEngineService` bật cờ này khi `isNewAccount` — email vừa
   * được thuê/mua trong lượt chạy nên CapCut chưa có account nào dùng nó. Bản
   * engine standalone bật bằng cờ CLI `npm run dev -- --signup`; cờ đó KHÔNG tồn
   * tại trong app, nên câu log không được nhắc tới nó.
   */
  forceSignup?: boolean;
  log: (msg: string) => void;
  /**
   * Nguồn mã xác minh 6 số, chuyển thẳng cho `signupCapcut`. App nối vào
   * `EmailPurchaseService`; thiếu nó mà CapCut đòi OTP thì signup ném lỗi rõ ràng.
   */
  getOtp?: (email: string) => Promise<string>;
  ui: AccountUiInteraction;
  signal: AbortSignal;
  allowSignupFallback?: boolean;
}

/**
 * Tài khoản đến từ `accounts.txt` nghĩa là đã từng được tạo -> đi đường đăng nhập.
 * Tài khoản sinh ngẫu nhiên (`source: 'cli'`, `lineNumber: 0`) thì chưa tồn tại
 * -> đi đường đăng ký. `.env` là tài khoản đã lưu -> đăng nhập.
 */
function looksExisting(account: AuthAccount): boolean {
  return (
    account.source === 'accounts.txt' || account.source === '.env' || account.source === 'db'
  );
}

export class RecoveryLoginError extends Error {
  readonly code = 'RECOVERY_LOGIN_FAILED' as const;
  constructor(message = 'Recovery login failed: cannot enter CapCut and signup fallback is disabled') {
    super(message);
    this.name = 'RecoveryLoginError';
  }
}

export function isRecoveryLoginError(err: unknown): err is RecoveryLoginError {
  return (
    err instanceof RecoveryLoginError ||
    (err instanceof Error && (err as { code?: string }).code === 'RECOVERY_LOGIN_FAILED')
  );
}

export async function ensureInApp(
  page: Page,
  context: BrowserContext,
  account: AuthAccount,
  opts: AuthOptions
): Promise<AuthResult> {
  if (!opts.ui) throw new Error('UI_INTERACTION_REQUIRED');
  if (!opts.signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  opts.signal.throwIfAborted();
  const log = opts.log;

  if (await isLoggedIn(page, opts.signal)) {
    log('✅ Profile đã đăng nhập sẵn — không cần xác thực lại');
    return { mode: 'already', created: false };
  }

  const trySignup = opts.forceSignup || !looksExisting(account);
  log(
    trySignup
      ? `↪️  Đi đường ĐĂNG KÝ (${
          opts.forceSignup ? 'do email mới, chưa có account CapCut' : 'tài khoản mới sinh'
        })`
      : `↪️  Đi đường ĐĂNG NHẬP (tài khoản từ ${account.source})`
  );

  if (trySignup) {
    const r = await signupCapcut(page, context, account, { log, getOtp: opts.getOtp, ui: opts.ui, signal: opts.signal });
    if (r.alreadyExists && !(await isLoggedIn(page, opts.signal))) {
      log('Email đã tồn tại → chuyển sang đăng nhập');
      await loginCapcut(page, context, account, log, { ui: opts.ui, signal: opts.signal });
      await assertInApp(page, account, opts.signal);
      return { mode: 'signup-then-login', created: false };
    }
    await assertInApp(page, account, opts.signal);
    return { mode: 'signup', created: r.created };
  }

  await loginCapcut(page, context, account, log, { ui: opts.ui, signal: opts.signal }).catch((e: unknown) => {
    opts.signal.throwIfAborted();
    if (isDomReadTimeout(e)) throw e;
    log(`Đăng nhập thất bại: ${(e as Error).message}`);
  });
  if (await isLoggedIn(page, opts.signal)) return { mode: 'login', created: false };

  if (opts.allowSignupFallback === false) {
    throw new RecoveryLoginError(`Recovery login failed for ${account.email} (URL: ${page.url()})`);
  }

  // Không vào được: có thể email chưa từng được tạo trên CapCut.
  log('Đăng nhập không vào được app → thử đăng ký');
  const r = await signupCapcut(page, context, account, { log, getOtp: opts.getOtp, ui: opts.ui, signal: opts.signal });
  await assertInApp(page, account, opts.signal);
  return { mode: 'login-then-signup', created: r.created };
}

async function assertInApp(page: Page, account: AuthAccount, signal?: AbortSignal): Promise<void> {
  if (await isLoggedIn(page, signal)) return;
  throw new Error(`Chưa vào được app với ${account.email} (URL: ${page.url()})`);
}
