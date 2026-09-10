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

export interface AccountTaskReceiptRecord {
  accountId: string;
  runId: string;
  sessionAlias: string;
  observedAt: string;
  requiredAfter: string;
  serverTotal: number;
  serverDone: number;
  isFresh: boolean;
  isFinal: boolean;
  updatedAt: string;
}

export interface AccountTaskReceiptItemRecord {
  accountId: string;
  taskKey: string;
  status: number;
  ordinal: number;
}

export interface AccountTaskCheckpointInput {
  rows: readonly AccountTaskProgressInput[];
  receipt: Omit<AccountTaskReceiptRecord, 'accountId' | 'updatedAt'>;
  unsettledProofs?: readonly {
    key: string;
    proof: { actionKey: string; opId: string; errNo: 0; at: number };
  }[];
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

  /**
   * Lưu checkpoint gồm các task row và receipt trong cùng MỘT transaction.
   * Xoá receipt items cũ và ghi lại toàn bộ receipt items mới theo thứ tự ordinal.
   */
  recordCheckpoint(accountId: string, checkpoint: AccountTaskCheckpointInput): void {
    if (checkpoint.receipt.serverTotal !== checkpoint.rows.length) {
      throw new Error(
        `Checkpoint serverTotal (${checkpoint.receipt.serverTotal}) does not match rows count (${checkpoint.rows.length})`
      );
    }

    const seen = new Set<string>();
    for (const row of checkpoint.rows) {
      if (seen.has(row.key)) {
        throw new Error(`Duplicate task key in checkpoint: ${row.key}`);
      }
      seen.add(row.key);
    }

    const upsertTaskStmt = this.db.prepare(`
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

    const upsertReceiptStmt = this.db.prepare(`
      INSERT INTO account_task_receipts (
        account_id, run_id, session_alias, observed_at, required_after,
        server_total, server_done, is_fresh, is_final, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (account_id) DO UPDATE SET
        run_id = excluded.run_id,
        session_alias = excluded.session_alias,
        observed_at = excluded.observed_at,
        required_after = excluded.required_after,
        server_total = excluded.server_total,
        server_done = excluded.server_done,
        is_fresh = excluded.is_fresh,
        is_final = excluded.is_final,
        updated_at = excluded.updated_at
    `);

    const deleteItemsStmt = this.db.prepare(
      'DELETE FROM account_task_receipt_items WHERE account_id = ?'
    );

    const insertItemStmt = this.db.prepare(`
      INSERT INTO account_task_receipt_items (
        account_id, task_key, status, ordinal
      ) VALUES (?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const row of checkpoint.rows) {
        upsertTaskStmt.run(
          accountId,
          row.key,
          row.title,
          row.reward,
          row.status,
          row.opId ?? null,
          row.provedAt ?? null
        );
      }

      upsertReceiptStmt.run(
        accountId,
        checkpoint.receipt.runId,
        checkpoint.receipt.sessionAlias,
        checkpoint.receipt.observedAt,
        checkpoint.receipt.requiredAfter,
        checkpoint.receipt.serverTotal,
        checkpoint.receipt.serverDone,
        checkpoint.receipt.isFresh ? 1 : 0,
        checkpoint.receipt.isFinal ? 1 : 0
      );

      this.db.prepare('DELETE FROM account_unsettled_proofs WHERE account_id = ?').run(accountId);
      const proofStmt = this.db.prepare(`
        INSERT INTO account_unsettled_proofs (account_id, run_id, task_key, op_id, proved_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of checkpoint.unsettledProofs ?? []) {
        if (item.key !== item.proof.actionKey || item.proof.errNo !== 0 || !Number.isFinite(item.proof.at)) {
          throw new Error('INVALID_UNSETTLED_PROOF');
        }
        proofStmt.run(accountId, checkpoint.receipt.runId, item.key, item.proof.opId, new Date(item.proof.at).toISOString());
      }

      deleteItemsStmt.run(accountId);

      let ordinal = 0;
      for (const row of checkpoint.rows) {
        insertItemStmt.run(accountId, row.key, row.status, ordinal);
        ordinal++;
      }
    });

    transaction();
  }

  /** Lấy receipt gần nhất cùng danh sách items theo thứ tự ordinal. */
  getLatestReceipt(accountId: string): {
    receipt: AccountTaskReceiptRecord;
    items: AccountTaskReceiptItemRecord[];
  } | null {
    interface ReceiptRow {
      account_id: string;
      run_id: string;
      session_alias: string;
      observed_at: string;
      required_after: string;
      server_total: number;
      server_done: number;
      is_fresh: number;
      is_final: number;
      updated_at: string;
    }
    interface ItemRow {
      account_id: string;
      task_key: string;
      status: number;
      ordinal: number;
    }

    const receiptRow = this.db
      .prepare('SELECT * FROM account_task_receipts WHERE account_id = ?')
      .get(accountId) as ReceiptRow | undefined;

    if (!receiptRow) return null;

    const itemRows = this.db
      .prepare(
        'SELECT * FROM account_task_receipt_items WHERE account_id = ? ORDER BY ordinal ASC'
      )
      .all(accountId) as ItemRow[];

    return {
      receipt: {
        accountId: receiptRow.account_id,
        runId: receiptRow.run_id,
        sessionAlias: receiptRow.session_alias,
        observedAt: receiptRow.observed_at,
        requiredAfter: receiptRow.required_after,
        serverTotal: receiptRow.server_total,
        serverDone: receiptRow.server_done,
        isFresh: Boolean(receiptRow.is_fresh),
        isFinal: Boolean(receiptRow.is_final),
        updatedAt: receiptRow.updated_at
      },
      items: itemRows.map((i) => ({
        accountId: i.account_id,
        taskKey: i.task_key,
        status: i.status,
        ordinal: i.ordinal
      }))
    };
  }

  /** Ghi riêng unsettled proofs khi không có receipt (ví dụ lỗi snapshot) */
  recordUnsettledProofs(
    accountId: string,
    runId: string,
    proofs: readonly { key: string; proof: { actionKey: string; opId: string; errNo: 0; at: number } }[]
  ): void {
    if (proofs.length === 0) return;

    const seen = new Set<string>();
    for (const item of proofs) {
      if (seen.has(item.key)) {
        throw new Error(`Duplicate unsettled proof key: ${item.key}`);
      }
      seen.add(item.key);
      if (
        item.key !== item.proof.actionKey ||
        item.proof.errNo !== 0 ||
        !Number.isFinite(item.proof.at) ||
        !item.proof.opId
      ) {
        throw new Error('INVALID_UNSETTLED_PROOF');
      }
    }

    const upsertStmt = this.db.prepare(`
      INSERT INTO account_unsettled_proofs (account_id, run_id, task_key, op_id, proved_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, run_id, task_key) DO UPDATE SET
        op_id = excluded.op_id,
        proved_at = excluded.proved_at
    `);

    const transaction = this.db.transaction(() => {
      for (const item of proofs) {
        upsertStmt.run(
          accountId,
          runId,
          item.key,
          item.proof.opId,
          new Date(item.proof.at).toISOString()
        );
      }
    });

    transaction();
  }

  /** Same-run proof is separate from exact status/receipt membership. */
  listUnsettledProofs(accountId: string, runId: string): Array<{ key: string; opId: string; provedAt: string }> {
    return this.db.prepare(`
      SELECT task_key AS key, op_id AS opId, proved_at AS provedAt
      FROM account_unsettled_proofs WHERE account_id = ? AND run_id = ? ORDER BY task_key
    `).all(accountId, runId) as Array<{ key: string; opId: string; provedAt: string }>;
  }

  /** Dọn tiến độ khi account bị xoá. */
  deleteByAccount(accountId: string): number {
    this.db.prepare('DELETE FROM account_unsettled_proofs WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM account_task_receipt_items WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM account_task_receipts WHERE account_id = ?').run(accountId);
    const result = this.db.prepare('DELETE FROM account_tasks WHERE account_id = ?').run(accountId);
    return result.changes;
  }
}
