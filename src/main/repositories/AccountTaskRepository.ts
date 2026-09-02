import type Database from 'better-sqlite3';

/**
 * =============================================================================
 * ACCOUNT TASK REPOSITORY — nơi DUY NHẤT có SQL của bảng `account_tasks`
 * =============================================================================
 * AGENTS.md §11: không service/provider nào được `db.prepare(...)` cho bảng này.
 * Engine automation thì càng không — nó không được đọc/ghi SQLite (AGENTS.md §30),
 * nên đường đi là: engine → `AutomationRunService` → collaborator `taskProgress`
 * → repository này.
 *
 * `status` là `task_status` của CHÍNH CapCut, không phải cờ nội bộ:
 *   1 = chưa xong · 2 = chờ nhận (Claim) · 4 = đã xong
 * Lý do đo được: bộ đếm nội bộ của bản CLI cũ báo THỪA ("7/10" trong khi CapCut
 * ghi nhận ít hơn), nên mọi kết luận đều phải quy về `task_status` trong
 * `GET /task/v1/task_list` (xem `services/capcut/taskApi.ts`).
 * =============================================================================
 */

/**
 * Một dòng tiến độ do engine trả về.
 *
 * Khai ở tầng repository (không import từ `services/`) để phụ thuộc vẫn chảy vào
 * trong theo AGENTS.md §7; `CapcutAccountResult['tasks']` khớp cấu trúc nên
 * `AutomationRunService` truyền thẳng xuống được.
 */
export interface AccountTaskProgressInput {
  /** `task_key` của CapCut — khoá định danh, KHÔNG dùng title vì có 2 nhiệm vụ trùng tên. */
  key: string;
  title: string;
  reward: number;
  /** `task_status` của CapCut: 1 chưa xong · 2 chờ nhận · 4 xong. */
  status: number;
  /** `op_id` của `do_action`: `<task_key>_<userId>_<YYYY-MM-DD>`. */
  opId?: string;
  /** Lúc thấy `do_action err_no=0`, dạng ISO. */
  provedAt?: string;
}

export interface AccountTaskRecord {
  accountId: string;
  taskKey: string;
  title: string;
  reward: number;
  status: number;
  opId: string | null;
  provedAt: string | null;
  updatedAt: string;
}

interface AccountTaskRow {
  account_id: string;
  task_key: string;
  title: string;
  reward: number;
  status: number;
  op_id: string | null;
  proved_at: string | null;
  updated_at: string;
}

function toRecord(row: AccountTaskRow): AccountTaskRecord {
  return {
    accountId: row.account_id,
    taskKey: row.task_key,
    title: row.title,
    reward: row.reward,
    status: row.status,
    opId: row.op_id,
    provedAt: row.proved_at,
    updatedAt: row.updated_at
  };
}

export class AccountTaskRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Ghi tiến độ của cả một lượt chạy trong MỘT transaction.
   *
   * `ON CONFLICT (account_id, task_key) DO UPDATE` chứ không DELETE-rồi-INSERT:
   * khoá chính đã bảo đảm mỗi (account, nhiệm vụ) chỉ có một dòng, nên ghi lại
   * cùng một lượt là idempotent — đúng vai của `op_id` (cùng `op_id` = CÙNG một
   * lần chứng minh, không phải lần nhận thưởng thứ hai).
   *
   * `op_id`/`proved_at` dùng `COALESCE(excluded.…, …)` để KHÔNG xoá bằng chứng cũ:
   * `runAllTasks` chỉ gắn `proof` cho nhiệm vụ mà `do_action` bắn TRONG lượt này.
   * Một nhiệm vụ đã xong từ hôm trước quay lại với `status = 4` nhưng KHÔNG có
   * proof; ghi đè thẳng sẽ xoá mất `op_id` của đúng cái ngày nó được nhận.
   *
   * `status`/`title`/`reward` thì luôn lấy bản mới, vì đó là số của CapCut và
   * CapCut là nguồn sự thật duy nhất.
   */
  upsertMany(accountId: string, rows: readonly AccountTaskProgressInput[]): void {
    if (rows.length === 0) return;

    const upsertStmt = this.db.prepare(`
      INSERT INTO account_tasks (
        account_id, task_key, title, reward, status, op_id, proved_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (account_id, task_key) DO UPDATE SET
        title = excluded.title,
        reward = excluded.reward,
        status = excluded.status,
        op_id = COALESCE(excluded.op_id, account_tasks.op_id),
        proved_at = COALESCE(excluded.proved_at, account_tasks.proved_at),
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction((items: readonly AccountTaskProgressInput[]) => {
      for (const row of items) {
        upsertStmt.run(
          accountId,
          row.key,
          row.title,
          row.reward,
          row.status,
          row.opId ?? null,
          row.provedAt ?? null
        );
      }
    });

    transaction(rows);
  }

  /** Tiến độ của một account. Thứ tự theo `task_key` để UI và test đều xác định. */
  listByAccount(accountId: string): AccountTaskRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM account_tasks WHERE account_id = ? ORDER BY task_key ASC'
    ).all(accountId) as AccountTaskRow[];
    return rows.map(toRecord);
  }

  /** Dọn tiến độ khi account bị xoá — bảng không có FOREIGN KEY nên phải gọi tay. */
  deleteByAccount(accountId: string): number {
    const result = this.db.prepare('DELETE FROM account_tasks WHERE account_id = ?').run(accountId);
    return result.changes;
  }
}
