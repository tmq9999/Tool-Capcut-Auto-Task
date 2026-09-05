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
import type { TaskOutcome, CapcutPace } from './capcut/types';

/**
 * `task_status` của CHÍNH CapCut, không phải cờ nội bộ (xem `capcut/taskApi.ts`):
 * 1 = chưa xong · 2 = chờ nhận · 4 = đã xong.
 */
const CAPCUT_STATUS_OPEN = 1;
const CAPCUT_STATUS_DONE = 4;

/**
 * Từ `outcomes` + `snapshot` của `runAllTasks` thành các dòng tiến độ để lưu DB.
 *
 * `status` KHÔNG lấy từ `outcome.done`: cờ đó là bộ đếm nội bộ của engine, và bộ
 * đếm nội bộ đã đo được là báo THỪA (`capcut/runTasks.ts`, chú thích `summarize`).
 * Nguồn duy nhất được chấp nhận là snapshot `task_list` của CapCut, mà phần
 * snapshot đi ra khỏi engine chỉ mang danh sách `missing` — nên: có trong
 * `missing` ⇒ 1, còn lại ⇒ 4.
 *
 * Hệ quả đã biết và cố ý chấp nhận: trạng thái trung gian `2` (chờ nhận) bị gộp
 * vào `1`. `TaskSnapshotSummary` không mang `task_status` từng nhiệm vụ, và
 * `services/capcut/` là vùng đã nghiệm thu — không sửa ở pha này (AGENTS.md §30).
 * Ghi `1` là phía AN TOÀN: lượt sau sẽ làm lại nhiệm vụ đó thay vì bỏ qua oan.
 *
 * `opId`/`provedAt` chỉ có khi `do_action` bắn TRONG lượt này (`outcome.proof`).
 * Nhiệm vụ đã xong từ lượt trước quay lại với `status = 4` mà không có proof —
 * repository dùng `COALESCE` nên bằng chứng cũ trong DB không bị xoá.
 */
export function toTaskProgressRows(
  outcomes: TaskOutcome[],
  snapshot: TaskSnapshotSummary
): CapcutAccountResult['tasks'] {
  const missing = new Set(snapshot.missing);

  return outcomes.map((outcome) => {
    /**
     * `do_action err_no=0` bắt được TRONG lượt này chỉ thắng snapshot khi snapshot
     * đã CŨ (`stale`).
     *
     * Đo 04/09/2026 06:5x: tab chính của CapCut chết giữa lượt, nên lần đọc
     * `task_list` cuối rơi về snapshot ĐẦU TIÊN và báo cáo in
     * "CapCut ghi nhận: 0/12" trong khi 3 nhiệm vụ đã có `do_action err_no=0`.
     * Ghi status 1 cho chúng là xoá tiến độ THẬT khỏi DB và lượt sau làm lại.
     *
     * Snapshot còn TƯƠI thì nó vẫn thắng: một proof mà CapCut vừa đọc lại vẫn
     * liệt vào `missing` nghĩa là CapCut không tính — không được suy diễn hộ nó.
     * Bước đọc lại `task_status` là xác nhận thứ hai của AGENTS.md §30; chỉ khi
     * bước đó KHÔNG CÒN TỒN TẠI mới lùi về bằng chứng đã có.
     */
    const proven = snapshot.stale === true && outcome.proof?.errNo === 0;
    const row: CapcutAccountResult['tasks'][number] = {
      key: outcome.key,
      title: outcome.title,
      reward: outcome.reward,
      status: missing.has(outcome.key) && !proven ? CAPCUT_STATUS_OPEN : CAPCUT_STATUS_DONE
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
  }): Promise<CapcutAccountResult> {
    input.signal.throwIfAborted();
    const { context, email, password, log } = input;

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
            getOtp
          }
        ),
      (m) => log('INFO', 'Đăng nhập', m)
    );
    input.signal.throwIfAborted();
    log('SUCCESS', 'Đăng nhập', `Đã ở trong app (đường: ${auth.mode})`);

    page = await resolver.resolve('trial');
    input.signal.throwIfAborted();
    const trial = await measureStage(
      'trial-check',
      () => checkProTrial(page, context, (m) => log('INFO', 'Ưu đãi', m)),
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
      // Bỏ qua thì chưa đọc được nhiệm vụ nào, nên không có dòng tiến độ nào để
      // ghi — trả mảng rỗng chứ KHÔNG phải "0 nhiệm vụ đã xong".
      return {
        done: 0, total: 0, credits: 0, creditsTotal: 0, missing: [],
        skipped: true, tasks: [], subscription
      };
    } else {
      log('WARNING', 'Ưu đãi', 'Không có ưu đãi dùng thử — vẫn chạy nhiệm vụ');
    }

    const sampleImage = ensureSampleImage(
      path.join(this.options.userDataDir, 'assets'),
      undefined,
      (m) => log('INFO', 'Nhiệm vụ', m)
    );

    const { outcomes, snapshot } = await runAllTasks({
      page,
      context,
      sampleImage,
      signal: input.signal,
      maxRounds: input.maxRounds,
      pace: input.pace,
      log: (m) => log('INFO', 'Nhiệm vụ', m),
      resolvePage: (stage) => {
        input.signal.throwIfAborted();
        return resolver.resolve(stage);
      }
    });

    if (!snapshot) {
      // Không có snapshot thì KHÔNG được suy ra "xong" — thà báo lỗi rõ.
      throw new Error('Không đọc được task_list của CapCut nên không thể xác nhận kết quả.');
    }

    return {
      done: snapshot.done,
      total: snapshot.total,
      credits: snapshot.credits,
      creditsTotal: snapshot.creditsTotal,
      missing: snapshot.missing,
      tasks: toTaskProgressRows(outcomes, snapshot),
      subscription
    };
  }
}
