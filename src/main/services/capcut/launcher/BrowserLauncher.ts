/**
 * =============================================================================
 * BROWSER LAUNCHER — HAI ĐƯỜNG MỞ QUICK PROFILE SAU MỘT INTERFACE
 * =============================================================================
 * Cả hai nửa đều đã được nghiệm thu trên máy thật, nên không nửa nào bị viết
 * lại:
 *
 *   - `xcli`   engine CLI dùng: `xcli.exe profile-quick` rồi `connectOverCDP`.
 *              Đo được 2026-09-02 (`Automation_Capcut/run_e2e_final.txt`):
 *              profile `094f92dd-a63e-11f1-8304-10ffe099466c`, port 62295, chạy
 *              trọn luồng đăng ký + nhiệm vụ.
 *   - `api-v3` UI dùng: `POST /api/v3/profile/quick` với `automation:'playwright'`,
 *              rồi poll `GET /api/v1/profile/quick/statuses` để lấy cổng debug.
 *              Live test 2026-09-01 (`providers/__live__/multiloginCdp.live.test.ts`).
 *
 * ĐIỂM CHUNG ĐO ĐƯỢC Ở CẢ HAI ĐƯỜNG: launcher CHỈ publish cổng CDP khi profile
 * được start KÈM một `automation` type. Lượt start thường (người dùng bấm tay
 * trong Multilogin) không mở cổng nào cho Playwright gắn vào.
 *
 * Chọn đường nào là quyết định của app (`app_settings.browserLauncher`). Engine
 * nhiệm vụ không được biết tới lựa chọn đó — nó chỉ nhận `{ page, context }`.
 * =============================================================================
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { ProviderError } from '../../../providers/ProviderError';
import { MULTILOGIN_SERVICE_NAME } from '../../../providers/MultiloginProvider';

export const BROWSER_LAUNCHER_KINDS = ['xcli', 'api-v3'] as const;

export type BrowserLauncherKind = (typeof BROWSER_LAUNCHER_KINDS)[number];

/** Dùng ở chỗ wiring để kiểm chuỗi đọc từ `app_settings` trước khi gọi factory. */
export function isBrowserLauncherKind(value: unknown): value is BrowserLauncherKind {
  return typeof value === 'string' && (BROWSER_LAUNCHER_KINDS as readonly string[]).includes(value);
}

/**
 * Log được INJECT, không dùng `console.log`: launcher chạy trong main process
 * của Electron nên mọi dòng phải đi qua `LogBus` để có `accountId`
 * (AGENTS.md §16). Mặc định no-op để hàm vẫn gọi được từ chỗ không có logger.
 */
export type LauncherLog = (msg: string) => void;

export const NO_LAUNCHER_LOG: LauncherLog = () => {};

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Proxy do UI cấp (`ProxyLeaseManager` hoặc danh sách dán tay). `port` là string
 * vì đó là hình dạng KiotProxy trả về (`ProxyInfo` của engine) và cả hai đường
 * mở profile chỉ ghép nó vào tham số dòng lệnh / JSON chứ không tính toán gì.
 */
export interface LauncherProxy {
  scheme: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
}

export interface LaunchOptions {
  /** `null`/bỏ trống = chạy bằng IP máy thật (tương đương `--no-proxy` của engine). */
  proxy?: LauncherProxy | null;
  /**
   * Mặc định `false` = có cửa sổ. Cả hai lượt nghiệm thu (engine CLI và live
   * test API v3) đều chạy HEADED; headless là tuỳ chọn của UI, không phải mặc
   * định của launcher.
   */
  headless?: boolean;
  /** Cancels waits and process startup owned by this launch. */
  signal?: AbortSignal;
  /** Called as soon as the vendor reports the profile id, before CDP attach. */
  onProfileStarted?: (profileId: string) => void;
}

/**
 * Cái mà engine nhiệm vụ cần — không hơn.
 *
 * KHÔNG trả `browser` ra ngoài là có ý: với `connectOverCDP`, `browser.close()`
 * TẮT LUÔN browser Multilogin, nên nếu ai đó ngoài launcher gọi close() thì
 * profile chết sau lưng launcher và `stop()` không còn gì để dừng. Handle CDP
 * do launcher giữ và nhả trong `stop(profileId)`.
 */
export interface LaunchedProfile {
  page: Page;
  context: BrowserContext;
  port: number;
  profileId: string;
}

export interface BrowserLauncher {
  readonly name: BrowserLauncherKind;
  launch(opts: LaunchOptions): Promise<LaunchedProfile>;
  stop(profileId: string): Promise<void>;
}

/* ===========================================================================
 * PHẦN DÙNG CHUNG — GẮN PLAYWRIGHT VÀO CỔNG CDP
 * ---------------------------------------------------------------------------
 * Hai implementation khác nhau ở cách MỞ profile, còn từ lúc có `port` trở đi
 * thì giống nhau từng dòng. Giữ ở đây để không có hai bản retry lệch nhau.
 * =========================================================================== */

/** CapCut cần quyền notifications (nhiệm vụ "Enable browser notifications"). */
const CAPCUT_ORIGIN = 'https://www.capcut.com';

export interface CdpAttachOptions {
  attempts?: number;
  intervalMs?: number;
  log?: LauncherLog;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface CdpAttachment {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Kết nối CDP với retry — Multilogin cần vài giây mới mở port sau khi start.
 * @param attempts số lần thử. Profile vừa khởi chạy cần nhiều lần; profile
 *        đáng lẽ đang chạy sẵn thì chỉ cần vài lần rồi báo lỗi sờm.
 *
 * Trong app luôn là trường hợp "vừa khởi chạy": không có đường tái dùng profile
 * cũ (`--port` / `.state/port.txt` của engine đã bỏ), nên mặc định là 14 lần.
 */
export async function connectOverCdpWithRetry(
  port: number,
  options: CdpAttachOptions = {}
): Promise<Browser> {
  const attempts = options.attempts ?? 14;
  const intervalMs = options.intervalMs ?? 2500;
  const log = options.log ?? NO_LAUNCHER_LOG;
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;
  const url = `http://127.0.0.1:${port}`;
  let lastErr: unknown;

  for (let i = 1; i <= attempts; i++) {
    signal?.throwIfAborted();
    try {
      const connection = chromium.connectOverCDP(url);
      if (!signal) return await connection;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(signal.reason ?? new Error('Aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        void connection.then(
          (browser) => {
            signal.removeEventListener('abort', onAbort);
            if (signal.aborted) void browser.close().catch(() => {});
          },
          () => signal.removeEventListener('abort', onAbort)
        );
      });
      return await Promise.race([connection, aborted]);
    } catch (e) {
      signal?.throwIfAborted();
      lastErr = e;
      if (i < attempts) {
        log(`   ... chờ browser mở port CDP (${i}/${attempts})`);
        if (!signal) {
          await sleep(intervalMs);
        } else {
          let onAbort: (() => void) | null = null;
          const aborted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason ?? new Error('Aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
          });
          try {
            await Promise.race([sleep(intervalMs), aborted]);
          } finally {
            if (onAbort) signal.removeEventListener('abort', onAbort);
          }
        }
      }
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message.split('\n')[0] : String(lastErr);
  throw new ProviderError(
    'NETWORK_ERROR',
    `Không kết nối được CDP tại ${url}: ${msg}. ` +
      'Kiểm tra: profile Multilogin còn chạy không? port còn đúng không?',
    MULTILOGIN_SERVICE_NAME
  );
}

/**
 * Từ `port` thành `{ context, page }` sẵn sàng làm việc.
 *
 * Ném thì đã tự ngắt CDP, nhưng KHÔNG tự dừng profile — người gọi mới biết
 * profileId để dừng cho đúng.
 */
export async function attachOverCdp(
  port: number,
  options: CdpAttachOptions = {}
): Promise<CdpAttachment> {
  const browser = await connectOverCdpWithRetry(port, options);

  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Không tìm thấy BrowserContext nào trong browser');

    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront().catch(() => {});

    // Cấp sẵn quyền notifications (phục vụ nhiệm vụ "Enable browser notifications")
    await context.grantPermissions(['notifications'], { origin: CAPCUT_ORIGIN }).catch(() => {});

    return { browser, context, page };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
