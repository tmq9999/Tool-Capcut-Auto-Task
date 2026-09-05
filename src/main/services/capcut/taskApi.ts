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

import type { BrowserContext, Page } from 'playwright-core';

export interface CapcutTask {
  taskKey: string;
  taskId: number;
  title: string;
  reward: number;
  /** 1 = còn mở, 2 = trung gian, 4 = đã nhận */
  status: number;
  buttonText: string;
  childIds: number[];
}

export interface TaskSnapshot {
  at: number;
  byKey: Map<string, CapcutTask>;
  totalReward: number;
  earnedReward: number;
  doneKeys: string[];
}

export interface ActionProof {
  actionKey: string;
  opId: string;
  errNo: number;
  errTips: string;
  at: number;
}

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
    const res = JSON.parse(resBody) as { err_no?: number; err_tips?: string };
    errNo = Number(res.err_no ?? -1);
    errTips = String(res.err_tips ?? '');
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

interface ActionWaiter {
  actionKey: string;
  sinceMs: number;
  resolve: (p: ActionProof) => void;
}

interface SnapWaiter {
  afterMs: number;
  resolve: (s: TaskSnapshot) => void;
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

  pushTaskList(json: string, at = Date.now()): void {
    const parsed = parseTaskList(json, at);
    if (!parsed) return;
    this.snap = parsed;
    for (const w of [...this.snapWaiters]) {
      if (parsed.at > w.afterMs) {
        this.snapWaiters.delete(w);
        w.resolve(parsed);
      }
    }
  }

  pushAction(proof: ActionProof): void {
    this.actions.push(proof);
    for (const w of [...this.actionWaiters]) {
      if (w.actionKey === proof.actionKey && proof.at >= w.sinceMs) {
        this.actionWaiters.delete(w);
        w.resolve(proof);
      }
    }
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
export function attachTaskMonitor(context: BrowserContext, store: TaskStore): void {
  const hook = (page: Page): void => {
    page.on('response', async (res) => {
      const url = res.url();
      const isTaskList = url.includes(TASK_LIST_PATH);
      const isDoAction = url.includes(DO_ACTION_PATH);
      const isGrant = url.includes(GRANT_PATH);
      if (!isTaskList && !isDoAction && !isGrant) return;

      // Body có thể không đọc được nếu response bị huỷ giữa đường.
      const body = await res.text().catch(() => null);
      if (body === null) return;

      if (isTaskList) {
        store.pushTaskList(body);
        return;
      }
      if (isDoAction) {
        const proof = parseDoAction(res.request().postData() ?? '', body);
        if (proof) store.pushAction(proof);
        return;
      }
      try {
        const j = JSON.parse(body) as { err_no?: number; err_tips?: string };
        store.pushGrant({
          errNo: Number(j.err_no ?? -1),
          errTips: String(j.err_tips ?? ''),
          at: Date.now(),
        });
      } catch {
        // grant_reward chỉ để quan sát; không parse được thì bỏ qua.
      }
    });
  };

  context.pages().forEach(hook);
  context.on('page', hook);
}
