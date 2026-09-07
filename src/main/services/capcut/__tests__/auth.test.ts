/**
 * =============================================================================
 * AUTH — CHỌN ĐƯỜNG VÀO APP
 * =============================================================================
 * `ensureInApp` là chỗ quyết định đăng ký hay đăng nhập, và trước 04/09/2026 nó
 * chưa có test nào. Hai thứ được khoá ở đây:
 *
 *   1. `forceSignup` phải đi ĐĂNG KÝ trước, không thử đăng nhập rồi mới quay lại.
 *   2. Câu log giải thích lý do phải nói đúng lý do CỦA APP. Bản đầu in
 *      "do --signup" — cờ CLI của engine standalone, không tồn tại trong app —
 *      nên người đọc log đi tìm một cờ không có.
 *
 * `./login` và `./signup` bị `vi.mock` vì cả hai đòi một `Page` Playwright thật;
 * cái được kiểm là quyết định của `ensureInApp`, không phải hành vi của mock.
 * =============================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

const isLoggedIn = vi.fn();
const loginCapcut = vi.fn();
const signupCapcut = vi.fn();

vi.mock('../login', () => ({
  isLoggedIn: (...args: unknown[]) => isLoggedIn(...args),
  loginCapcut: (...args: unknown[]) => loginCapcut(...args)
}));
vi.mock('../signup', () => ({
  signupCapcut: (...args: unknown[]) => signupCapcut(...args)
}));

const { ensureInApp } = await import('../auth');

const page = { url: () => 'https://www.capcut.com/login' } as unknown as Page;
const context = {} as unknown as BrowserContext;
const account = { email: 'mail1@gmail.com', password: 'Str0ngPass', source: 'db' as const };

let lines: string[];

beforeEach(() => {
  lines = [];
  isLoggedIn.mockReset();
  loginCapcut.mockReset().mockResolvedValue(undefined);
  signupCapcut.mockReset().mockResolvedValue({
    created: true,
    alreadyExists: false,
    finalUrl: 'https://www.capcut.com/my-edit'
  });
});

function log(msg: string): void {
  lines.push(msg);
}

describe('ensureInApp với forceSignup', () => {
  it('đi ĐĂNG KÝ trước, không thử đăng nhập', async () => {
    // Chưa vào app lúc bắt đầu, đã vào app sau khi đăng ký xong.
    isLoggedIn.mockResolvedValueOnce(false).mockResolvedValue(true);

    const result = await ensureInApp(page, context, account, { forceSignup: true, log });

    expect(signupCapcut).toHaveBeenCalledTimes(1);
    expect(loginCapcut).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: 'signup', created: true });
  });

  it('giải thích lý do bằng ngôn ngữ của app, không phải cờ CLI cũ', async () => {
    isLoggedIn.mockResolvedValueOnce(false).mockResolvedValue(true);

    await ensureInApp(page, context, account, { forceSignup: true, log });

    const reason = lines.find((line) => line.includes('ĐĂNG KÝ'));
    expect(reason).toBeDefined();
    expect(reason).not.toContain('--signup');
    expect(reason).toContain('email mới');
  });
});

describe('ensureInApp không forceSignup', () => {
  it('account từ DB đi đường ĐĂNG NHẬP', async () => {
    isLoggedIn.mockResolvedValueOnce(false).mockResolvedValue(true);

    const result = await ensureInApp(page, context, account, { log });

    expect(loginCapcut).toHaveBeenCalledTimes(1);
    expect(signupCapcut).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: 'login', created: false });
  });

  it('đăng nhập không vào được thì mới thử đăng ký', async () => {
    // false lúc bắt đầu, false sau khi đăng nhập, true sau khi đăng ký.
    isLoggedIn
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const result = await ensureInApp(page, context, account, { log });

    expect(loginCapcut).toHaveBeenCalledTimes(1);
    expect(signupCapcut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: 'login-then-signup', created: true });
  });
});

describe('ensureInApp khi profile đã có session', () => {
  it('không xác thực lại', async () => {
    isLoggedIn.mockResolvedValue(true);

    const result = await ensureInApp(page, context, account, { forceSignup: true, log });

    expect(signupCapcut).not.toHaveBeenCalled();
    expect(loginCapcut).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: 'already', created: false });
  });
});

describe('ensureInApp với allowSignupFallback=false (recovery login)', () => {
  it('recovery login never calls signup when login does not enter the app', async () => {
    isLoggedIn.mockResolvedValue(false);

    await expect(
      ensureInApp(page, context, account, {
        log,
        allowSignupFallback: false
      })
    ).rejects.toThrow(/recovery/i);

    expect(signupCapcut).not.toHaveBeenCalled();
    expect(loginCapcut).toHaveBeenCalledTimes(1);
  });

  it('recovery login never invokes the signup OTP callback', async () => {
    isLoggedIn.mockResolvedValue(false);
    const getOtp = vi.fn().mockImplementation(() => {
      throw new Error('signup OTP called during recovery');
    });

    await expect(
      ensureInApp(page, context, account, {
        log,
        allowSignupFallback: false,
        getOtp
      })
    ).rejects.toThrow();

    expect(getOtp).not.toHaveBeenCalled();
    expect(signupCapcut).not.toHaveBeenCalled();
  });
});
