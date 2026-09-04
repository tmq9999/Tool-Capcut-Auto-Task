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
    const rows = this.repo.listByAccount(request.accountId);

    let doneCount = 0;
    let creditsEarned = 0;
    for (const row of rows) {
      // Chỉ `4` là xong; `2` (chờ nhận) chưa được tính — quy về `task_status`
      // của CapCut, không suy diễn hộ nó.
      if (row.status === CAPCUT_TASK_STATUS.DONE) {
        doneCount += 1;
        creditsEarned += row.reward;
      }
    }

    return {
      items: rows.map((row) => ({
        taskKey: row.taskKey,
        title: row.title,
        reward: row.reward,
        status: row.status,
        opId: row.opId,
        provedAt: row.provedAt,
        updatedAt: row.updatedAt
      })),
      doneCount,
      creditsEarned
    };
  }
}
