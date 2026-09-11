/**
 * =============================================================================
 * API V3 LAUNCHER — MỞ QUICK PROFILE QUA REST API CỦA MULTILOGIN
 * =============================================================================
 * KHÔNG viết lại HTTP: dùng `MultiloginProvider` có sẵn (đã live test
 * 2026-09-01, `providers/__live__/multiloginCdp.live.test.ts`) và nhận nó qua
 * constructor. Ba lời gọi, đúng thứ tự đã nghiệm thu:
 *
 *   1. `POST /api/v3/profile/quick` với `automation: 'playwright'`
 *   2. poll `GET /api/v1/profile/quick/statuses` để lấy cổng debug
 *   3. `GET /api/v1/profile/stop/p/:id` — dừng ĐÚNG một profile, không stop-all
 *
 * ĐO ĐƯỢC: launcher không trả cổng trong phản hồi của bước 1, và chỉ publish
 * cổng cho lượt start có `automation` type. Vì vậy bước 2 là bắt buộc, và
 * `port: null` ở bước 1 là bình thường chứ không phải lỗi.
 *
 * VÌ SAO KHÔNG GỌI THẲNG `MultiloginBrowserRuntime.startProfile`: hàm đó chỉ trả
 * về khi cổng đã hiện, tức là khi Chrome đã khởi động xong — lúc đó bơm
 * `Preferences` là vô ích (Chrome nạp file lúc khởi động, xem `../prefs.ts`).
 * Launcher này cần đúng khoảng giữa bước 1 và bước 2 để chen prefs vào.
 * =============================================================================
 */

import type { Browser } from 'playwright-core';

import { ProviderError } from '../../../providers/ProviderError';
import {
  MULTILOGIN_SERVICE_NAME,
  type MultiloginProxyConnection,
  type StartQuickProfileParams
} from '../../../providers/MultiloginProvider';
import {
  MULTILOGIN_AUTOMATION_TYPE,
  type MultiloginQuickProfileApi,
  type MultiloginTokenSource
} from '../../browserRuntime';
import { seedPreferences } from '../prefs';
import { checkRendererHealth } from '../rendererHealth';
import { withinDeadline, OperationDeadlineError } from '../cancellation';
import {
  ProfileStopError,
  type ProfileStopDiagnostic,
  type ProfileStopObservation,
  type StopOptions
} from './ProfileStopError';
import {
  attachOverCdp,
  defaultSleep,
  NO_LAUNCHER_LOG,
  type BrowserLauncher,
  type LauncherLog,
  type LauncherProxy,
  type LaunchedProfile,
  type LaunchOptions
} from './BrowserLauncher';

/** Cùng ngưỡng với `MultiloginBrowserRuntime` để hai đường chờ giống nhau. */
const DEFAULT_PORT_TIMEOUT_MS = 30_000;
const DEFAULT_PORT_POLL_INTERVAL_MS = 1_000;

export interface ApiV3LauncherOptions {
  log?: LauncherLog;
  /** Tổng thời gian chờ launcher publish cổng debug. */
  portTimeoutMs?: number;
  portPollIntervalMs?: number;
  /** Số lần thử `connectOverCDP` sau khi đã có cổng. */
  connectAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** UI cấp proxy dạng `ProxyInfo` (port là string); API v3 cần port dạng số. */
function toProxyConnection(proxy: LauncherProxy): MultiloginProxyConnection {
  const port = Number(proxy.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new ProviderError(
      'CONFIG_ERROR',
      'Proxy không hợp lệ: cổng phải là số.',
      MULTILOGIN_SERVICE_NAME
    );
  }

  const connection: MultiloginProxyConnection = {
    host: proxy.host,
    port,
    type: proxy.scheme || 'socks5'
  };
  if (proxy.username) connection.username = proxy.username;
  if (proxy.password) connection.password = proxy.password;
  return connection;
}

interface StoppingOperation {
  readonly promise: Promise<void>;
  readonly observers: Set<(obs: ProfileStopObservation) => void>;
  latestObservation: ProfileStopObservation;
}

export class ApiV3Launcher implements BrowserLauncher {
  readonly name = 'api-v3' as const;

  private readonly log: LauncherLog;
  private readonly portTimeoutMs: number;
  private readonly portPollIntervalMs: number;
  private readonly connectAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Handle CDP theo profileId — `stop()` nhả nó trước khi gọi API dừng profile. */
  private readonly attached = new Map<string, Browser>();
  private readonly stopping = new Map<string, StoppingOperation>();

  /**
   * `auth` và `api` được INJECT: `MultiloginAuthService` giữ vòng đời token,
   * `MultiloginProvider` giữ phần HTTP. Launcher không tự `new` cái nào — nhờ
   * vậy nó dùng đúng token đã cache của app và test được bằng fake.
   */
  constructor(
    private readonly auth: MultiloginTokenSource,
    private readonly api: MultiloginQuickProfileApi,
    options: ApiV3LauncherOptions = {}
  ) {
    this.log = options.log ?? NO_LAUNCHER_LOG;
    this.portTimeoutMs = options.portTimeoutMs ?? DEFAULT_PORT_TIMEOUT_MS;
    this.portPollIntervalMs = options.portPollIntervalMs ?? DEFAULT_PORT_POLL_INTERVAL_MS;
    this.connectAttempts = options.connectAttempts ?? 14;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Chờ launcher publish cổng debug của ĐÚNG profile này.
   *
   * Lỗi khi đọc statuses không kết luận ngay là thất bại: cứ thử lại tới hết
   * hạn, vì launcher agent có lúc trả 5xx trong lúc browser đang bật.
   */
  private async resolvePort(
    token: string,
    profileId: string,
    signal?: AbortSignal
  ): Promise<number | null> {
    const attempts = Math.max(1, Math.ceil(this.portTimeoutMs / this.portPollIntervalMs));
    const deadline = Date.now() + this.portTimeoutMs;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      signal?.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const statuses = await withinDeadline(this.api.getQuickProfileStatuses(token, remaining), remaining, signal)
        .catch(() => { signal?.throwIfAborted(); return null; });
      const own = statuses?.find((entry) => entry.profileId === profileId);
      if (own?.port) return own.port;

      if (attempt < attempts - 1) {
        await this.wait(this.portPollIntervalMs, signal);
      }
    }

    return null;
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([this.sleep(ms), aborted]).finally(() => {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    });
  }

  async launch(opts: LaunchOptions): Promise<LaunchedProfile> {
    opts.signal?.throwIfAborted();
    const token = await this.auth.getAccessToken();
    opts.signal?.throwIfAborted();

    const params: StartQuickProfileParams = {
      isHeadless: opts.headless ?? false,
      automation: MULTILOGIN_AUTOMATION_TYPE
    };
    if (opts.proxy) {
      params.proxy = toProxyConnection(opts.proxy);
    }

    this.log('   → Đang khởi chạy Multilogin quick profile qua API v3...');
    const profile = await this.api.startQuickProfile(token, params);
    const profileId = profile.profileId;
    const ownershipHandedOff = Boolean(opts.onProfileStarted);
    opts.onProfileStarted?.(profileId);
    this.log(`   ✅ Profile đã tạo (ID: ${profileId}, ${profile.browserType})`);

    try {
      opts.signal?.throwIfAborted();
      // Tắt dialog "Save password" — nó là UI của browser, nằm ngoài DOM nên
      // không click hay ẩn được, và nó che modal Upgrade khi soi giao diện.
      // Phải bơm Preferences TRƯỚC khi Chrome khởi động xong (xem ../prefs.ts).
      //
      // Khoảng chen ở đường này rộng hơn đường xcli: bước start trả về trước
      // khi browser bật xong (cổng còn chưa có). Thư mục profile do CÙNG launcher
      // agent tạo nên vẫn là `~/mlx/profiles/<ws>/<folder>/<profileId>`, nhưng
      // riêng đường api-v3 thì chưa đo tay được — `seedPreferences` trả false là
      // chuyện không chặn lượt chạy, chỉ mất phần tắt dialog.
      if (await seedPreferences(profileId)) {
        this.log('   ✓ Đã tắt dialog lưu mật khẩu');
      }

      const port = profile.port ?? (await this.resolvePort(token, profileId, opts.signal));
      if (!port) {
        throw new ProviderError(
          'NETWORK_ERROR',
          'Multilogin không publish cổng debug cho quick profile sau ' +
            Math.round(this.portTimeoutMs / 1000) +
            ' giây.',
          MULTILOGIN_SERVICE_NAME
        );
      }

      const attachment = await attachOverCdp(port, {
        headless: opts.headless ?? false,
        attempts: this.connectAttempts,
        log: this.log,
        sleep: this.sleep,
        signal: opts.signal,
        ui: opts.ui
      });
      this.attached.set(profileId, attachment.browser);
      await checkRendererHealth(attachment.page, {
        signal: attachment.signal,
        log: this.log,
        ui: attachment.ui
      });

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
   * Multilogin. Ở đây nó chỉ là bước ngắt kết nối cho gọn; thứ thật sự thu hồi
   * profile là lời gọi `/profile/stop/p/:id` ngay sau đó — nếu thiếu, launcher
   * vẫn coi profile là đang chạy.
   */
  async stop(profileId: string, options?: StopOptions): Promise<void> {
    if (!profileId) return;

    const existing = this.stopping.get(profileId);
    if (existing) {
      if (options?.onPhase) {
        existing.observers.add(options.onPhase);
        try {
          options.onPhase(existing.latestObservation);
        } catch {
          // Guard observer callbacks
        }
      }
      return existing.promise;
    }

    const observers = new Set<(obs: ProfileStopObservation) => void>();
    if (options?.onPhase) {
      observers.add(options.onPhase);
    }

    let opResolve!: () => void;
    let opReject!: (reason: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      opResolve = resolve;
      opReject = reject;
    });

    const operation: StoppingOperation = {
      promise,
      observers,
      latestObservation: { phase: 'token', remoteConfirmed: false }
    };
    this.stopping.set(profileId, operation);

    let remoteConfirmed = false;
    const emit = (phase: ProfileStopObservation['phase'], confirmed?: boolean): void => {
      if (confirmed !== undefined) {
        remoteConfirmed = remoteConfirmed || confirmed;
      }
      this.emitObservation(operation, { phase, remoteConfirmed });
    };

    emit('token');

    const execute = async (): Promise<void> => {
      let token: string;
      try {
        token = await this.auth.getAccessToken();
      } catch (error) {
        throw this.toProfileStopError('token', error, profileId, remoteConfirmed);
      }

      emit('stop-request');
      try {
        await withinDeadline(this.api.stopProfile(token, profileId, 10_000), 10_000);
      } catch (error) {
        this.safeLog(`Không dừng được profile ${profileId}.`);
        throw this.toProfileStopError('stop-request', error, profileId, remoteConfirmed);
      }

      emit('confirm-status');
      try {
        const deadline = Date.now() + 5000;
        for (;;) {
          if (Date.now() >= deadline) throw new Error('Profile stop confirmation timed out');
          const remaining = deadline - Date.now();
          const statuses = await withinDeadline(this.api.getQuickProfileStatuses(token, remaining), remaining);
          const own = statuses.find((entry) => entry.profileId === profileId);
          if (!own || own.status === 'stopped') break;
          await this.sleep(250);
        }
        remoteConfirmed = true;
        this.safeLog(`Đã dừng profile ${profileId}`);
      } catch (error) {
        this.safeLog(`Không xác nhận được trạng thái dừng của profile ${profileId}.`);
        throw this.toProfileStopError('confirm-status', error, profileId, remoteConfirmed);
      }

      emit('cdp-close', true);
      const browser = this.attached.get(profileId);
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          throw this.toProfileStopError('cdp-close', error, profileId, remoteConfirmed);
        }
      }
      this.attached.delete(profileId);
    };

    execute().then(
      () => opResolve(),
      (err) => opReject(err)
    ).finally(() => {
      if (this.stopping.get(profileId) === operation) this.stopping.delete(profileId);
    });

    return operation.promise;
  }

  private safeLog(msg: string): void {
    try {
      this.log(msg);
    } catch {
      // Guard log reporter from throwing during stop observation
    }
  }

  private emitObservation(operation: StoppingOperation, obs: ProfileStopObservation): void {
    operation.latestObservation = obs;
    for (const observer of operation.observers) {
      try {
        observer(obs);
      } catch {
        // Guard observer callbacks
      }
    }
  }

  private toProfileStopError(
    phase: ProfileStopDiagnostic['phase'],
    error: unknown,
    profileId: string,
    remoteConfirmed?: boolean
  ): ProfileStopError {
    if (error instanceof ProfileStopError) {
      if (remoteConfirmed && !error.diagnostic.remoteConfirmed) {
        return new ProfileStopError(
          { ...error.diagnostic, remoteConfirmed: true },
          error.cause,
          error.message
        );
      }
      return error;
    }

    let kind: ProfileStopDiagnostic['kind'] = 'unexpected';
    let providerCode: string | undefined;
    let httpStatus: number | undefined;

    if (error instanceof ProviderError) {
      kind = 'provider-error';
      providerCode = error.code;
      httpStatus = error.httpStatus;
    } else if (error instanceof OperationDeadlineError) {
      kind = phase === 'confirm-status' ? 'confirmation-timeout' : 'deadline';
    } else if (error instanceof Error && error.message.includes('Profile stop confirmation timed out')) {
      kind = 'confirmation-timeout';
    }

    return new ProfileStopError(
      {
        phase,
        kind,
        providerCode,
        httpStatus,
        ...(remoteConfirmed !== undefined ? { remoteConfirmed } : {})
      },
      error,
      `Không dừng được Multilogin profile ${profileId}.`
    );
  }
}

