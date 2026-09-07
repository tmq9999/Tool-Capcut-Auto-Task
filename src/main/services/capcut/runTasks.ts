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
  type MissionEvidence
} from './missionRunner';
import { designStudioGroup } from './missions/designStudio';
import { notificationsGroup, pwaInstallGroup } from './missions/simple';
import { videoStudioGroup } from './missions/videoStudio';
import { attachTaskMonitor, TaskStore, type ActionProof, type TaskSnapshot } from './taskApi';
import type {
  CapcutMissionEnv,
  CapcutPace,
  MissionGroup,
  TaskOutcome,
  TaskSnapshotSummary,
  SnapshotTaskSummary,
  TaskCheckpoint,
  UnsettledTaskProof,
  CapcutVerificationReceipt,
  AccountUiInteraction
} from './types';
import { URLS } from './urls';
import { abortable } from './cancellation';
import { measureStage } from '../stageTiming';
import { createDirectUiInteraction } from './uiInteractionScheduler';
import type { CapcutHttpTaskApi } from './http/taskApi';

export type {
  TaskSnapshotSummary,
  SnapshotTaskSummary,
  TaskCheckpoint,
  UnsettledTaskProof,
  CapcutVerificationReceipt
};

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

export function needsFinalSnapshotRefresh(
  snapshot: Partial<TaskSnapshotSummary> & Pick<TaskSnapshotSummary, 'total' | 'done' | 'missing'>
): boolean {
  return snapshot.total === 0 || snapshot.done < snapshot.total || snapshot.missing.length > 0;
}

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
  captureStage?: (stage: string) => void;
  /** Optional browser-HTTP task discovery; UI remains the default. */
  httpTaskApi?: CapcutHttpTaskApi;
  httpStrict?: boolean;
  runId?: string;
  sessionAlias?: string;
  sessionStartedAt?: number;
  unsettledProofs?: readonly UnsettledTaskProof[];
  ui?: AccountUiInteraction;
  onCheckpoint?: (checkpoint: TaskCheckpoint) => Promise<void>;
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

export interface RunTasksResult {
  outcomes: TaskOutcome[];
  snapshot: TaskSnapshotSummary | null;
  fatalError?: Error;
  unsettledProofs: UnsettledTaskProof[];
}

export function buildUnsettledProofs(
  outcomes: Iterable<TaskOutcome>,
  snapshot: TaskSnapshotSummary | null
): UnsettledTaskProof[] {
  const snapshotTasksByKey = new Map(snapshot?.tasks.map((t) => [t.key, t]) ?? []);
  const unsettled: UnsettledTaskProof[] = [];
  for (const o of outcomes) {
    if (o.proof && o.proof.errNo === 0) {
      const snapTask = snapshotTasksByKey.get(o.key);
      if (!snapTask || snapTask.status !== 4) {
        unsettled.push({
          key: o.key,
          proof: o.proof as ActionProof & { errNo: 0 }
        });
      }
    }
  }
  return unsettled;
}

export function mergeGroupEvidence(
  outcomes: Map<string, TaskOutcome>,
  proofBacked: Set<string>,
  evidence: ReadonlyMap<string, MissionEvidence>,
  log: (message: string) => void
): void {
  for (const [key, item] of evidence) {
    const outcome = outcomes.get(key);
    if (!outcome) continue;
    outcome.attempts++;

    if (item.proof?.errNo === 0) {
      proofBacked.add(key);
      outcome.proof = item.proof;
    }
    if (item.state === 'verified') {
      outcome.done = true;
      outcome.error = undefined;
      log(`   ✅ ${outcome.title} (+${outcome.reward}) — do_action err_no=0`);
    } else if (item.state === 'proved-awaiting-snapshot') {
      outcome.done = false;
      outcome.error = 'Đã có do_action nhưng chưa nhận được task_status=4 mới.';
      log(`   🟡 ${outcome.title} (+${outcome.reward}) — đã có do_action, chờ snapshot`);
    } else {
      outcome.done = false;
      outcome.error = item.error?.message ?? 'Không xác minh được nhiệm vụ.';
      outcome.dumpName = item.error instanceof StepError ? item.error.dumpName : null;
      log(`   ❌ ${outcome.title} (+${outcome.reward}) — ${outcome.error}`);
    }
  }
}

/**
 * Rút snapshot của CapCut thành con số cho app — thay chỗ của `printReport`.
 * Con số của cổng chứng minh phải cùng một nguồn với `task_status`, mà nguồn đó là
 * `task_list`.
 */
export function summarize(
  snap: TaskSnapshot,
  observedAt: number = snap.at,
  requiredAfter: number = 0
): TaskSnapshotSummary {
  const tasks: SnapshotTaskSummary[] = [...snap.byKey.values()].map((task) => ({
    key: task.taskKey,
    title: task.title,
    reward: task.reward,
    status: task.status
  }));
  const done = tasks.filter((t) => t.status === 4).length;
  const missing = tasks.filter((t) => t.status !== 4).map((t) => t.key);
  const fresh = observedAt > requiredAfter;
  const final = fresh && missing.length === 0;

  return {
    observedAt,
    requiredAfter,
    tasks,
    total: tasks.length,
    done,
    credits: snap.earnedReward,
    creditsTotal: snap.totalReward,
    missing,
    fresh,
    final
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
    ui: input.ui ?? createDirectUiInteraction(input.signal),
    captureStage: input.captureStage,
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

  log(input.httpTaskApi ? `Đọc task_list qua ${input.httpTaskApi.mechanism}; UI chỉ là fallback.` : 'Mở route nhiệm vụ; deadline bootstrap 30s.');
  input.signal.throwIfAborted();
  if (input.httpTaskApi) {
    try {
      const httpSnapshot = await input.httpTaskApi.getTaskList(input.signal);
      store.pushTaskList(JSON.stringify({ data: { task_list: [...httpSnapshot.byKey.values()].map((task) => ({
        task_key: task.taskKey,
        task_id: task.taskId,
        task_status: task.status,
        task_reward_view: { reward_amount: task.reward },
        task_view: { title: task.title, button_text: task.buttonText },
        task_relation: { child_task_ids: task.childIds },
      })) } }));
      return { store, env, snap: httpSnapshot };
    } catch (error) {
      input.signal.throwIfAborted();
      if (input.httpStrict) throw new StepError('HTTP task_list failed before any mission mutation: ' + (error instanceof Error ? error.message : 'HTTP_ERROR'), await dump(page, 'http_task_list_failed'));
      log('HTTP task_list thất bại; chuyển fallback UI: ' + (error instanceof Error ? error.message : 'HTTP_ERROR'));
    }
  }
  await abortable(
    page.goto(URLS.tasks, { waitUntil: 'domcontentloaded', timeout: 12_000 }),
    input.signal
  ).catch(() => { input.signal.throwIfAborted(); });
  let snap = await tryGet(2000);

  if (!snap && remaining() > 0) {
    log('   ℹ️  Chưa thấy task_list — mở popover nhiệm vụ để kích hoạt');
    await withTaskPopover(page, async () => { snap = await tryGet(remaining()); }, log, {
      signal: input.signal,
      deadlineAt,
      ui: env.ui
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

  input.captureStage?.('task-bootstrap');
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

  if (input.unsettledProofs) {
    for (const item of input.unsettledProofs) {
      if (item.proof?.errNo === 0) {
        proofBacked.add(item.key);
        const outcome = outcomes.get(item.key);
        if (outcome) {
          outcome.proof = item.proof;
        }
      }
    }
  }

  let requiredAfter = input.sessionStartedAt ?? 0;
  const emitCheckpoint = async (isFinal: boolean, actionSettledAt?: number): Promise<void> => {
    if (actionSettledAt) {
      requiredAfter = Math.max(requiredAfter, actionSettledAt);
    }
    const checkpointSummary = summarize(snap, snap.at, requiredAfter);
    checkpointSummary.final = isFinal && checkpointSummary.fresh && checkpointSummary.missing.length === 0;
    if (input.onCheckpoint) {
      await input.onCheckpoint({
        outcomes: [...outcomes.values()],
        snapshot: checkpointSummary
      });
    }
  };

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
        const closedSummary = summarize(snap, snap.at, requiredAfter);
        closedSummary.final = false;
        return {
          outcomes: [...outcomes.values()],
          snapshot: closedSummary,
          unsettledProofs: buildUnsettledProofs(outcomes.values(), closedSummary)
        };
      }

      log(`\n📌 ${group.name}`);
      input.captureStage?.('mission:' + group.name);
      log(`   cần: ${[...need].join(', ')}`);
      const result = await runGroup(group, env, store, need);
      if (result.snapshot) snap = result.snapshot;
      mergeGroupEvidence(outcomes, proofBacked, result.evidence, log);
      if (result.actionSettledAt) {
        requiredAfter = Math.max(requiredAfter, result.actionSettledAt);
      }
      await emitCheckpoint(false, result.actionSettledAt);
      if (result.fatalError) {
        const fatalSummary = summarize(snap, snap.at, requiredAfter);
        fatalSummary.final = false;
        return {
          outcomes: [...outcomes.values()],
          snapshot: fatalSummary,
          fatalError: result.fatalError,
          unsettledProofs: buildUnsettledProofs(outcomes.values(), fatalSummary)
        };
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
  let stale = false;
  const currentSnapSummary = summarize(snap, snap.at, requiredAfter);
  if (snap.at <= requiredAfter || needsFinalSnapshotRefresh(currentSnapSummary)) {
    const waitAfter = Math.max(requiredAfter, snap.at);
    const finalSnap = await store
      .waitForSnapshot(waitAfter, FINAL_SNAPSHOT_WAIT_MS, input.signal)
      .catch(() => {
        input.signal.throwIfAborted();
        stale = true;
        log('   ⚠️  Không đọc lại được task_list ở bước chốt — số liệu snapshot là của lượt trước');
        return null;
      });
    if (finalSnap) {
      snap = finalSnap;
    }
  }

  for (const [key, t] of snap.byKey) {
    const o = outcomes.get(key);
    if (o && t.status === 4) o.done = true;
  }

  const fresh = snap.at > requiredAfter;
  const finalSummary = summarize(snap, snap.at, requiredAfter);
  finalSummary.fresh = fresh;
  finalSummary.final = fresh && finalSummary.missing.length === 0;
  finalSummary.stale = stale;

  if (input.onCheckpoint) {
    await input.onCheckpoint({
      outcomes: [...outcomes.values()],
      snapshot: finalSummary
    });
  }

  return {
    outcomes: [...outcomes.values()],
    snapshot: finalSummary,
    unsettledProofs: buildUnsettledProofs(outcomes.values(), finalSummary)
  };
}
