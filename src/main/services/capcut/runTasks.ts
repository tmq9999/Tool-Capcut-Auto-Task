/**
 * =============================================================================
 * TASKS — ĐIỀU PHỐI 12 NHIỆM VỤ FREE CREDITS
 * =============================================================================
 * Bản này bỏ hoàn toàn tầng "đi tìm nút Claim". Lượt capture làm tay 12/12
 * nhiệm vụ (`.capture/2026-09-01-21-50-27/`) cho thấy trong 2986 request KHÔNG
 * có lần gọi `grant_reward` nào: CapCut tự cấp thưởng khi client bắn
 * `POST /task/v1/do_action`, và `task_status` nhảy thẳng 1→4.
 *
 * Nên tiêu chí thành công ở đây là bằng chứng, không phải suy đoán DOM:
 *   `do_action` đúng `action_key` với `err_no === 0`, rồi đối chiếu `task_status`.
 *
 * Đã xoá so với bản cũ: `claimAndVerify`, `taskRowLocator`, `findState`,
 * `readTaskStates`, `ensurePopoverOpen`, `expandAllGroups`,
 * `attachGrantRewardMonitor`, hằng `SEL`, `STAGES`, và cờ `sessionExecuted`
 * (cờ này được đặt TRƯỚC khi biết kết quả nên lần thử 2 luôn là no-op).
 *
 * Đã xoá khi port vào app — chúng chỉ phục vụ CLI: `printReport`,
 * `reportTaskStatus`, `runFlowsForced`, `readCredits`. Số tổng kết giờ đi ra
 * ngoài bằng `RunTasksResult`, và vẫn lấy từ snapshot của CHÍNH CapCut nên
 * không thể báo thừa như con số "7/10" của bản cũ. Mọi dòng log đi qua
 * `input.log` (LogBus), engine không được `console.log` (AGENTS.md §16).
 * =============================================================================
 */

import type { BrowserContext, Page } from 'playwright-core';

import { attachNetDiag, dump, StepError } from './diag';
import { rand, sleep } from './human';
import {
  claimIfPending,
  runGroup,
  selectGroups,
  withTaskPopover,
} from './missionRunner';
import { designStudioGroup } from './missions/designStudio';
import { notificationsGroup, pwaInstallGroup } from './missions/simple';
import { videoStudioGroup } from './missions/videoStudio';
import { attachTaskMonitor, TaskStore, type TaskSnapshot } from './taskApi';
import type { CapcutMissionEnv, CapcutPace, MissionGroup, TaskOutcome } from './types';
import { URLS } from './urls';
import { abortable } from './cancellation';
import { measureStage } from '../stageTiming';

/**
 * Thứ tự theo đúng lượt làm tay: hai nhiệm vụ "miễn phí" trước để có credits,
 * rồi Design Studio (4 nhiệm vụ một phiên), rồi Video Studio (3 nhiệm vụ).
 */
const GROUPS: MissionGroup[] = [
  pwaInstallGroup,
  notificationsGroup,
  designStudioGroup,
  videoStudioGroup,
];

/** Lần 2 giờ thật sự chạy lại, vì không còn cờ chặn nào. */
const MAX_ATTEMPTS = 2;

export const INTER_ROUND_WAIT_MS = 8_000;
export const FINAL_SNAPSHOT_WAIT_MS = 10_000;
export const BOOTSTRAP_DEADLINE_MS = 30_000;

export interface RunTasksInput {
  page: Page;
  context: BrowserContext;
  /** Đường dẫn ảnh PNG thật để upload; người gọi truyền, KHÔNG tự đoán cwd. */
  sampleImage: string;
  log: (msg: string) => void;
  signal: AbortSignal;
  /** Số lượt thử lại cả vòng nhiệm vụ. Engine dùng 2. */
  maxRounds?: number;
  /**
   * Nhịp người dùng đặt ở Dashboard. Chỉ LÀM CHẬM THÊM: nhịp gõ đi xuống
   * `humanType` (có sàn `45–130ms`), còn `stepMinMs/stepMaxMs` chỉ sinh khoảng
   * nghỉ THÊM giữa các bước lớn — xem `paceGapMs`.
   */
  pace?: CapcutPace;
  groups?: MissionGroup[];
  resolvePage?: (stage: string) => Promise<Page>;
}

async function waitForDelay(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Khoảng nghỉ THÊM giữa hai bước lớn, tính bằng ms; `0` nghĩa là không nghỉ.
 *
 * Chỉ áp ở hai chỗ: sau mỗi `MissionGroup` và giữa hai lượt quét. Các
 * `waitForTimeout(rand(...))` bên trong từng mission KHÔNG bị chạm tới — chúng là
 * thời gian chờ UI đã đo (CapCut render/generate), không phải nhịp người dùng,
 * nên cộng thêm vào đó chỉ làm chậm mà không an toàn hơn.
 *
 * Không có `pace` thì trả `0` để người gọi bỏ qua hẳn — hành vi y như trước.
 */
export function paceGapMs(pace?: CapcutPace): number {
  if (!pace) return 0;
  return Math.round(rand(pace.stepMinMs, pace.stepMaxMs));
}

export interface TaskSnapshotSummary {
  total: number; // số nhiệm vụ account này CÓ
  done: number; // số nhiệm vụ status === 4
  credits: number; // credits đã nhận
  creditsTotal: number; // tổng credits khả dụng
  missing: string[]; // task_key chưa xong
  /**
   * true khi KHÔNG đọc lại được `task_list` ở bước chốt — tab chính chết giữa
   * lượt là nguyên nhân đã đo được (04/09/2026 06:5x). Lúc đó các con số ở trên
   * là của snapshot CŨ, nên người đọc phải ưu tiên `do_action err_no=0` của
   * từng `TaskOutcome` thay vì tin `missing`.
   */
  stale?: boolean;
}

export interface RunTasksResult {
  outcomes: TaskOutcome[];
  snapshot: TaskSnapshotSummary | null;
}

/**
 * Rút snapshot của CapCut thành con số cho app — thay chỗ của `printReport`.
 * Nguyên văn luật của `printReport` giữ lại ở đây vì nó là luật, không phải
 * cách in:
 *
 *   Báo cáo. Con số tổng kết lấy từ snapshot của CapCut, KHÔNG phải từ bộ đếm của
 *   ta — nhờ vậy không thể báo thừa như con số "7/10" của bản cũ.
 *
 * `credits`/`creditsTotal` lấy từ `task_list` (`earnedReward`/`totalReward`),
 * KHÔNG phải từ header. `readCredits` cũ đọc chip credits trong DOM (component
 * rolling digits nhân đôi mỗi chữ số: 520 -> "552200"), nên nó đo SỐ DƯ của
 * account — có cả credits mua/tặng — và không có "tổng" nào để so. Con số của
 * cổng chứng minh phải cùng một nguồn với `task_status`, mà nguồn đó là
 * `task_list`.
 */
function summarize(snap: TaskSnapshot): TaskSnapshotSummary {
  return {
    total: snap.byKey.size,
    done: snap.doneKeys.length,
    credits: snap.earnedReward,
    creditsTotal: snap.totalReward,
    missing: [...snap.byKey.values()].filter((t) => t.status !== 4).map((t) => t.taskKey),
  };
}

/**
 * Chuẩn bị môi trường: monitor + chẩn đoán mạng + snapshot đầu tiên.
 *
 * Route nhiệm vụ → chờ ngắn response tự phát → chủ động mở popover.
 * Toàn bộ dùng một deadline; không reload hoặc điều hướng sau khi hết hạn.
 *
 * Bản trước chỉ `reload()` nếu URL đã ở capcut.com. Sau khi ĐĂNG NHẬP (khác với
 * sau khi đăng ký), trang đích không gọi `task_list`, nên `waitForSnapshot`
 * đứng chờ đủ 60 giây rồi ném — cả 19 account trong batch 2026-09-02 05:56 chết
 * đúng chỗ này.
 *
 * `sampleImage` do NGƯỜI GỌI truyền: đây không còn là chỗ gọi
 * `ensureSampleImage()` nữa vì engine không được đoán cwd — app đóng gói không
 * ghi được vào cwd, main process phải đưa đường dẫn trong
 * `app.getPath('userData')`.
 */
async function bootstrap(
  input: RunTasksInput
): Promise<{ store: TaskStore; env: CapcutMissionEnv; snap: TaskSnapshot }> {
  const page = input.resolvePage
    ? await input.resolvePage('bootstrap')
    : input.page;
  const { context, sampleImage, log } = input;

  const store = new TaskStore();
  attachTaskMonitor(context, store);
  attachNetDiag(context, (m) => log(`   ⚠️  ${m}`));

  const env: CapcutMissionEnv = {
    page,
    context,
    sampleImage,
    log: (message: string) =>
      log(message.startsWith('stage=') ? message : '      · ' + message),
    signal: input.signal,
    // Nhịp gõ đi kèm env để từng mission truyền xuống `fillEditor`; sàn nằm ở
    // `humanType` nên cấu hình nhanh hơn khoảng đã đo không lọt qua được.
    pace: input.pace,
  };

  const deadlineAt = Date.now() + BOOTSTRAP_DEADLINE_MS;
  const remaining = (): number => Math.max(0, deadlineAt - Date.now());
  const tryGet = async (budgetMs: number): Promise<TaskSnapshot | null> => {
    input.signal.throwIfAborted();
    if (store.snapshot()) return store.snapshot();
    if (remaining() === 0) return null;
    return store.waitForSnapshot(0, Math.min(budgetMs, remaining()), input.signal).catch(() => {
      input.signal.throwIfAborted();
      return null;
    });
  };

  log('Mở route nhiệm vụ; deadline bootstrap 30s.');
  input.signal.throwIfAborted();
  await abortable(
    page.goto(URLS.tasks, { waitUntil: 'domcontentloaded', timeout: 12_000 }),
    input.signal
  ).catch(() => { input.signal.throwIfAborted(); });
  let snap = await tryGet(2000);

  if (!snap && remaining() > 0) {
    log('   ℹ️  Chưa thấy task_list — mở popover nhiệm vụ để kích hoạt');
    await withTaskPopover(page, async () => { snap = await tryGet(remaining()); }, log, {
      signal: input.signal,
      deadlineAt
    }).catch(() => { input.signal.throwIfAborted(); });
    snap = store.snapshot();
  }

  if (!snap && remaining() > 1000) {
    log('   ℹ️  Vẫn chưa có — reload trang');
    await abortable(
      page.reload({ waitUntil: 'domcontentloaded', timeout: Math.min(10_000, remaining()) }),
      input.signal
    ).catch(() => { input.signal.throwIfAborted(); });
    snap = await tryGet(remaining());
  }

  if (!snap) {
    throw new StepError(
      'Không nhận được task_list trong deadline bootstrap 30s; kiểm tra phiên đăng nhập và kết nối CapCut.',
      await dump(page, 'no_task_list')
    );
  }

  return { store, env, snap };
}

/**
 * Quét những nhiệm vụ đang kẹt ở `status === 2` và bấm Claim.
 *
 * Có nhiệm vụ mà `do_action` bắn TRƯỚC khi runner kịp chạy: `openSession` cấp
 * quyền notifications ngay lúc mở phiên, CapCut ghi nhận luôn, nên nút đã là
 * "Claim" từ đầu. Với những nhiệm vụ đó `waitForAction(key, t, mark)` không bao
 * giờ thoả được — bằng chứng đã xảy ra trước `mark`. Việc cần làm là bấm Claim.
 *
 * `log` được truyền tiếp vào `claimIfPending` vì `withTaskPopover` bên trong nó
 * mặc định no-op: đúng những dòng nói "lối vào nhiệm vụ sẽ bấm là element nào"
 * và "sau lần bấm N popover vẫn 0 dòng" — bản CLI in thẳng ra console, mất
 * chúng là mất manh mối duy nhất khi popover không mọc.
 */
async function claimPending(
  page: Page,
  snap: TaskSnapshot,
  store: TaskStore,
  outcomes: Map<string, TaskOutcome>,
  log: (msg: string) => void,
  signal: AbortSignal
): Promise<number> {
  let claimed = 0;
  for (const t of snap.byKey.values()) {
    signal.throwIfAborted();
    if (t.status !== 2) continue;
    const o = outcomes.get(t.taskKey);
    log(`   🟡 ${t.title} (+${t.reward}) đang chờ nhận — bấm Claim`);
    const ok = await claimIfPending(page, t, store, log, signal).catch((e: unknown) => {
      signal.throwIfAborted();
      if (o) o.error = (e as Error).message;
      log(`      ❌ ${(e as Error).message}`);
      return false;
    });
    if (ok) {
      if (o) o.done = true;
      claimed++;
      log(`      ✅ đã nhận ${t.title} (+${t.reward})`);
    }
  }
  return claimed;
}

/**
 * Chạy toàn bộ nhiệm vụ còn thiếu.
 * Không hàm nào ở đây được tự kết luận thành công — mọi kết luận đi qua
 * `runGroup`, và `runGroup` chỉ chấp nhận `do_action` với `err_no === 0`.
 */
export async function runAllTasks(input: RunTasksInput): Promise<RunTasksResult> {
  const { log } = input;
  const rounds = input.maxRounds ?? MAX_ATTEMPTS;

  /** Nghỉ thêm theo cấu hình Dashboard; không có `pace` thì không chờ gì cả. */
  const paceGap = async (where: string): Promise<void> => {
    const gap = paceGapMs(input.pace);
    if (gap <= 0) return;
    log(`   ⏸️  Nghỉ thêm ${(gap / 1000).toFixed(1)}s ${where} (Delay thao tác)`);
    await waitForDelay(gap, input.signal);
  };

  log('\n============================================================');
  log('🚀 LÀM NHIỆM VỤ FREE CREDITS');
  log('============================================================');

  const { store, env, snap: first } = await measureStage('task-bootstrap', () => bootstrap(input), log);
  let snap = first;
  log(
    `📋 CapCut có ${snap.byKey.size} nhiệm vụ | đã nhận ${snap.earnedReward}/${snap.totalReward} credits\n`
  );

  const outcomes = new Map<string, TaskOutcome>();
  for (const t of snap.byKey.values()) {
    outcomes.set(t.taskKey, {
      key: t.taskKey,
      title: t.title,
      reward: t.reward,
      done: t.status === 4,
      attempts: 0,
    });
  }

  const groups = input.groups ?? GROUPS;
  const proofBacked = new Set<string>();

  for (let attempt = 1; attempt <= rounds; attempt++) {
    input.signal.throwIfAborted();
    // Nhận trước những nhiệm vụ đã đủ điều kiện, để chúng rụng khỏi danh sách
    // thay vì bắt cả nhóm chờ vô ích một do_action đã bắn từ trước.
    if (await claimPending(env.page, snap, store, outcomes, log, input.signal)) {
      snap = await store.waitForSnapshot(Date.now() - 5000, 30_000, input.signal).catch(() => {
        input.signal.throwIfAborted();
        return snap;
      });
    }

    const picked = selectGroups(snap, groups, proofBacked);
    if (picked.length === 0) break;
    log(`🔄 Lần ${attempt}/${rounds} — ${picked.length} nhóm còn việc`);

    for (const { group, need } of picked) {
      input.signal.throwIfAborted();
      if (input.resolvePage) {
        env.page = await input.resolvePage('mission:' + group.name);
      }
      if (env.page.isClosed()) {
        log('   ❌ Tab chính đã bị đóng — dừng ở đây');
        return { outcomes: [...outcomes.values()], snapshot: summarize(snap) };
      }

      log(`\n📌 ${group.name}`);
      log(`   cần: ${[...need].join(', ')}`);
      const result = await runGroup(group, env, store, need);
      if (result.snapshot) snap = result.snapshot;

      for (const [key, evidence] of result.evidence) {
        const outcome = outcomes.get(key);
        if (!outcome) continue;
        outcome.attempts++;

        if (evidence.proof?.errNo === 0) {
          proofBacked.add(key);
          outcome.proof = evidence.proof;
        }
        if (evidence.state === 'verified') {
          outcome.done = true;
          outcome.error = undefined;
          log(`   ✅ ${outcome.title} (+${outcome.reward}) — do_action err_no=0`);
        } else if (evidence.state === 'proved-awaiting-snapshot') {
          outcome.done = false;
          outcome.error = 'Đã có do_action nhưng chưa nhận được task_status=4 mới.';
          log(`   🟡 ${outcome.title} (+${outcome.reward}) — đã có do_action, chờ snapshot`);
        } else {
          outcome.done = false;
          outcome.error = evidence.error?.message ?? 'Không xác minh được nhiệm vụ.';
          outcome.dumpName = evidence.error instanceof StepError ? evidence.error.dumpName : null;
          log(`   ❌ ${outcome.title} (+${outcome.reward}) — ${outcome.error}`);
        }
      }

      // Hết một nhóm là một BƯỚC LỚN — cùng với chỗ nghỉ giữa hai lượt quét, đây
      // là hai chỗ duy nhất `stepDelay*` được cộng vào.
      await paceGap('sau nhóm nhiệm vụ');
    }

    if (attempt < rounds && selectGroups(snap, groups, proofBacked).length > 0) {
      log('Còn nhiệm vụ chưa xác minh — chờ tối đa 8s cho task_list mới');
      await paceGap('trước lượt quét sau');
      snap = await store.waitForSnapshot(
        snap.at,
        INTER_ROUND_WAIT_MS,
        input.signal
      ).catch(() => {
        input.signal.throwIfAborted();
        return snap;
      });
    }
  }

  // Chốt lại bằng snapshot MỚI NHẤT trước khi báo cáo.
  //
  // Nhiệm vụ Bonus (+80) nhảy 1→2→4 vài giây SAU nhiệm vụ con cuối cùng, nên
  // nếu chỉ dùng `snap` của vòng lặp thì báo cáo in ❌ cho một nhiệm vụ mà
  // CapCut đã tính xong — đúng chuyện xảy ra lượt 2026-09-02 05:48.
  let stale = false;
  const final = await store
    .waitForSnapshot(snap.at, FINAL_SNAPSHOT_WAIT_MS, input.signal)
    .catch(() => {
      input.signal.throwIfAborted();
      // Không đọc lại được `task_list`: tab chính chết là nguyên nhân đã đo.
      // Nói ra thay vì im lặng trả về snapshot cũ như thể nó còn đúng.
      stale = true;
      log('   ⚠️  Không đọc lại được task_list ở bước chốt — số liệu snapshot là của lượt trước');
      return store.snapshot() ?? snap;
    });
  snap = final;
  for (const [key, t] of snap.byKey) {
    const o = outcomes.get(key);
    if (o && t.status === 4) o.done = true;
  }

  return { outcomes: [...outcomes.values()], snapshot: { ...summarize(snap), stale } };
}
