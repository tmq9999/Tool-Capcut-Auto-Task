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
import { boundedDomRead, withinDeadline } from '../cancellation';

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

import type { AccountUiInteraction } from '../types';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

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
  ui?: AccountUiInteraction;
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
const MIN_HEADED_VIEWPORT = { width: 1440, height: 900 } as const;

export interface CdpAttachOptions {
  headless?: boolean;
  attempts?: number;
  intervalMs?: number;
  log?: LauncherLog;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  ui?: AccountUiInteraction;
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
 */
export async function configureHeadedWindowUnlocked(
  page: Page,
  context: BrowserContext,
  options: CdpAttachOptions
): Promise<void> {
  await page.bringToFront().catch(() => {});

  if (options.headless === false) {
    // setViewportSize only changes Playwright's emulated viewport over CDP;
    // the Multilogin window stays narrow and still clips real mouse targets.
    const session = await context.newCDPSession(page);
    try {
      const [viewport, window] = await Promise.all([
        boundedDomRead(
          () => page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            screenWidth: screen.availWidth,
            screenHeight: screen.availHeight
          })),
          'headed-viewport',
          5000,
          options.signal
        ),
        withinDeadline(session.send('Browser.getWindowForTarget'), 5000, options.signal)
      ]);
      options.signal?.throwIfAborted();
      const { bounds, windowId } = window;
      if (
        !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
        !Number.isFinite(viewport.screenWidth) || !Number.isFinite(viewport.screenHeight) ||
        !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
      ) {
        throw new Error('Không đọc được kích thước cửa sổ headed.');
      }

      const currentWidth = bounds.width as number;
      const currentHeight = bounds.height as number;
      const frameWidth = Math.max(0, currentWidth - viewport.width);
      const frameHeight = Math.max(0, currentHeight - viewport.height);
      const target = {
        width: Math.max(
          currentWidth,
          Math.min(MIN_HEADED_VIEWPORT.width, viewport.screenWidth) + frameWidth
        ),
        height: Math.max(
          currentHeight,
          Math.min(MIN_HEADED_VIEWPORT.height, viewport.screenHeight) + frameHeight
        )
      };
      const needsResize = target.width > currentWidth || target.height > currentHeight;

      let nativeViewport = viewport;
      let nativeWindow = window;

      if (needsResize) {
        if (bounds.windowState && bounds.windowState !== 'normal') {
          await withinDeadline(
            session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }),
            5000,
            options.signal
          );
        }
        await withinDeadline(
          session.send('Browser.setWindowBounds', { windowId, bounds: target }),
          8000,
          options.signal
        );
        [nativeViewport, nativeWindow] = await Promise.all([
          boundedDomRead(
            () => page.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
              screenWidth: screen.availWidth,
              screenHeight: screen.availHeight
            })),
            'headed-native-viewport-readback',
            5000,
            options.signal
          ),
          withinDeadline(session.send('Browser.getWindowForTarget'), 5000, options.signal)
        ]);
        options.signal?.throwIfAborted();
      }

      const nativeWidth = nativeWindow.bounds.width;
      const nativeHeight = nativeWindow.bounds.height;
      if (
        !Number.isFinite(nativeWidth) || !Number.isFinite(nativeHeight) ||
        (nativeWidth ?? 0) <= 0 || (nativeHeight ?? 0) <= 0 ||
        !Number.isFinite(nativeViewport.width) || !Number.isFinite(nativeViewport.height) ||
        nativeViewport.width <= 0 || nativeViewport.height <= 0
      ) {
        throw new Error('Không đọc được kích thước cửa sổ headed sau khi resize.');
      }

      let layoutViewport = { width: nativeViewport.width, height: nativeViewport.height };
      if (
        nativeViewport.width < MIN_HEADED_VIEWPORT.width ||
        nativeViewport.height < MIN_HEADED_VIEWPORT.height
      ) {
        layoutViewport = {
          width: Math.max(nativeViewport.width, MIN_HEADED_VIEWPORT.width),
          height: Math.max(nativeViewport.height, MIN_HEADED_VIEWPORT.height)
        };
        await withinDeadline(page.setViewportSize(layoutViewport), 8000, options.signal);
        const viewportReady = await boundedDomRead(
          () => page.waitForFunction(
            ({ width, height }) => innerWidth >= width && innerHeight >= height,
            layoutViewport,
            { timeout: 5000 }
          ),
          'headed-layout-viewport-readback',
          5500,
          options.signal
        );
        await viewportReady.dispose().catch(() => {});
      }

      if ((nativeWidth ?? 0) < target.width || (nativeHeight ?? 0) < target.height) {
        options.log?.(
          `⚠️ Headed native window bị giới hạn: yêu cầu ${target.width}x${target.height}, ` +
          `native ${nativeWidth}x${nativeHeight}; layout viewport ${layoutViewport.width}x${layoutViewport.height}`
        );
      } else if (needsResize || layoutViewport.width !== viewport.width || layoutViewport.height !== viewport.height) {
        options.log?.(
          `Headed native window ${nativeWidth}x${nativeHeight}; ` +
          `layout viewport ${layoutViewport.width}x${layoutViewport.height}`
        );
      }
    } finally {
      await session.detach().catch(() => {});
    }
  }
}

/**
 * Gắn Playwright vào một profile Multilogin đã mở sẵn cổng debug.
 *
 * Hàm này dùng chung cho cả `xcli` lẫn `api-v3` sau khi mỗi bên đã hoàn thành
 * việc MỞ profile. Nó gom:
 *   - retry kết nối CDP
 *   - mở rộng cửa sổ nếu chạy HEADED để không bị che nút
 *   - cấp sẵn quyền notifications cho CapCut
 *
 * Nếu kết nối/resize thất bại, hàm chủ động đóng browser CDP và ném tiếp để
 * caller dọn dẹp profile. Caller phải luôn bọc trong `try..catch` và gọi `stop()`
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

    if (options.headless === false && !options.ui) {
      throw new Error('Headed launch requires an AccountUiInteraction session facade');
    }

    const ui = options.ui ?? createDirectUiInteraction(options.signal ?? new AbortController().signal);
    await ui.foreground('launcher:window-setup', () =>
      configureHeadedWindowUnlocked(page, context, options)
    );

    options.signal?.throwIfAborted();

    // Cấp sẵn quyền notifications (phục vụ nhiệm vụ "Enable browser notifications")
    await context.grantPermissions(['notifications'], { origin: CAPCUT_ORIGIN }).catch(() => {});

    return { browser, context, page };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
