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
  private readonly stopping = new Map<string, Promise<void>>();

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
    opts.signal?.throwIfAborted();
    if (opts.headless) {
      this.log(
        '   ⚠️  Đường xcli không có tham số headless đã đo được — profile vẫn chạy có cửa sổ'
      );
    }

    const args = this.buildArgs(opts);

    this.log('   → Đang khởi chạy Multilogin quick profile qua xcli...');
    let commandFailed = false;
    const { stdout, stderr } = await execFileAsync(this.xcliPath, args, {
      windowsHide: true,
      cwd: this.xcliCwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      // Once dispatched, collect the id before honoring Stop. Killing the CLI
      // cannot undo an already accepted server-side quick-profile creation.
      timeout: 30_000
    }).catch((error: unknown) => {
      commandFailed = true;
      const result = error as { stdout?: unknown; stderr?: unknown } | null;
      return {
        stdout: typeof result?.stdout === 'string' ? result.stdout : '',
        stderr: typeof result?.stderr === 'string' ? result.stderr : ''
      };
    });
    const output = `${stdout}\n${stderr}`;
    const portMatch = output.match(/port:\s*(\d+)/i);
    const idMatch = output.match(/ID\s+([a-f0-9-]{16,})/i);

    // Không có profileId thì KHÔNG có cách dừng profile qua xcli, và một cửa sổ
    // treo cho mỗi account là đúng cái đã làm mất dấu 15/16 profile trong lượt
    // chạy batch 2026-09-01. Dùng đường còn lại: ngắt qua CDP cũng tắt luôn
    // browser Multilogin, rồi mới báo lỗi.
    if (!idMatch) {
      if (portMatch) await this.killByCdp(parseInt(portMatch[1], 10));
      throw new ProviderError(
        'CONFIG_ERROR',
        'xcli không trả về profile id — không xác nhận được quyền sở hữu profile.',
        MULTILOGIN_SERVICE_NAME
      );
    }

    const profileId = idMatch[1];
    const ownershipHandedOff = Boolean(opts.onProfileStarted);
    opts.onProfileStarted?.(profileId);

    try {
      opts.signal?.throwIfAborted();
      if (commandFailed) throw new ProviderError('NETWORK_ERROR', 'Lệnh xcli không hoàn tất; profile đã được ghi nhận để thu hồi.', MULTILOGIN_SERVICE_NAME);
      if (!portMatch) {
        throw new ProviderError('CONFIG_ERROR', 'Không tìm thấy CDP port trong output của xcli.', MULTILOGIN_SERVICE_NAME);
      }
      const port = parseInt(portMatch[1], 10);
      this.log(`   ✅ Profile đã chạy (ID: ${profileId}, Port: ${port})`);
      // Tắt dialog "Save password" — nó là UI của browser, nằm ngoài DOM nên
      // không click hay ẩn được, và nó che modal Upgrade khi soi giao diện.
      // Phải bơm Preferences TRƯỚC khi Chrome khởi động xong (xem ../prefs.ts).
      if (await seedPreferences(profileId)) {
        this.log('   ✓ Đã tắt dialog lưu mật khẩu');
      }

      // Browser cần thời gian khởi động trước khi nhận kết nối CDP
      await this.wait(this.bootWaitMs, opts.signal);

      const attachment = await attachOverCdp(port, {
        attempts: this.connectAttempts,
        log: this.log,
        sleep: this.sleep,
        signal: opts.signal
      });
      this.attached.set(profileId, attachment.browser);

      this.log(`   ✅ Session sẵn sàng — port ${port}, profile ${profileId}`);
      return { page: attachment.page, context: attachment.context, port, profileId };
    } catch (e) {
      // Mở được profile mà không gắn được vào thì phải dừng nó, nếu không mỗi
      // lượt chạy để lại một cửa sổ browser treo.
      if (!ownershipHandedOff) await this.stop(profileId);
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
    const existing = this.stopping.get(profileId);
    if (existing) return existing;

    const operation = (async (): Promise<void> => {
      await this.stopViaXcli(profileId);
      const browser = this.attached.get(profileId);
      this.attached.delete(profileId);
      if (browser) await browser.close().catch(() => {});
    })();
    this.stopping.set(profileId, operation);
    try {
      await operation;
    } finally {
      if (this.stopping.get(profileId) === operation) this.stopping.delete(profileId);
    }
  }

  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
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
        env: process.env,
        timeout: 10_000
      });
      const deadline = Date.now() + 5000;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Profile stop confirmation timed out');
        const { stdout } = await execFileAsync(this.xcliPath, ['profile-status'], {
          windowsHide: true, cwd: this.xcliCwd, env: process.env, timeout: remaining
        });
        if (!stdout.includes('Profile Status')) throw new Error('Unrecognized profile status output');
        const row = stdout.split(/\r?\n/).find((line) => line.trim().startsWith(profileId));
        if (!row || row.trim().split(/\s+/)[1] === 'stopped') break;
        await this.sleep(Math.min(250, remaining));
      }
      this.log(`Đã dừng profile ${profileId}`);
    } catch {
      this.log(`Không dừng được profile ${profileId}.`);
      throw new ProviderError(
        'NETWORK_ERROR',
        'Không dừng được Multilogin profile ' + profileId + '.',
        MULTILOGIN_SERVICE_NAME
      );
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
