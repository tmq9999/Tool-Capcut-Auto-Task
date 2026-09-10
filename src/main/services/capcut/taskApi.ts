/**
 * =============================================================================
 * TASK API — NGUỒN SỰ THẬT VỀ NHIỆM VỤ
 * =============================================================================
 * Đo được từ một lượt làm tay hoàn chỉnh 12/12 nhiệm vụ
 * (`.capture/2026-09-01-21-50-27/`):
 *
 *   - 2986 request, KHÔNG có lần gọi `grant_reward` nào.
 *   - Đúng 9 lần `POST /task/v1/do_action`, mỗi lần cho một nhiệm vụ lá, bắn ra
 *     0–1 giây TRƯỚC khi `task_status` nhảy 1→4:
 *       {"action_key":"<task_key>","op_id":"<task_key>_<userId>_<ngày UTC>"}
 *       → {"data":{},"err_no":0,"err_tips":""}
 *   - Nút "Claim" từng thấy trong DOM là UI chưa refresh; click vào nó không
 *     phát request nào.
 *
 * Vì vậy tín hiệu thành công duy nhất được chấp nhận là: thấy `do_action` đúng
 * `action_key` với `err_no === 0`.
 *
 * Trạng thái đọc từ `GET /task/v1/task_list`, khoá định danh là `task_key` —
 * KHÔNG dùng title, vì có hai nhiệm vụ cùng tên "Chat with AI agent" chỉ khác
 * reward (+110 Design Studio vs +130 Video Studio).
 *
 * Bắt THỤ ĐỘNG chứ không tự gọi API: secsdk của CapCut chặn fetch thiếu
 * `msToken`/`X-Bogus`/`X-Gnarly`, còn nghe response của chính app thì không thể
 * bị chặn.
 * =============================================================================
 */

import type { BrowserContext, Request, Response } from 'playwright-core';
import { OperationDeadlineError, withinDeadline } from './cancellation';
import { validateRewardAttempt } from './stepEvidence';
import type { RewardAttempt, RewardStepResult } from './stepEvidence';
import type { ActionProof, CapcutTask, TaskSnapshot } from './http/taskTypes';
export type { ActionProof, CapcutTask, TaskSnapshot } from './http/taskTypes';

/** Đọc phản hồi `task_list` thành snapshot. Trả null nếu không phải task_list. */
export function parseTaskList(json: string, at = Date.now()): TaskSnapshot | null {
  let list: Array<Record<string, unknown>>;
  try {
    const root = JSON.parse(json) as { data?: { task_list?: Array<Record<string, unknown>> } };
    list = root.data?.task_list ?? [];
  } catch {
    return null;
  }
  if (list.length === 0) return null;

  const byKey = new Map<string, CapcutTask>();
  for (const t of list) {
    const view = (t.task_view ?? {}) as Record<string, unknown>;
    const rw = (t.task_reward_view ?? {}) as Record<string, unknown>;
    const rel = (t.task_relation ?? {}) as Record<string, unknown>;
    const taskKey = String(t.task_key ?? '');
    if (!taskKey) continue;
    byKey.set(taskKey, {
      taskKey,
      taskId: Number(t.task_id ?? 0),
      title: String(view.title ?? ''),
      reward: Number(rw.reward_amount ?? 0),
      status: Number(t.task_status ?? -1),
      buttonText: String(view.button_text ?? ''),
      childIds: Array.isArray(rel.child_task_ids) ? (rel.child_task_ids as number[]) : [],
    });
  }
  if (byKey.size === 0) return null;

  const all = [...byKey.values()];
  return {
    at,
    byKey,
    totalReward: all.reduce((s, t) => s + t.reward, 0),
    earnedReward: all.filter((t) => t.status === 4).reduce((s, t) => s + t.reward, 0),
    doneKeys: all.filter((t) => t.status === 4).map((t) => t.taskKey),
  };
}

/**
 * Đọc một cặp request/response của `do_action` thành bằng chứng.
 * `err_no !== 0` vẫn trả về đối tượng — đó là bằng chứng THẤT BẠI, khác hẳn
 * với null (không phải do_action).
 */
export function parseDoAction(reqBody: string, resBody: string, at = Date.now()): ActionProof | null {
  let actionKey = '';
  let opId = '';
  try {
    const req = JSON.parse(reqBody) as { action_key?: string; op_id?: string };
    actionKey = String(req.action_key ?? '');
    opId = String(req.op_id ?? '');
  } catch {
    return null;
  }
  if (!actionKey) return null;

  let errNo = -1;
  let errTips = '';
  try {
    const res = JSON.parse(resBody) as { err_no?: unknown; err_tips?: unknown };
    if (typeof res.err_no === 'number' && Number.isFinite(res.err_no)) {
      errNo = res.err_no;
    }
    if (typeof res.err_tips === 'string') {
      errTips = res.err_tips;
    }
  } catch {
    // Response không parse được -> errNo giữ -1, coi như CHƯA chứng minh được.
  }
  return { actionKey, opId, errNo, errTips, at };
}

// ---------------------------------------------------------------------------
// TaskStore — nơi duy nhất giữ trạng thái và cấp bằng chứng
// ---------------------------------------------------------------------------

const TASK_LIST_PATH = '/task/v1/task_list';
const DO_ACTION_PATH = '/task/v1/do_action';
const GRANT_PATH = '/task/v1/grant_reward';

export type TaskListDiagnostic = {
  requestId: number;
  elapsedMs: number;
  phase: 'request' | 'request-failed' | 'response' | 'body';
  status?: number;
  result?: 'valid' | 'empty' | 'malformed' | 'unreadable' | 'timeout' | 'omitted';
  taskCount?: number;
  errNo?: number;
};

/** Passive categories only; never contributes snapshots/proofs or delays cleanup. */
export function attachTaskListDiagnostics(
  context: BrowserContext,
  signal: AbortSignal,
  observe: (event: TaskListDiagnostic) => void
): () => void {
  signal.throwIfAborted();
  const reads = new AbortController();
  const ids = new WeakMap<Request, { id: number; at: number }>();
  const seenResponses = new WeakSet<Response>();
  let sequence = 0;
  let pending = 0;
  const identify = (request: Request) => {
    if (reads.signal.aborted) return null;
    const known = ids.get(request);
    if (known) return known;
    if (sequence >= 512) return null;
    try {
      const url = new URL(request.url());
      if (!/(^|\.)(capcut\.com|capcutapi\.com)$/.test(url.hostname) || !url.pathname.endsWith(TASK_LIST_PATH)) return null;
    } catch { return null; }
    const value = { id: ++sequence, at: Date.now() };
    ids.set(request, value);
    return value;
  };
  const emit = (identity: { id: number; at: number }, fields: Omit<TaskListDiagnostic, 'requestId' | 'elapsedMs'>) => {
    if (reads.signal.aborted) return;
    try {
      observe({ requestId: identity.id, elapsedMs: Math.max(0, Date.now() - identity.at), ...fields });
    } catch { /* Diagnostics cannot change the account outcome. */ }
  };
  const onRequest = (request: Request) => {
    const identity = identify(request);
    if (identity) emit(identity, { phase: 'request' });
  };
  const onFailed = (request: Request) => {
    const identity = identify(request);
    if (identity) emit(identity, { phase: 'request-failed' });
  };
  const recordResponse = (response: Response) => {
    if (seenResponses.has(response)) return;
    seenResponses.add(response);
    const identity = identify(response.request());
    if (!identity) return;
    emit(identity, { phase: 'response', status: response.status() });
    if (reads.signal.aborted) return;
    const declaredLength = Number(response.headers()['content-length']);
    if (pending >= 4 || !Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 1024 * 1024) {
      emit(identity, { phase: 'body', result: 'omitted' });
      return;
    }
    pending++;
    const bodyRead = Promise.resolve().then(() => {
      reads.signal.throwIfAborted();
      return response.text();
    });
    void bodyRead.then(() => { pending--; }, () => { pending--; });
    void (async () => {
      try {
        const body = await withinDeadline(bodyRead, 5000, reads.signal);
        if (reads.signal.aborted) return;
        if (Buffer.byteLength(body) > 1024 * 1024) {
          emit(identity, { phase: 'body', result: 'omitted' });
          return;
        }
        let fields: Pick<TaskListDiagnostic, 'result' | 'taskCount' | 'errNo'> = { result: 'malformed' };
        try {
          const value = JSON.parse(body);
          const list: unknown = value?.data?.task_list;
          const errNo: unknown = value?.err_no;
          if (typeof errNo === 'number' && Number.isSafeInteger(errNo)) fields.errNo = errNo;
          if (Array.isArray(list) && list.every(item => item !== null && typeof item === 'object' && typeof item.task_key === 'string')) {
            fields = { ...fields, result: list.length ? 'valid' : 'empty', taskCount: list.length };
          }
        } catch { /* Report malformed without forwarding payload or error text. */ }
        emit(identity, { phase: 'body', ...fields });
      } catch (error) {
        emit(identity, { phase: 'body', result: error instanceof OperationDeadlineError ? 'timeout' : 'unreadable' });
      }
    })();
  };
  const onResponse = (response: Response) => {
    try { recordResponse(response); } catch { /* Transport metadata is diagnostic-only. */ }
  };
  const stop = () => {
    if (reads.signal.aborted) return;
    reads.abort();
    signal.removeEventListener('abort', stop);
    context.off('request', onRequest);
    context.off('requestfailed', onFailed);
    context.off('response', onResponse);
  };
  context.on('request', onRequest);
  context.on('requestfailed', onFailed);
  context.on('response', onResponse);
  signal.addEventListener('abort', stop, { once: true });
  return stop;
}

interface ActionWaiter {
  actionKey: string;
  sinceMs: number;
  resolve: (p: ActionProof) => void;
}

interface SnapWaiter {
  afterMs: number;
  resolve: (s: TaskSnapshot) => void;
}

export interface TaskMonitorIdentity {
  runId: string;
  sessionAlias: string;
}

interface AttemptState {
  attempt: RewardAttempt;
  acceptingRequests: boolean;
  settled: boolean;
}

export interface RewardActionContract {
  taskKey: string;
  requestActionKey: string;
}

interface RequestOrigin {
  identity: Readonly<TaskMonitorIdentity>;
  requestId: number;
  requestStartedAt: number;
  attempt?: RewardAttempt;
  confirmedRelated: boolean;
}

interface ActionObservation {
  proof: ActionProof;
  origin?: RequestOrigin;
  responseHeadersAt?: number;
  bodyObservedAt: number;
  bodyValid: boolean;
}

interface SnapshotObservation {
  snapshot: TaskSnapshot;
  origin?: RequestOrigin;
  responseHeadersAt?: number;
  bodyObservedAt: number;
}

export class RewardAttemptOverlapError extends Error {
  readonly code = 'REWARD_ATTEMPT_OVERLAP' as const;

  constructor() {
    super('REWARD_ATTEMPT_OVERLAP');
    this.name = 'RewardAttemptOverlapError';
  }
}

/** grant_reward chỉ để QUAN SÁT — luồng đo được không dùng tới nó. */
export interface GrantLog {
  errNo: number;
  errTips: string;
  at: number;
}

export class TaskStore {
  private snap: TaskSnapshot | null = null;
  private actions: ActionProof[] = [];
  private grants: GrantLog[] = [];
  private actionWaiters = new Set<ActionWaiter>();
  private snapWaiters = new Set<SnapWaiter>();
  private attempts = new Map<string, AttemptState>();
  private activeAttempts = new Map<string, string>();
  private monitorIdentity: Readonly<TaskMonitorIdentity> | null = null;
  private actionObservations: ActionObservation[] = [];
  private snapshotObservations: SnapshotObservation[] = [];
  private latestSnapshotRequestStartedAt = -1;
  private changeWaiters = new Set<() => void>();
  private requestSequence = 0;
  private monitorAttached = false;
  private actionContracts = new Map<string, Readonly<RewardActionContract>>();

  private validateAttempt(candidate: RewardAttempt): RewardAttempt {
    return validateRewardAttempt({
      sessionAlias: candidate.sessionAlias,
      stepAttemptId: candidate.stepAttemptId,
      taskKey: candidate.taskKey,
    }, candidate);
  }

  beginAttempt(candidate: RewardAttempt): void {
    const attempt = this.validateAttempt(candidate);
    if (this.attempts.has(attempt.stepAttemptId)) {
      throw new Error('REWARD_ATTEMPT_DUPLICATE');
    }
    const unresolved = [...this.attempts.values()].find(
      (state) => state.attempt.sessionAlias === attempt.sessionAlias
        && state.attempt.taskKey === attempt.taskKey
        && !state.settled
    );
    if (unresolved) {
      throw new RewardAttemptOverlapError();
    }
    this.attempts.set(attempt.stepAttemptId, {
      attempt,
      acceptingRequests: true,
      settled: false,
    });
    this.activeAttempts.set(attempt.taskKey, attempt.stepAttemptId);
  }

  endAttempt(stepAttemptId: string): void {
    const state = this.attempts.get(stepAttemptId);
    if (!state) return;
    state.acceptingRequests = false;
    if (this.activeAttempts.get(state.attempt.taskKey) === stepAttemptId) {
      this.activeAttempts.delete(state.attempt.taskKey);
    }
  }

  registerActionContract(candidate: RewardActionContract): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.taskKey)
      || candidate.requestActionKey !== candidate.taskKey) {
      throw new Error('REWARD_ACTION_CONTRACT_INVALID');
    }
    const existing = this.actionContracts.get(candidate.taskKey);
    if (existing && existing.requestActionKey !== candidate.requestActionKey) {
      throw new Error('REWARD_ACTION_CONTRACT_MISMATCH');
    }
    this.actionContracts.set(candidate.taskKey, Object.freeze({ ...candidate }));
  }

  registerMonitor(candidate: TaskMonitorIdentity): Readonly<TaskMonitorIdentity> {
    if (!candidate.runId || !candidate.sessionAlias) {
      throw new Error('TASK_MONITOR_IDENTITY_INVALID');
    }
    if (this.monitorIdentity
      && (this.monitorIdentity.runId !== candidate.runId
        || this.monitorIdentity.sessionAlias !== candidate.sessionAlias)) {
      throw new Error('TASK_MONITOR_OWNER_MISMATCH');
    }
    if (this.monitorAttached) throw new Error('TASK_MONITOR_ALREADY_ATTACHED');
    this.monitorIdentity ??= Object.freeze({ ...candidate });
    this.monitorAttached = true;
    return this.monitorIdentity;
  }

  releaseMonitor(identity: Readonly<TaskMonitorIdentity>): void {
    if (this.monitorIdentity === identity) this.monitorAttached = false;
  }

  nextRequestId(): number {
    return ++this.requestSequence;
  }

  bindRequestOrigin(
    identity: Readonly<TaskMonitorIdentity>,
    actionKey: string,
    requestId: number,
    requestStartedAt: number
  ): RequestOrigin {
    if (!this.monitorIdentity
      || this.monitorIdentity.runId !== identity.runId
      || this.monitorIdentity.sessionAlias !== identity.sessionAlias) {
      throw new Error('TASK_MONITOR_OWNER_MISMATCH');
    }
    const activeAttemptId = this.activeAttempts.get(actionKey);
    const active = activeAttemptId ? this.attempts.get(activeAttemptId) : undefined;
    const attempt = active?.acceptingRequests
      && active.attempt.sessionAlias === identity.sessionAlias
      && active.attempt.taskKey === actionKey
      && requestStartedAt >= active.attempt.actionDispatchedAt
      ? active.attempt
      : undefined;
    return Object.freeze({
      identity,
      requestId,
      requestStartedAt,
      ...(attempt ? { attempt } : {}),
      confirmedRelated: this.actionContracts.get(actionKey)?.requestActionKey === actionKey,
    });
  }

  private notifyChange(): void {
    for (const resolve of [...this.changeWaiters]) resolve();
    this.changeWaiters.clear();
  }

  pushTaskList(json: string, at = Date.now()): void {
    this.pushObservedTaskList(json, { bodyObservedAt: at });
  }

  pushObservedTaskList(
    json: string,
    observation: { origin?: RequestOrigin; responseHeadersAt?: number; bodyObservedAt: number }
  ): void {
    const at = observation.responseHeadersAt ?? observation.bodyObservedAt;
    const parsed = parseTaskList(json, at);
    if (!parsed) return;
    this.snapshotObservations.push({ snapshot: parsed, ...observation });
    const requestStartedAt = observation.origin?.requestStartedAt;
    const canReplaceCurrent = requestStartedAt === undefined
      ? !this.snap || parsed.at >= this.snap.at
      : requestStartedAt >= this.latestSnapshotRequestStartedAt;
    if (canReplaceCurrent) {
      this.snap = parsed;
      if (requestStartedAt !== undefined) this.latestSnapshotRequestStartedAt = requestStartedAt;
    }
    for (const w of [...this.snapWaiters]) {
      if (parsed.at > w.afterMs) {
        this.snapWaiters.delete(w);
        w.resolve(parsed);
      }
    }
    this.notifyChange();
  }

  pushAction(proof: ActionProof): void {
    this.pushObservedAction(proof, { bodyObservedAt: proof.at, bodyValid: true });
  }

  pushObservedAction(
    proof: ActionProof,
    observation: {
      origin?: RequestOrigin;
      responseHeadersAt?: number;
      bodyObservedAt: number;
      bodyValid: boolean;
    }
  ): void {
    this.actions.push(proof);
    this.actionObservations.push({ proof, ...observation });
    if (observation.bodyValid
      && observation.origin?.attempt
      && observation.origin.confirmedRelated
      && proof.errNo === 0) {
      const state = this.attempts.get(observation.origin.attempt.stepAttemptId);
      if (state) state.settled = true;
    }
    for (const w of [...this.actionWaiters]) {
      if (w.actionKey === proof.actionKey && proof.at >= w.sinceMs) {
        this.actionWaiters.delete(w);
        w.resolve(proof);
      }
    }
    this.notifyChange();
  }

  pushGrant(g: GrantLog): void {
    this.grants.push(g);
  }

  snapshot(): TaskSnapshot | null {
    return this.snap;
  }

  seenActions(): ActionProof[] {
    return [...this.actions];
  }

  seenGrants(): GrantLog[] {
    return [...this.grants];
  }

  async verifyRewardStep(
    candidate: RewardAttempt,
    deadlineAt: number,
    signal?: AbortSignal
  ): Promise<RewardStepResult> {
    const attempt = this.validateAttempt(candidate);
    const inspect = (): RewardStepResult | null => {
      const action = this.actionObservations.find((entry) => {
        const originAttempt = entry.origin?.attempt;
        return originAttempt?.sessionAlias === attempt.sessionAlias
          && originAttempt.stepAttemptId === attempt.stepAttemptId
          && originAttempt.taskKey === attempt.taskKey
          && entry.origin!.requestStartedAt >= attempt.actionDispatchedAt;
      });
      if (!action || action.responseHeadersAt === undefined) return null;
      const actionRef = `task-action:${attempt.stepAttemptId}:request-${action.origin!.requestId}`;
      if (!action.bodyValid) {
        return {
          verdict: 'unknown',
          proofAt: action.responseHeadersAt,
          reasonCode: 'REWARD_ACTION_BODY_INVALID',
          evidenceRefs: [actionRef],
        };
      }
      if (!action.origin!.confirmedRelated) {
        return {
          verdict: 'unknown',
          proofAt: action.responseHeadersAt,
          reasonCode: 'REWARD_CAUSAL_RELATION_UNKNOWN',
          evidenceRefs: [actionRef],
        };
      }
      if (action.proof.errNo !== 0) {
        return {
          verdict: 'fail',
          proofAt: action.responseHeadersAt,
          reasonCode: 'REWARD_ACTION_REJECTED',
          evidenceRefs: [actionRef],
        };
      }
      const snapshots = this.snapshotObservations.filter((entry) =>
        entry.origin?.identity.runId === action.origin?.identity.runId
          && entry.origin?.identity.sessionAlias === attempt.sessionAlias
          && entry.origin.requestStartedAt > action.responseHeadersAt!
          && entry.responseHeadersAt !== undefined
      );
      const snapshot = snapshots.reduce<SnapshotObservation | undefined>((latest, entry) => {
        if (!latest) return entry;
        const latestRequestAt = latest.origin!.requestStartedAt;
        const entryRequestAt = entry.origin!.requestStartedAt;
        if (entryRequestAt !== latestRequestAt) return entryRequestAt > latestRequestAt ? entry : latest;
        return entry.responseHeadersAt! > latest.responseHeadersAt! ? entry : latest;
      }, undefined);
      if (!snapshot) return null;
      const status = snapshot.snapshot.byKey.get(attempt.taskKey)?.status;
      const snapshotRef = `task-snapshot:${attempt.stepAttemptId}:request-${snapshot.origin!.requestId}`;
      if (status === 4) {
        return {
          verdict: 'pass',
          proofAt: action.responseHeadersAt,
          snapshotAt: snapshot.responseHeadersAt,
          status,
          reasonCode: 'REWARD_VERIFIED',
          evidenceRefs: [actionRef, snapshotRef],
        };
      }
      return {
        verdict: 'unknown',
        proofAt: action.responseHeadersAt,
        snapshotAt: snapshot.responseHeadersAt,
        status,
        reasonCode: 'REWARD_STATUS_UNCONFIRMED',
        evidenceRefs: [actionRef, snapshotRef],
      };
    };

    while (true) {
      signal?.throwIfAborted();
      const result = inspect();
      if (result) return result;
      const remaining = Math.max(0, deadlineAt - Date.now());
      if (remaining === 0) break;
      await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout | null = null;
        const cleanup = () => {
          this.changeWaiters.delete(onChange);
          signal?.removeEventListener('abort', onAbort);
          if (timer) clearTimeout(timer);
        };
        const onChange = () => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(signal?.reason ?? new Error('Aborted')); };
        this.changeWaiters.add(onChange);
        timer = setTimeout(onChange, remaining);
        timer.unref?.();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    const proof = this.actionObservations.find(
      (entry) => entry.origin?.attempt?.stepAttemptId === attempt.stepAttemptId
        && entry.responseHeadersAt !== undefined
    );
    return {
      verdict: 'unknown',
      ...(proof?.responseHeadersAt !== undefined ? { proofAt: proof.responseHeadersAt } : {}),
      reasonCode: proof ? 'REWARD_SNAPSHOT_MISSING' : 'REWARD_PROOF_MISSING',
      evidenceRefs: [`reward-attempt:${attempt.stepAttemptId}`],
    };
  }

  waitForAction(
    actionKey: string,
    timeoutMs: number,
    sinceMs: number,
    signal?: AbortSignal
  ): Promise<ActionProof> {
    signal?.throwIfAborted();
    const already = this.actions.find(
      (action) => action.actionKey === actionKey && action.at >= sinceMs
    );
    if (already) return Promise.resolve(already);

    return new Promise<ActionProof>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const cleanup = (): void => {
        this.actionWaiters.delete(waiter);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error('Aborted'));
      };
      const waiter: ActionWaiter = {
        actionKey,
        sinceMs,
        resolve: (proof) => {
          cleanup();
          resolve(proof);
        }
      };
      this.actionWaiters.add(waiter);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(
          'không thấy do_action "' + actionKey + '" sau ' + timeoutMs + 'ms'
        ));
      }, timeoutMs);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Chỉ nhận snapshot MỚI hơn `afterMs`. Không bao giờ trả về bản cũ. */
  waitForSnapshot(
    afterMs: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<TaskSnapshot> {
    signal?.throwIfAborted();
    if (this.snap && this.snap.at > afterMs) return Promise.resolve(this.snap);

    return new Promise<TaskSnapshot>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const cleanup = (): void => {
        this.snapWaiters.delete(waiter);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error('Aborted'));
      };
      const waiter: SnapWaiter = {
        afterMs,
        resolve: (snapshot) => {
          cleanup();
          resolve(snapshot);
        }
      };
      this.snapWaiters.add(waiter);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(
          'không nhận được task_list mới sau ' + timeoutMs + 'ms'
        ));
      }, timeoutMs);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * Nghe traffic của chính app trên MỌI page, kể cả page mở sau.
 * Không tự gọi API: secsdk chặn fetch thiếu signature.
 */
export function attachTaskMonitor(
  context: BrowserContext,
  store: TaskStore,
  candidateIdentity: TaskMonitorIdentity
): () => void {
  const identity = store.registerMonitor(candidateIdentity);
  type Endpoint = 'task-list' | 'do-action' | 'grant';
  type MonitoredRequest = {
    endpoint: Endpoint;
    requestBody: string;
    origin: RequestOrigin;
  };
  const requests = new WeakMap<Request, MonitoredRequest>();
  let stopped = false;

  const endpointFor = (request: Request): Endpoint | null => {
    let url: URL;
    try { url = new URL(request.url()); } catch { return null; }
    if (!/(^|\.)(capcut\.com|capcutapi\.com)$/.test(url.hostname)) return null;
    const paths = new Map<string, Endpoint>([
      [TASK_LIST_PATH, 'task-list'],
      [DO_ACTION_PATH, 'do-action'],
      [GRANT_PATH, 'grant'],
      [`/luckycat/i18n/capcut${TASK_LIST_PATH}`, 'task-list'],
      [`/luckycat/i18n/capcut${DO_ACTION_PATH}`, 'do-action'],
      [`/luckycat/i18n/capcut${GRANT_PATH}`, 'grant'],
    ]);
    const endpoint = paths.get(url.pathname) ?? null;
    if (!endpoint) return null;
    const method = request.method();
    if (endpoint === 'task-list') return method === 'GET' || method === 'POST' ? endpoint : null;
    return method === 'POST' ? endpoint : null;
  };

  const onRequest = (request: Request): void => {
    if (stopped) return;
    const endpoint = endpointFor(request);
    if (!endpoint) return;
    const requestStartedAt = Date.now();
    const requestBody = request.postData() ?? '';
    let actionKey = '';
    if (endpoint === 'do-action') {
      try {
        const parsed = JSON.parse(requestBody) as { action_key?: unknown };
        actionKey = typeof parsed.action_key === 'string' ? parsed.action_key : '';
      } catch { /* Malformed requests remain origin-unknown. */ }
    }
    requests.set(request, {
      endpoint,
      requestBody,
      origin: store.bindRequestOrigin(identity, actionKey, store.nextRequestId(), requestStartedAt),
    });
  };

  const onResponse = (response: Response): void => {
    if (stopped) return;
    const monitored = requests.get(response.request());
    if (!monitored) return;
    const status = response.status();
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status >= 300) {
      return;
    }
    const responseHeadersAt = Date.now();
    void response.text().then((body) => {
      if (stopped) return;
      const bodyObservedAt = Date.now();
      if (monitored.endpoint === 'task-list') {
        store.pushObservedTaskList(body, {
          origin: monitored.origin,
          responseHeadersAt,
          bodyObservedAt,
        });
        return;
      }
      if (monitored.endpoint === 'do-action') {
        const proof = parseDoAction(monitored.requestBody, body, responseHeadersAt);
        if (proof) {
          let bodyValid = false;
          try {
            const parsed = JSON.parse(body) as { err_no?: unknown };
            bodyValid = typeof parsed.err_no === 'number'
              && Number.isFinite(parsed.err_no);
          } catch { /* Invalid bodies remain explicit unknown evidence. */ }
          store.pushObservedAction(proof, {
            origin: monitored.origin,
            responseHeadersAt,
            bodyObservedAt,
            bodyValid,
          });
        }
        return;
      }
      try {
        const parsed = JSON.parse(body) as { err_no?: number; err_tips?: string };
        store.pushGrant({
          errNo: Number(parsed.err_no ?? -1),
          errTips: String(parsed.err_tips ?? ''),
          at: responseHeadersAt,
        });
      } catch { /* Grant observation is non-authoritative. */ }
    }).catch(() => { /* Cancelled/unreadable bodies provide no proof. */ });
  };

  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    context.off('request', onRequest);
    context.off('response', onResponse);
    store.releaseMonitor(identity);
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  return dispose;
}
