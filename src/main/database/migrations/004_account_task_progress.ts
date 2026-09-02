/**
 * Tiến độ TỪNG NHIỆM VỤ của mỗi account (thay chỗ của `ledger.ts` +
 * `.state/accounts.json` bên engine CLI — xem `docs/MERGE-PLAN.md` §2 và §4 Pha 5).
 *
 * Vì sao `status` là số của CHÍNH CapCut (1 = chưa xong, 2 = chờ nhận, 4 = xong)
 * chứ không phải cờ nội bộ: nguồn sự thật duy nhất về một nhiệm vụ là
 * `task_status` trong `GET /task/v1/task_list` (`capcut/taskApi.ts`). Bộ đếm nội
 * bộ đã đo được là báo THỪA — bản CLI cũ in "7/10" trong khi CapCut chỉ ghi nhận
 * ít hơn (`capcut/runTasks.ts` phần chú thích `summarize`). Lưu đúng con số của
 * CapCut thì lượt sau so sánh được trực tiếp với snapshot mới, không cần dịch
 * qua bất kỳ bảng ánh xạ nào.
 *
 * Vì sao có `op_id`: bằng chứng hoàn thành là `POST /task/v1/do_action` với
 * `err_no === 0`, và request đó mang `op_id` dạng
 * `<task_key>_<userId>_<YYYY-MM-DD>` (đo được trong lượt capture 12/12 nhiệm vụ).
 * Giữ nguyên khái niệm `opId` của ledger cũ: cùng một `op_id` nghĩa là CÙNG một
 * lần chứng minh, nên ghi lại lần nữa không sinh thêm gì.
 *
 * Vì sao KHÔNG có FOREIGN KEY sang `accounts(id)`: kết nối bật
 * `PRAGMA foreign_keys = ON` (AGENTS.md §9), nên một account_id chưa/không còn
 * trong `accounts` sẽ làm INSERT ném. Ghi tiến độ là ghi chú bên lề của một phiên
 * browser đang sống — nó KHÔNG được phép làm vỡ luồng (chỉ log WARNING), nên
 * ràng buộc ở đây sẽ biến thành mất tiến độ âm thầm. Dọn dữ liệu mồ côi đi qua
 * `AccountTaskRepository.deleteByAccount()` một cách tường minh.
 *
 * Về index (AGENTS.md §19 — index phải khớp truy vấn thật): truy vấn duy nhất của
 * UI là "tiến độ của MỘT account" (`WHERE account_id = ?`). `PRIMARY KEY
 * (account_id, task_key)` đã tự sinh `sqlite_autoindex_account_tasks_1` phủ được
 * tiền tố đó, nên `idx_account_tasks_account_id` là index HẸP HƠN cho đúng truy
 * vấn ấy. Đo bằng `EXPLAIN QUERY PLAN`: khi có nó, planner chọn
 * `SEARCH account_tasks USING INDEX idx_account_tasks_account_id (account_id=?)`
 * chứ không dùng autoindex — nên nó không phải index chết.
 *
 * Idempotent: chỉ `CREATE TABLE/INDEX IF NOT EXISTS`, không `ALTER`, không
 * `DROP`, không đụng bảng nào đã có — chạy lại trên DB cũ không mất dữ liệu
 * (AGENTS.md §10).
 */
export const migration004 = `
CREATE TABLE IF NOT EXISTS account_tasks (
  account_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  reward INTEGER NOT NULL,
  status INTEGER NOT NULL,
  op_id TEXT,
  proved_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_account_tasks_account_id ON account_tasks(account_id);
`;
