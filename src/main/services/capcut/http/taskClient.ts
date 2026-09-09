import type { CapcutTask, TaskSnapshot } from './taskTypes';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
  return value;
}

/** Parse HTTP discovery without loading the UI monitor or conflating empty with failure. */
export function parseHttpTaskList(value: unknown, at = Date.now()): TaskSnapshot {
  const root = record(value);
  if (typeof root.err_no !== 'number') throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
  if (root.err_no !== 0) throw new Error('CAPCUT_HTTP_TASK_LIST_REJECTED');
  const list = record(root.data).task_list;
  if (!Array.isArray(list) || !Number.isFinite(at) || at < 0) throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
  const byKey = new Map<string, CapcutTask>();
  const taskIds = new Set<number>();
  let totalReward = 0;
  let earnedReward = 0;
  const doneKeys: string[] = [];
  for (const item of list) {
    const task = record(item);
    const view = task.task_view === undefined ? {} : record(task.task_view);
    const relation = task.task_relation === undefined ? {} : record(task.task_relation);
    const reward = record(task.task_reward_view).reward_amount;
    const key = task.task_key;
    const id = task.task_id;
    const status = task.task_status;
    const children = relation.child_task_ids ?? [];
    if (typeof key !== 'string' || !key.trim() || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof status !== 'number' || ![1, 2, 4].includes(status) ||
        typeof reward !== 'number' || !Number.isFinite(reward) || reward < 0 ||
        !Array.isArray(children) || children.some(child => !Number.isSafeInteger(child) || child <= 0) ||
        new Set(children).size !== children.length || byKey.has(key) || taskIds.has(id)) {
      throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
    }
    taskIds.add(id);
    byKey.set(key, { taskKey: key, taskId: id, title: optionalText(view.title), reward,
      status, buttonText: optionalText(view.button_text), childIds: [...children] });
    totalReward += reward;
    if (status === 4) { earnedReward += reward; doneKeys.push(key); }
  }
  if (!Number.isFinite(totalReward) || !Number.isFinite(earnedReward)) throw new Error('CAPCUT_HTTP_TASK_LIST_INVALID');
  return { at, byKey, totalReward, earnedReward, doneKeys };
}
