/**
 * =============================================================================
 * LAUNCHER FACTORY — CHỌN ĐƯỜNG MỞ BROWSER THEO CẤU HÌNH
 * =============================================================================
 * Cả hai implementation đều đã chạy thật, nên không nửa nào bị xoá; lựa chọn
 * nằm ở `app_settings.browserLauncher` và chỉ đi qua đúng hàm này. Engine nhiệm
 * vụ không import launcher nào cụ thể — nó chỉ thấy `BrowserLauncher`.
 *
 * Mặc định là `api-v3`: đó là đường app đã có sẵn token + provider + test, và
 * nó nhận được proxy có user/pass. `xcli` giữ lại vì là đường duy nhất đã chạy
 * trọn luồng nhiệm vụ CapCut từ đầu đến cuối (2026-09-02).
 * =============================================================================
 */

import { ProviderError } from '../../../providers/ProviderError';
import { MULTILOGIN_SERVICE_NAME } from '../../../providers/MultiloginProvider';
import type { MultiloginQuickProfileApi, MultiloginTokenSource } from '../../browserRuntime';
import { ApiV3Launcher, type ApiV3LauncherOptions } from './ApiV3Launcher';
import { XcliLauncher, type XcliLauncherOptions } from './XcliLauncher';
import type { BrowserLauncher, BrowserLauncherKind, LauncherLog } from './BrowserLauncher';

export {
  BROWSER_LAUNCHER_KINDS,
  isBrowserLauncherKind,
  NO_LAUNCHER_LOG,
  attachOverCdp,
  connectOverCdpWithRetry,
  defaultSleep
} from './BrowserLauncher';
export type {
  BrowserLauncher,
  BrowserLauncherKind,
  LaunchOptions,
  LaunchedProfile,
  LauncherLog,
  LauncherProxy
} from './BrowserLauncher';
export { ApiV3Launcher, type ApiV3LauncherOptions } from './ApiV3Launcher';
export { XcliLauncher, XCLI_PATH, XCLI_CWD, type XcliLauncherOptions } from './XcliLauncher';

/** Đúng những gì `api-v3` cần: token của app + phần HTTP của `MultiloginProvider`. */
export interface MultiloginLauncherDeps {
  auth: MultiloginTokenSource;
  api: MultiloginQuickProfileApi;
}

export interface BrowserLauncherDeps {
  /** Đi qua `LogBus`, không `console.log` (AGENTS.md §16). */
  log?: LauncherLog;
  /** Bắt buộc khi kind = 'api-v3'. `MultiloginProvider` khớp `api` theo cấu trúc. */
  multilogin?: MultiloginLauncherDeps;
  xcli?: Omit<XcliLauncherOptions, 'log'>;
  apiV3?: Omit<ApiV3LauncherOptions, 'log'>;
}

export function createBrowserLauncher(
  kind: BrowserLauncherKind,
  deps: BrowserLauncherDeps = {}
): BrowserLauncher {
  if (kind === 'xcli') {
    return new XcliLauncher({ ...deps.xcli, log: deps.log });
  }

  if (kind === 'api-v3') {
    if (!deps.multilogin) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Thiếu Multilogin auth/provider cho đường mở browser api-v3.',
        MULTILOGIN_SERVICE_NAME
      );
    }
    return new ApiV3Launcher(deps.multilogin.auth, deps.multilogin.api, {
      ...deps.apiV3,
      log: deps.log
    });
  }

  throw new ProviderError(
    'CONFIG_ERROR',
    'Đường mở browser không hợp lệ: ' + String(kind),
    MULTILOGIN_SERVICE_NAME
  );
}
