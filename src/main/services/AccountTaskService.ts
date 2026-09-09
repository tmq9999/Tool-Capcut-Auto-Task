import type { AccountTaskRepository } from '../repositories/AccountTaskRepository';
import {
  CAPCUT_TASK_STATUS,
  type AccountTasksRequestDTO,
  type AccountTasksResponseDTO
} from '../../shared/schemas/account-task.schema';

/**
 * Đọc tiến độ 12 nhiệm vụ của một account.
 *
 * Bảng `account_tasks` trước đây CHỈ ĐƯỢC GHI: `listByAccount` không có consumer
 * nào ngoài test, không có kênh IPC, UI không thấy — dữ liệu quý nhất của tool
 * nằm im trong DB (audit 04/09/2026). Service này là tầng duy nhất giữa IPC và
 * repository (AGENTS §7/§11).
 */
export class AccountTaskService {
  constructor(private readonly repo: AccountTaskRepository) {}

  listByAccount(request: AccountTasksRequestDTO): AccountTasksResponseDTO {
    const receiptData = this.repo.getLatestReceipt(request.accountId);
    const historicalRows = this.repo.listByAccount(request.accountId);

    if (!receiptData) {
      let doneCount = 0;
      let creditsEarned = 0;
      for (const row of historicalRows) {
        if (row.status === CAPCUT_TASK_STATUS.DONE) {
          doneCount += 1;
          creditsEarned += row.reward;
        }
      }

      return {
        items: historicalRows.map((row) => ({
          taskKey: row.taskKey,
          title: row.title,
          reward: row.reward,
          status: row.status,
          opId: row.opId,
          provedAt: row.provedAt,
          updatedAt: row.updatedAt
        })),
        doneCount,
        creditsEarned,
        verification: {
          state: 'missing',
          runId: null,
          observedAt: null,
          serverTotal: historicalRows.length,
          serverDone: doneCount
        }
      };
    }

    const { receipt, items: receiptItems } = receiptData;
    const taskMap = new Map(historicalRows.map((r) => [r.taskKey, r]));

    let isStale = !receipt.isFresh;
    if (receipt.serverTotal !== receiptItems.length) {
      isStale = true;
    }
    const doneItemCount = receiptItems.filter((i) => i.status === CAPCUT_TASK_STATUS.DONE).length;
    if (receipt.serverDone !== doneItemCount) {
      isStale = true;
    }
    const keySet = new Set<string>();
    for (const item of receiptItems) {
      if (keySet.has(item.taskKey)) {
        isStale = true;
      }
      keySet.add(item.taskKey);
      if (!taskMap.has(item.taskKey)) {
        isStale = true;
      }
    }

    let state: 'verified' | 'partial' | 'stale' = 'partial';
    if (isStale) {
      state = 'stale';
    } else if (
      receipt.isFinal &&
      receiptItems.every((i) => i.status === CAPCUT_TASK_STATUS.DONE)
    ) {
      state = 'verified';
    }

    const items = receiptItems.map((item) => {
      const task = taskMap.get(item.taskKey);
      return {
        taskKey: item.taskKey,
        title: task?.title ?? item.taskKey,
        reward: task?.reward ?? 0,
        status: item.status,
        opId: task?.opId ?? null,
        provedAt: task?.provedAt ?? null,
        updatedAt: task?.updatedAt ?? receipt.updatedAt
      };
    });

    const doneCount = receipt.serverDone;
    const creditsEarned = items.reduce(
      (sum, item) => (item.status === CAPCUT_TASK_STATUS.DONE ? sum + item.reward : sum),
      0
    );

    return {
      items,
      doneCount,
      creditsEarned,
      verification: {
        state,
        runId: receipt.runId,
        observedAt: receipt.observedAt,
        serverTotal: receipt.serverTotal,
        serverDone: receipt.serverDone
      }
    };
  }
}
