/**
 * =============================================================================
 * XCLI LAUNCHER — MỞ QUICK PROFILE QUA `xcli.exe`
 * =============================================================================
 * Tách từ `Automation_Capcut/src/session.ts` (`openSession` / `closeSession`) +
 * `startQuickProfile` / `stopQuickProfile` của `Automation_Capcut/src/config.ts`.
 * Đây là đường đã chạy trọn một luồng thật trên máy này (xem
 * `run_e2e_final.txt` 2026-09-02: ID `094f92dd-…-10ffe099466c`, port 62295), nên
 * cả bộ tham số lẫn regex đọc output đều giữ nguyên, không "tối ưu".
 *
 * NHỮNG GÌ BỊ BỎ khi tách khỏi `session.ts` — app đã có chỗ khác lo:
 *   - `parseCommonArgs`, `--port`, `--reuse`, `--no-proxy`: app không có dòng
 *     lệnh. Không proxy = `LaunchOptions.proxy` để trống.
 *   - `.state/port.txt`, `.state/profile.txt`, `.state/profiles.json`: sổ theo
 *     dõi profile là việc của `AutomationRunService` + SQLite.
 *   - `loadProxyKeys()` / `fetchProxyRotating()` đọc `kiotkey.txt`: proxy do UI
 *     cấp qua `LaunchOptions` (`ProxyLeaseManager`).
 *   - `.env`: credentials CapCut nằm trong SQLite.
 *   - nhánh "dùng profile đang chạy sẵn": mỗi luồng của app luôn mở profile
 *     riêng và tự dừng nó, nên `ownsProfile` luôn là true.
 * =============================================================================
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Browser } from 'playwright-core';

import { ProviderError } from '../../../providers/ProviderError';
import { MULTILOGIN_SERVICE_NAME } from '../../../providers/MultiloginProvider';
import { seedPreferences } from '../prefs';
import {
  attachOverCdp,
  connectOverCdpWithRetry,
  defaultSleep,
  NO_LAUNCHER_LOG,
  type BrowserLauncher,
  type LauncherLog,
  type LaunchedProfile,
  type LaunchOptions
} from './BrowserLauncher';

const execFileAsync = promisify(execFile);

/**
 * Vị trí xcli do Multilogin cài đặt cố định trong home của người dùng
 * (`C:\Users\<user>\mlx\deps\cli`). Engine hardcode đúng đường này; ở đây ghép
 * từ `USERPROFILE` để máy khác vẫn đúng, và vẫn cho override qua options.
 */
export const XCLI_PATH = path.join(
  process.env.USERPROFILE ?? '',
  'mlx',
  'deps',
  'cli',
  'xcli.exe'
);
export const XCLI_CWD = path.join(process.env.USERPROFILE ?? '', 'mlx', 'deps', 'cli');

export interface XcliLauncherOptions {
  log?: LauncherLog;
  xcliPath?: string;
  xcliCwd?: string;
  /**
   * Bộ tham số ĐO ĐƯỢC của lượt chạy thành công: mimic core 151, os windows,
   * `--automation puppeteer`.
   *
   * `--automation` là thứ KHÔNG được bỏ: launcher chỉ publish cổng CDP cho lượt
   * start kèm automation type. Giá trị `puppeteer` là cái engine đã chạy thật
   * (đường API v3 dùng `playwright` — cùng tác dụng, khác tên).
   */
  automation?: string;
  osType?: string;
  coreVersion?: string;
  browserType?: string;
  /** Browser cần thời gian khởi động trước khi nhận kết nối CDP (engine: 5000ms). */
  bootWaitMs?: number;
  /** Số lần thử `connectOverCDP` (engine: 14 cho profile vừa khởi chạy). */
  connectAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class XcliLauncher implements BrowserLauncher {
  readonly name = 'xcli' as const;

  private readonly log: LauncherLog;
  private readonly xcliPath: string;
  private readonly xcliCwd: string;
  private readonly automation: string;
  private readonly osType: string;
  private readonly coreVersion: string;
  private readonly browserType: string;
  private readonly bootWaitMs: number;
  private readonly connectAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * Handle CDP của từng profile đang mở.
   *
   * Engine giữ nó trong `Session.browser` rồi truyền lại cho `closeSession`. App
   * chỉ đưa `profileId` cho UI, nên launcher phải tự nhớ — nếu không, `stop()`
   * dừng được profile nhưng để lại một kết nối CDP mồ côi.
   */
  private readonly attached = new Map<string, Browser>();

  constructor(options: XcliLauncherOptions = {}) {
    this.log = options.log ?? NO_LAUNCHER_LOG;
    this.xcliPath = options.xcliPath ?? XCLI_PATH;
    this.xcliCwd = options.xcliCwd ?? XCLI_CWD;
    this.automation = options.automation ?? 'puppeteer';
    this.osType = options.osType ?? 'windows';
    this.coreVersion = options.coreVersion ?? '151';
    this.browserType = options.browserType ?? 'mimic';
    this.bootWaitMs = options.bootWaitMs ?? 5000;
    this.connectAttempts = options.connectAttempts ?? 14;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Tham số `profile-quick` — giữ đúng thứ tự và giá trị của lượt chạy thật.
   *
   * CHÚ Ý về proxy: engine chỉ truyền `--proxy-type/--proxy-host/--proxy-port`.
   * Key KiotProxy xác thực bằng IP nên không cần user/pass, và không có bằng
   * chứng đo được về tên cờ user/pass của xcli. Vì vậy proxy có user/pass bị
   * CHẶN ở đây, thay vì lặng lẽ chạy không xác thực rồi vỡ giữa phiên bằng
   * ERR_PROXY_CONNECTION_FAILED — đường `api-v3` nhận đủ user/pass.
   */
  private buildArgs(opts: LaunchOptions): string[] {
    const args = [
      'profile-quick',
      '--automation', this.automation,
      '--os-type', this.osType,
      '--core-version', this.coreVersion,
      '--browser-type', this.browserType
    ];

    const proxy = opts.proxy;
    if (proxy?.host && proxy?.port) {
      if (proxy.username || proxy.password) {
        throw new ProviderError(
          'CONFIG_ERROR',
          'Đường mở browser "xcli" chưa hỗ trợ proxy có user/pass. ' +
            'Chọn browserLauncher = api-v3 hoặc dùng proxy xác thực bằng IP.',
          MULTILOGIN_SERVICE_NAME
        );
      }
      args.push(
        '--proxy-type', proxy.scheme || 'socks5',
        '--proxy-host', proxy.host,
        '--proxy-port', proxy.port
      );
    }

    return args;
  }

  async launch(opts: LaunchOptions): Promise<LaunchedProfile> {
    if (opts.headless) {
      this.log(
        '   ⚠️  Đường xcli không có tham số headless đã đo được — profile vẫn chạy có cửa sổ'
      );
    }

    const args = this.buildArgs(opts);

    this.log('   → Đang khởi chạy Multilogin quick profile qua xcli...');
    const { stdout, stderr } = await execFileAsync(this.xcliPath, args, {
      windowsHide: true,
      cwd: this.xcliCwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });

    const output = `${stdout}\n${stderr}`;
    const portMatch = output.match(/port:\s*(\d+)/i);
    const idMatch = output.match(/ID\s+([a-f0-9-]{16,})/i);

    if (!portMatch) {
      this.log(`   ⚠️  Output xcli: ${output.trim().slice(0, 300)}`);
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không tìm thấy CDP port trong output của xcli.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    const port = parseInt(portMatch[1], 10);

    // Không có profileId thì KHÔNG có cách dừng profile qua xcli, và một cửa sổ
    // treo cho mỗi account là đúng cái đã làm mất dấu 15/16 profile trong lượt
    // chạy batch 2026-09-01. Dùng đường còn lại: ngắt qua CDP cũng tắt luôn
    // browser Multilogin, rồi mới báo lỗi.
    if (!idMatch) {
      this.log(`   ⚠️  Output xcli: ${output.trim().slice(0, 300)}`);
      await this.killByCdp(port);
      throw new ProviderError(
        'CONFIG_ERROR',
        'xcli không trả về profile id — đã tắt profile vừa mở để không treo cửa sổ.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    const profileId = idMatch[1];
    this.log(`   ✅ Profile đã chạy (ID: ${profileId}, Port: ${port})`);

    try {
      // Tắt dialog "Save password" — nó là UI của browser, nằm ngoài DOM nên
      // không click hay ẩn được, và nó che modal Upgrade khi soi giao diện.
      // Phải bơm Preferences TRƯỚC khi Chrome khởi động xong (xem ../prefs.ts).
      if (await seedPreferences(profileId)) {
        this.log('   ✓ Đã tắt dialog lưu mật khẩu');
      }

      // Browser cần thời gian khởi động trước khi nhận kết nối CDP
      await this.sleep(this.bootWaitMs);

      const attachment = await attachOverCdp(port, {
        attempts: this.connectAttempts,
        log: this.log,
        sleep: this.sleep
      });
      this.attached.set(profileId, attachment.browser);

      this.log(`   ✅ Session sẵn sàng — port ${port}, profile ${profileId}`);
      return { page: attachment.page, context: attachment.context, port, profileId };
    } catch (e) {
      // Mở được profile mà không gắn được vào thì phải dừng nó, nếu không mỗi
      // lượt chạy để lại một cửa sổ browser treo.
      await this.stopViaXcli(profileId);
      throw e;
    }
  }

  /**
   * Đóng session.
   *
   * LƯU Ý QUAN TRỌNG: với `connectOverCDP`, `browser.close()` sẽ TẮT LUÔN browser
   * Multilogin. Vì vậy khi muốn giữ profile lại để script khác dùng tiếp, ta
   * KHÔNG gọi close() mà chỉ để process kết thúc.
   *
   * Khi đóng thật thì phải dừng cả profile Multilogin, không chỉ ngắt CDP —
   * nếu không, mỗi lượt chạy để lại một cửa sổ browser treo.
   *
   * App luôn là "đóng thật": không có nhánh giữ profile cho lượt sau.
   */
  async stop(profileId: string): Promise<void> {
    const browser = this.attached.get(profileId);
    this.attached.delete(profileId);
    if (browser) await browser.close().catch(() => {});
    await this.stopViaXcli(profileId);
  }

  /**
   * Dừng profile Multilogin (không throw nếu lỗi).
   *
   * `--profile-id` là bắt buộc: bản engine đầu tiên gọi `profile-stop` với sai
   * cú pháp (thiếu hẳn cờ này) nên ngay cả lần được gọi cũng không dừng được
   * profile nào.
   */
  private async stopViaXcli(profileId: string): Promise<void> {
    if (!profileId) return;
    try {
      await execFileAsync(this.xcliPath, ['profile-stop', '--profile-id', profileId], {
        windowsHide: true,
        cwd: this.xcliCwd,
        env: process.env
      });
      this.log(`Đã dừng profile ${profileId}`);
    } catch (e) {
      this.log(`Không dừng được profile ${profileId}: ${(e as Error).message}`);
    }
  }

  /** Lối thoát cuối khi chỉ biết port: ngắt CDP kéo theo cả browser Multilogin. */
  private async killByCdp(port: number): Promise<void> {
    const browser = await connectOverCdpWithRetry(port, {
      attempts: 3,
      log: this.log,
      sleep: this.sleep
    }).catch(() => null);
    if (browser) await browser.close().catch(() => {});
  }
}
