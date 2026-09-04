import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { AccountRepository } from '../../repositories/AccountRepository';
import { AccountTaskRepository } from '../../repositories/AccountTaskRepository';
import { AccountTaskService } from '../AccountTaskService';
import { CAPCUT_TASK_STATUS } from '../../../shared/schemas/account-task.schema';

let tmpDir: string;
let db: Database.Database;
let service: AccountTaskService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-tasksvc-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  new AccountRepository(db).createAccount({
    id: 'acc-1',
    email: 'worker@x.com',
    emailProvider: 'gmail94'
  });
  const taskRepo = new AccountTaskRepository(db);
  taskRepo.upsertMany('acc-1', [
    { key: 'task_a', title: 'Xem video', reward: 5, status: CAPCUT_TASK_STATUS.DONE, opId: 'op-a' },
    { key: 'task_b', title: 'Chat với AI', reward: 10, status: CAPCUT_TASK_STATUS.DONE },
    { key: 'task_c', title: 'Xuất video', reward: 20, status: CAPCUT_TASK_STATUS.OPEN },
    { key: 'task_d', title: 'Bật thông báo', reward: 3, status: CAPCUT_TASK_STATUS.CLAIMABLE }
  ]);
  service = new AccountTaskService(taskRepo);
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AccountTaskService', () => {
  it('trả về từng nhiệm vụ đã lưu của account', () => {
    const result = service.listByAccount({ accountId: 'acc-1' });

    expect(result.items.map((i) => i.taskKey)).toEqual(['task_a', 'task_b', 'task_c', 'task_d']);
    expect(result.items[0].title).toBe('Xem video');
    expect(result.items[0].opId).toBe('op-a');
  });

  /**
   * Đếm theo `task_status` của CHÍNH CapCut: chỉ 4 là xong. "Chờ nhận" (2) chưa
   * được tính — bộ đếm nội bộ của bản CLI cũ báo thừa đúng vì gộp hai loại này.
   */
  it('chỉ tính là xong khi CapCut ghi nhận status 4', () => {
    const result = service.listByAccount({ accountId: 'acc-1' });

    expect(result.doneCount).toBe(2);
  });

  it('cộng credit của riêng những nhiệm vụ đã xong', () => {
    const result = service.listByAccount({ accountId: 'acc-1' });

    expect(result.creditsEarned).toBe(15);
  });

  it('account chưa chạy nhiệm vụ nào thì trả về danh sách rỗng, không ném', () => {
    const result = service.listByAccount({ accountId: 'acc-khong-co' });

    expect(result).toEqual({ items: [], doneCount: 0, creditsEarned: 0 });
  });
});
