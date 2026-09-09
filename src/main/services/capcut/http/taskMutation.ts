import type { HttpOnlyClient } from './httpTypes';

export interface TaskActionReceipt { actionKey: string; opId: string; status: number; errNo: number; errTips: string; }

/** Sends one account-scoped task acknowledgement; callers must reconcile task_list. */
export async function sendTaskAction(
  client: HttpOnlyClient,
  input: { actionKey: string; opId: string; headers?: Record<string, string>; query?: Record<string, string | number | boolean> },
  signal?: AbortSignal
): Promise<TaskActionReceipt> {
  if (!/^capcut_web_[a-z0-9_]+$/i.test(input.actionKey) || !input.opId.startsWith(input.actionKey + '_')) throw new Error('TASK_ACTION_INPUT_INVALID');
  const response = await client.requestJson<{ err_no?: number; err_tips?: string }>({
    path: '/luckycat/i18n/capcut/task/v1/do_action', method: 'POST', effect: 'mutation', signal,
    headers: input.headers, query: input.query, body: { action_key: input.actionKey, op_id: input.opId }
  });
  const errNo = Number(response.data.err_no ?? -1);
  const errTips = String(response.data.err_tips ?? '');
  if (!response.ok || errNo !== 0) throw new Error('TASK_ACTION_REJECTED_' + errNo);
  return { actionKey: input.actionKey, opId: input.opId, status: response.status, errNo, errTips };
}
