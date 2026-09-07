/**
 * =============================================================================
 * CAPCUT ENGINE SERVICE — chỗ nối engine automation vào vòng đời một luồng
 * =============================================================================
 * `AutomationRunService` mở profile, xin proxy, rồi giao lại một phiên Playwright
 * đang sống. File này là tất cả những gì xảy ra bên trong phiên đó:
 *
 *   vào app (đăng nhập / đăng ký) → đọc cổng ưu đãi Pro → làm nhiệm vụ
 *
 * Ranh giới cố ý giữ chặt (xem `docs/MERGE-PLAN.md` §3):
 *   - KHÔNG tự mở/tắt profile, KHÔNG tự xin proxy, KHÔNG đọc SQLite.
 *   - KHÔNG `console.log`: mọi dòng đi qua `log()` được inject nên `LogBus` gắn
 *     được `accountId` (AGENTS.md §16).
 *   - KHÔNG tự kết luận nhiệm vụ nào xong: con số trả về đến từ snapshot
 *     `task_list` của chính CapCut (xem `docs/AUTOMATION-ENGINE.md` §3).
 *   - KHÔNG đọc/ghi SQLite: file này chỉ RÚT tiến độ từng nhiệm vụ thành DTO
 *     (`CapcutAccountResult.tasks`); `AutomationRunService` mới là chỗ đưa nó
 *     xuống repository (AGENTS.md §11).
 * =============================================================================
 */

import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';

import type { CapcutAccountResult, CapcutTaskRunner } from './AutomationRunService';
import { measureStage } from './stageTiming';
import { ensureInApp } from './capcut/auth';
import { setDumpDir } from './capcut/diag';
import { ensureSampleImage } from './capcut/image';
import { PrimaryPageResolver } from './capcut/pageRecovery';
import { runAllTasks, type TaskSnapshotSummary } from './capcut/runTasks';
import { checkProTrial, isEligible, MIN_TRIAL_DAYS } from './capcut/trial';
import type {
  TaskOutcome,
  CapcutPace,
  CapcutFatalCode,
  CapcutUiAccountResult,
  CapcutVerificationReceipt,
  TaskCheckpoint,
  UnsettledTaskProof,
  AccountUiInteraction
} from './capcut/types';
import { isDomReadTimeout } from './capcut/cancellation';
import { attachRedactedHttpCapture, type CaptureController } from './capcut/httpCapture';
import { CapcutHttpClient } from './capcut/http/CapcutHttpClient';
import { CapcutHttpTaskApi } from './capcut/http/taskApi';
import { attachPrivateCapture } from './capcut/http/privateCapture';

/**
 * Từ `outcomes` + `snapshot` của `runAllTasks` thành các dòng tiến độ để lưu DB.
 *
 * `status` sao chép CHÍNH XÁC từ `snapshot.tasks` (1, 2, hoặc 4).
 * `opId`/`provedAt` chỉ có khi `do_action` bắn TRONG lượt này (`outcome.proof`).
 * Không suy diễn row cho nhiệm vụ không có trong snapshot.
 */
export function toTaskProgressRows(
  outcomes: TaskOutcome[],
  snapshot: TaskSnapshotSummary
): CapcutAccountResult['tasks'] {
  const outcomesByKey = new Map(outcomes.map((o) => [o.key, o]));
  if (snapshot.tasks && snapshot.tasks.length > 0) {
    return snapshot.tasks.map((task) => {
      const outcome = outcomesByKey.get(task.key);
      const row: CapcutAccountResult['tasks'][number] = {
        key: task.key,
        title: task.title,
        reward: task.reward,
        status: task.status
      };
      if (outcome?.proof) {
        row.opId = outcome.proof.opId;
        row.provedAt = new Date(outcome.proof.at).toISOString();
      }
      return row;
    });
  }

  // Fallback for legacy fixtures without snapshot.tasks
  const missing = new Set(snapshot.missing ?? []);
  return outcomes.map((outcome) => {
    const row: CapcutAccountResult['tasks'][number] = {
      key: outcome.key,
      title: outcome.title,
      reward: outcome.reward,
      status: missing.has(outcome.key) ? 1 : 4
    };
    if (outcome.proof) {
      row.opId = outcome.proof.opId;
      row.provedAt = new Date(outcome.proof.at).toISOString();
    }
    return row;
  });
}

export interface CapcutEngineOptions {
  /** `app.getPath('userData')`. Hiện trường và ảnh mẫu đều nằm dưới đây. */
  userDataDir: string;
  /**
   * Bỏ qua account không có ưu đãi Pro ≥ 7 ngày.
   *
   * Mặc định **false**: engine CLI bỏ qua, nhưng trong app thì bỏ qua âm thầm là
   * mất account, và UI chưa có ô bật/tắt. Cổng trial vẫn **fail-open** — đọc
   * không được thì coi như đủ điều kiện, vì lượt 02/09/2026 chứng minh rằng
   * fail-closed sẽ âm thầm loại cả 21 account khi selector vỡ.
   */
  skipWithoutTrial?: boolean;
  /** Nguồn OTP cho đường đăng ký; app nối vào `EmailPurchaseService`. */
  getOtp?: (email: string) => Promise<string>;
}

export class CapcutEngineService implements CapcutTaskRunner {
  constructor(private readonly options: CapcutEngineOptions) {
    // Hiện trường phải ra ngoài cwd: app đóng gói không ghi được vào cwd.
    setDumpDir(path.join(options.userDataDir, 'debug'));
  }

  async runAccount(input: {
    page: Page;
    context: BrowserContext;
    email: string;
    password: string;
    accountId: string;
    /**
     * true khi email của luồng vừa được thuê/mua ⇒ CapCut chưa có account nào
     * dùng địa chỉ đó. Dịch thẳng thành `forceSignup` của `ensureInApp`.
     *
     * Không có cờ này thì `looksExisting({ source: 'db' })` luôn trả true và mọi
     * account mới vẫn bị thử ĐĂNG NHẬP trước: `loginCapcut` chạy tới heading
     * "Create an account" rồi ném lỗi, `capcut/auth.ts` bắt, rồi mới quay lại
     * đăng ký — mất ~60 giây và in một dòng lỗi giả cho mỗi account mới.
     */
    isNewAccount: boolean;
    getOtp?: () => Promise<string>;
    /**
     * `retryCount` của Dashboard. Engine quét lại toàn bộ nhiệm vụ còn thiếu theo
     * LƯỢT, nên map thành số lượt quét: `1 + retryCount`, chặn trên ở 4 để một
     * account hỏng không giữ profile cả tiếng.
     */
    maxRounds?: number;
    /**
     * Hai ô "Delay thao tác" / "Delay gõ phím" của Dashboard. CHỈ làm chậm thêm:
     * nhịp gõ bị kẹp lên trên sàn `45–130ms` trong `humanType`, còn `stepMinMs/
     * stepMaxMs` chỉ sinh khoảng nghỉ THÊM giữa các nhóm nhiệm vụ và giữa hai
     * lượt quét. Lý do có sàn: Shark Risk Control chấm điểm độ trễ phím, gõ
     * nhanh hơn khoảng đã đo thì thưởng trả `err_no 8001003`.
     */
    pace?: CapcutPace;
    /**
     * Ô "Bỏ qua account không có trial" của Dashboard, ưu tiên hơn
     * `options.skipWithoutTrial` lúc dựng service. Trước đây chỉ có đường
     * `options` mà không ai truyền nên cờ luôn `false` (audit 04/09/2026).
     */
    skipWithoutTrial?: boolean;
    signal: AbortSignal;
    log: (status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', step: string, message: string) => void;
    runId?: string;
    sessionAlias?: string;
    sessionStartedAt?: number;
    unsettledProofs?: readonly UnsettledTaskProof[];
    ui?: AccountUiInteraction;
    onTaskCheckpoint?: (checkpoint: {
      rows: CapcutAccountResult['tasks'];
      receipt: CapcutVerificationReceipt;
    }) => Promise<void>;
  }): Promise<CapcutUiAccountResult> {
    input.signal.throwIfAborted();
    const { context, email, password, log } = input;
    const privateCapture = process.env.CAPCUT_CAPTURE_PRIVATE === '1'
      ? await (async () => {
        const { safeStorage } = await import('electron');
        if (!safeStorage.isEncryptionAvailable()) throw new Error('PRIVATE_CAPTURE_ENCRYPTION_UNAVAILABLE');
        return attachPrivateCapture(context, path.join(this.options.userDataDir, 'captures-private', input.accountId + '.enc'), text => safeStorage.encryptString(text));
      })()
      : null;
    const capture: CaptureController | null = process.env.CAPCUT_CAPTURE_HTTP === '1'
      ? attachRedactedHttpCapture(context, path.join(this.options.userDataDir, 'captures', input.accountId + '.ndjson'))
      : null;
    const captureStage = (stage: string) => { capture?.mark(stage); privateCapture?.mark(stage); };
    captureStage('signup');

    try {

    const resolver = new PrimaryPageResolver(
      context,
      input.page,
      (message) => log('WARNING', 'Browser', message)
    );
    let page = await resolver.resolve('authentication');
    input.signal.throwIfAborted();

    // OTP của riêng luồng này (đường đăng ký) ưu tiên hơn nguồn cấu hình chung.
    const getOtp = input.getOtp
      ? async (_email: string): Promise<string> => (input.getOtp as () => Promise<string>)()
      : this.options.getOtp;

    const auth = await measureStage(
      'authentication-otp',
      () =>
        ensureInApp(
          page,
          context,
          { email, password, source: 'db' },
          {
            // `source: 'db'` giữ nguyên để nhánh fallback (đăng ký → email đã tồn tại
            // → đăng nhập) không đổi; `forceSignup` mới là thứ chọn đường ĐI TRƯỚC.
            forceSignup: input.isNewAccount,
            log: (m) => log('INFO', 'Đăng nhập', m),
            getOtp,
            ui: input.ui,
            signal: input.signal
          }
        ),
      (m) => log('INFO', 'Đăng nhập', m)
    );
    captureStage('authenticated');
    if (process.env.CAPCUT_HTTP_DISCOVERY_ONLY === '1') {
      log('INFO', 'HTTP', 'HTTP discovery-only: authenticated session captured; skipping task mutations.');
      return {
        authenticated: true,
        done: 0,
        total: 0,
        credits: 0,
        creditsTotal: 0,
        missing: [],
        tasks: [],
        subscription: 'discovery-only',
        verification: null,
        unsettledProofs: []
      };
    }
    input.signal.throwIfAborted();
    log('SUCCESS', 'Đăng nhập', `Đã ở trong app (đường: ${auth.mode})`);

    page = await resolver.resolve('trial');
    input.signal.throwIfAborted();
    const trial = await measureStage(
      'trial-check',
      () => checkProTrial(page, context, (m) => log('INFO', 'Ưu đãi', m), input.ui, input.signal),
      (m) => log('INFO', 'Ưu đãi', m)
    );
    input.signal.throwIfAborted();
    /**
     * Câu để hiển thị, không phải object: `accounts.subscription` là một `string`
     * (AGENTS.md §15) và cột Subscription của bản xuất đọc thẳng từ đó.
     */
    const subscription = isEligible(trial)
      ? 'Pro trial ' + (trial.days || MIN_TRIAL_DAYS) + ' ngày'
      : 'Không có ưu đãi';
    if (isEligible(trial)) {
      log('INFO', 'Ưu đãi', `Có trial Pro ${trial.days || MIN_TRIAL_DAYS} ngày`);
    } else if (input.skipWithoutTrial ?? this.options.skipWithoutTrial) {
      log('WARNING', 'Ưu đãi', 'Không có ưu đãi dùng thử — bỏ qua account này theo cấu hình');
      return {
        authenticated: true,
        done: 0,
        total: 0,
        credits: 0,
        creditsTotal: 0,
        missing: [],
        skipped: true,
        tasks: [],
        subscription,
        verification: null,
        unsettledProofs: []
      };
    } else {
      log('WARNING', 'Ưu đãi', 'Không có ưu đãi dùng thử — vẫn chạy nhiệm vụ');
    }

    const sampleImage = ensureSampleImage(
      path.join(this.options.userDataDir, 'assets'),
      undefined,
      (m) => log('INFO', 'Nhiệm vụ', m)
    );

    const sessionStartedAt = input.sessionStartedAt ?? Date.now();
    const runResult = await runAllTasks({
      page,
      context,
      sampleImage,
      signal: input.signal,
      ui: input.ui,
      maxRounds: input.maxRounds,
      pace: input.pace,
      log: (m) => log('INFO', 'Nhiệm vụ', m),
      resolvePage: (stage) => {
        input.signal.throwIfAborted();
        return resolver.resolve(stage);
      },
      captureStage,
      httpTaskApi: process.env.CAPCUT_HTTP_TASK_LIST === '1'
        ? new CapcutHttpTaskApi(new CapcutHttpClient(
          page,
          'https://edit-api-sg.capcut.com',
          process.env.CAPCUT_HTTP_DIRECT === '1' ? page.context().request : undefined
        ), process.env.CAPCUT_HTTP_DIRECT === '1' ? 'direct-http' : 'browser-http')
        : undefined,
      httpStrict: process.env.CAPCUT_HTTP_STRICT === '1',
      runId: input.runId,
      sessionAlias: input.sessionAlias,
      sessionStartedAt,
      unsettledProofs: input.unsettledProofs,
      onCheckpoint: async (checkpoint: TaskCheckpoint) => {
        if (!input.onTaskCheckpoint) return;
        const rows = toTaskProgressRows(checkpoint.outcomes, checkpoint.snapshot);
        const obsAt = checkpoint.snapshot.observedAt ?? Date.now();
        const reqAfter = checkpoint.snapshot.requiredAfter ?? sessionStartedAt;
        const receipt: CapcutVerificationReceipt = {
          runId: input.runId ?? 'run-local',
          sessionAlias: input.sessionAlias ?? 'session-1',
          observedAt: new Date(obsAt).toISOString(),
          requiredAfter: new Date(reqAfter).toISOString(),
          fresh: checkpoint.snapshot.fresh ?? true,
          final: checkpoint.snapshot.final ?? (checkpoint.snapshot.done === checkpoint.snapshot.total && checkpoint.snapshot.total > 0 && checkpoint.snapshot.missing.length === 0),
          serverTotal: checkpoint.snapshot.total,
          serverDone: checkpoint.snapshot.done,
          complete: checkpoint.snapshot.done === checkpoint.snapshot.total &&
            checkpoint.snapshot.total > 0 &&
            checkpoint.snapshot.missing.length === 0
        };
        await input.onTaskCheckpoint({ rows, receipt });
      }
    });

    const { outcomes, snapshot } = runResult;
    if (!snapshot) {
      // Không có snapshot thì KHÔNG được suy ra "xong" — thà báo lỗi rõ.
      throw new Error('Không đọc được task_list của CapCut nên không thể xác nhận kết quả.');
    }

    const observedAtMs = snapshot.observedAt ?? Date.now();
    const requiredAfterMs = snapshot.requiredAfter ?? sessionStartedAt;
    const receipt: CapcutVerificationReceipt = {
      runId: input.runId ?? 'run-local',
      sessionAlias: input.sessionAlias ?? 'session-1',
      observedAt: new Date(observedAtMs).toISOString(),
      requiredAfter: new Date(requiredAfterMs).toISOString(),
      fresh: snapshot.fresh ?? true,
      final: snapshot.final ?? (snapshot.done === snapshot.total && snapshot.total > 0 && snapshot.missing.length === 0),
      serverTotal: snapshot.total,
      serverDone: snapshot.done,
      complete: snapshot.done === snapshot.total &&
        snapshot.total > 0 &&
        snapshot.missing.length === 0
    };

    const fatalCode: CapcutFatalCode | undefined = runResult.fatalError && isDomReadTimeout(runResult.fatalError)
      ? 'DOM_READ_TIMEOUT'
      : undefined;

    return {
      authenticated: true,
      done: snapshot.done,
      total: snapshot.total,
      credits: snapshot.credits,
      creditsTotal: snapshot.creditsTotal,
      missing: snapshot.missing,
      tasks: toTaskProgressRows(outcomes, snapshot),
      subscription,
      verification: receipt,
      ...(fatalCode ? { fatalCode } : {}),
      ...(runResult.fatalError ? { fatalError: runResult.fatalError.message } : {}),
      unsettledProofs: runResult.unsettledProofs ?? []
    };
    } finally {
      await capture?.stop();
      await privateCapture?.stop();
    }
  }
}
