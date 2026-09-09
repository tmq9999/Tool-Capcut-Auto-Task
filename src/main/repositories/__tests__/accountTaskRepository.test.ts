import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { MIGRATIONS } from '../../database/migrations';
import { AccountTaskRepository } from '../AccountTaskRepository';

interface SqliteMasterRow {
  name: string;
}

interface QueryPlanRow {
  detail: string;
}

interface CountRow {
  count: number;
}

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-account-tasks-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migration 004 — bảng tiến độ nhiệm vụ', () => {
  it('tạo bảng account_tasks với khoá chính (account_id, task_key)', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[])
      .map((row) => row.name);
    expect(tables).toContain('account_tasks');

    // Khoá chính đôi là thứ bảo đảm mỗi (account, nhiệm vụ) chỉ có MỘT dòng.
    const insert = db.prepare(
      "INSERT INTO account_tasks (account_id, task_key, title, reward, status, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, datetime('now'))"
    );
    insert.run('acc-1', 'capcut_web_pwa_install', 'Install app', 30, 4);
    expect(() => insert.run('acc-1', 'capcut_web_pwa_install', 'Install app', 30, 4)).toThrow();
  });

  it('tạo index theo account_id và planner thật sự dùng nó', () => {
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as SqliteMasterRow[])
      .map((row) => row.name);
    expect(indexes).toContain('idx_account_tasks_account_id');

    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM account_tasks WHERE account_id = ?')
      .all('acc-1') as QueryPlanRow[];
    expect(plan.some((row) => row.detail.includes('USING INDEX idx_account_tasks_account_id'))).toBe(true);
  });

  it('chạy lại migration không mất dòng tiến độ đã có', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [
      { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4, opId: 'op-1' }
    ]);

    // Idempotent: lượt sau không áp dụng lại migration nào và dữ liệu còn nguyên.
    expect(runMigrations(db).appliedCount).toBe(0);
    expect(repo.listByAccount('acc-1')).toHaveLength(1);
    expect(repo.listByAccount('acc-1')[0].opId).toBe('op-1');
  });

  it('cho phép hai account cùng làm một nhiệm vụ', () => {
    const repo = new AccountTaskRepository(db);
    const row = { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4 };

    repo.upsertMany('acc-1', [row]);
    repo.upsertMany('acc-2', [row]);

    expect(repo.listByAccount('acc-1')).toHaveLength(1);
    expect(repo.listByAccount('acc-2')).toHaveLength(1);
  });

  it('nâng cấp DB đang ở version 3 mà không mất dữ liệu cũ', () => {
    // DB của người dùng đang chạy bản trước Pha 5: chỉ có migration 1..3.
    const legacy = createDatabaseConnection(path.join(tmpDir, 'legacy.db'));
    try {
      expect(runMigrations(legacy, MIGRATIONS.slice(0, 3)).appliedCount).toBe(3);
      legacy.prepare(
        "INSERT INTO accounts (id, email, email_provider, credit) VALUES ('acc-old', 'old@example.com', 'gmail94', 42)"
      ).run();

      // Nâng lên bản có 004: chỉ áp dụng thêm 1 migration, không đụng bảng cũ.
      expect(runMigrations(legacy, MIGRATIONS.slice(0, 4)).appliedCount).toBe(1);

      const account = legacy.prepare("SELECT email, credit FROM accounts WHERE id = 'acc-old'")
        .get() as { email: string; credit: number } | undefined;
      expect(account).toEqual({ email: 'old@example.com', credit: 42 });

      new AccountTaskRepository(legacy).upsertMany('acc-old', [
        { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4 }
      ]);
      expect(new AccountTaskRepository(legacy).listByAccount('acc-old')).toHaveLength(1);
    } finally {
      if (legacy.open) legacy.close();
    }
  });
});

describe('AccountTaskRepository.upsertMany', () => {
  it('persists an unsettled proof omitted from the receipt without inventing a status row', () => {
    const repo = new AccountTaskRepository(db);
    repo.recordCheckpoint('proof-account', {
      rows: [{ key: 'visible-task', title: 'Visible', reward: 1, status: 1 }],
      unsettledProofs: [{ key: 'omitted-task', proof: { actionKey: 'omitted-task', opId: 'offline-op', errNo: 0, at: 100 } }],
      receipt: { runId: 'run-proof', sessionAlias: 'worker-1-session-1', observedAt: '2026-09-08T01:00:00.000Z',
        requiredAfter: '2026-09-08T00:59:00.000Z', serverTotal: 1, serverDone: 0, isFresh: true, isFinal: false }
    });
    expect(repo.listByAccount('proof-account').map((row) => row.taskKey)).toEqual(['visible-task']);
    expect(repo.getLatestReceipt('proof-account')?.items.map((item) => item.taskKey)).toEqual(['visible-task']);
    expect(repo.listUnsettledProofs('proof-account', 'run-proof')).toEqual([
      { key: 'omitted-task', opId: 'offline-op', provedAt: new Date(100).toISOString() }
    ]);
    expect(repo.listUnsettledProofs('proof-account', 'run-other')).toEqual([]);
    expect(() => repo.recordCheckpoint('proof-account', {
      rows: [{ key: 'changed-task', title: 'Changed', reward: 2, status: 4 }],
      unsettledProofs: [{ key: 'wrong-key', proof: { actionKey: 'different', opId: 'bad', errNo: 0, at: 200 } }],
      receipt: { runId: 'run-bad', sessionAlias: 'worker-1-session-2', observedAt: '2026-09-08T02:00:00.000Z',
        requiredAfter: '2026-09-08T01:59:00.000Z', serverTotal: 1, serverDone: 1, isFresh: true, isFinal: false }
    })).toThrow('INVALID_UNSETTLED_PROOF');
    expect(repo.getLatestReceipt('proof-account')?.receipt.runId).toBe('run-proof');
    expect(repo.listByAccount('proof-account').map((row) => row.taskKey)).toEqual(['visible-task']);
    expect(repo.listUnsettledProofs('proof-account', 'run-proof')).toHaveLength(1);
    repo.deleteByAccount('proof-account');
    expect(repo.listUnsettledProofs('proof-account', 'run-proof')).toEqual([]);
  });
  it('ghi cả lượt chạy và giữ đúng status của CapCut, không phải cờ nội bộ', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [
      { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4, opId: 'capcut_web_pwa_install_7_2026-09-03', provedAt: '2026-09-03T01:00:00.000Z' },
      { key: 'capcut_web_video_studio_export', title: 'Export video', reward: 120, status: 1 }
    ]);

    const rows = repo.listByAccount('acc-1');
    expect(rows.map((row) => row.taskKey)).toEqual([
      'capcut_web_pwa_install', 'capcut_web_video_studio_export'
    ]);
    expect(rows[0]).toMatchObject({
      accountId: 'acc-1',
      title: 'Install app',
      reward: 30,
      status: 4,
      opId: 'capcut_web_pwa_install_7_2026-09-03',
      provedAt: '2026-09-03T01:00:00.000Z'
    });
    expect(rows[1]).toMatchObject({ status: 1, opId: null, provedAt: null });
    expect(typeof rows[0].updatedAt).toBe('string');
  });

  it('cập nhật đúng bản ghi cùng (account_id, task_key) thay vì thêm dòng mới', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [
      { key: 'capcut_web_video_studio_export', title: 'Export video', reward: 120, status: 1 }
    ]);
    repo.upsertMany('acc-1', [
      {
        key: 'capcut_web_video_studio_export',
        title: 'Export video (đổi tên)',
        reward: 130,
        status: 4,
        opId: 'capcut_web_video_studio_export_7_2026-09-03',
        provedAt: '2026-09-03T02:00:00.000Z'
      }
    ]);

    const rows = repo.listByAccount('acc-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Export video (đổi tên)',
      reward: 130,
      status: 4,
      opId: 'capcut_web_video_studio_export_7_2026-09-03',
      provedAt: '2026-09-03T02:00:00.000Z'
    });
  });

  it('không xoá bằng chứng cũ khi lượt sau không có do_action nào', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [
      { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4, opId: 'op-hom-truoc', provedAt: '2026-09-02T10:00:00.000Z' }
    ]);
    // Lượt sau: CapCut vẫn báo xong nhưng KHÔNG có do_action mới nên engine không
    // có proof — ghi đè thẳng sẽ xoá mất op_id của đúng ngày nó được nhận.
    repo.upsertMany('acc-1', [
      { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4 }
    ]);

    const rows = repo.listByAccount('acc-1');
    expect(rows[0].opId).toBe('op-hom-truoc');
    expect(rows[0].provedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('ghi cả lượt trong một transaction — một dòng lỗi thì không dòng nào vào', () => {
    const repo = new AccountTaskRepository(db);
    expect(() =>
      repo.upsertMany('acc-1', [
        { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4 },
        // title NOT NULL: dòng thứ hai vi phạm ràng buộc.
        { key: 'capcut_web_push_authorize', title: null as unknown as string, reward: 30, status: 1 }
      ])
    ).toThrow();

    const count = db.prepare('SELECT COUNT(*) as count FROM account_tasks').get() as CountRow;
    expect(count.count).toBe(0);
  });

  it('không chạy câu lệnh nào khi danh sách rỗng', () => {
    const repo = new AccountTaskRepository(db);
    expect(() => repo.upsertMany('acc-1', [])).not.toThrow();
    expect(repo.listByAccount('acc-1')).toEqual([]);
  });
});

describe('AccountTaskRepository đọc và dọn', () => {
  it('chỉ trả tiến độ của account được hỏi', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [{ key: 'k-a', title: 'A', reward: 10, status: 4 }]);
    repo.upsertMany('acc-2', [{ key: 'k-b', title: 'B', reward: 20, status: 1 }]);

    expect(repo.listByAccount('acc-1').map((row) => row.taskKey)).toEqual(['k-a']);
    expect(repo.listByAccount('acc-3')).toEqual([]);
  });

  it('xoá tiến độ của một account mà không đụng account khác', () => {
    const repo = new AccountTaskRepository(db);
    repo.upsertMany('acc-1', [
      { key: 'k-a', title: 'A', reward: 10, status: 4 },
      { key: 'k-b', title: 'B', reward: 20, status: 1 }
    ]);
    repo.upsertMany('acc-2', [{ key: 'k-a', title: 'A', reward: 10, status: 4 }]);

    expect(repo.deleteByAccount('acc-1')).toBe(2);
    expect(repo.listByAccount('acc-1')).toEqual([]);
    expect(repo.listByAccount('acc-2')).toHaveLength(1);
  });
});

describe('AccountTaskRepository.recordCheckpoint', () => {
  it('records task rows and their exact receipt set in one transaction', () => {
    const repo = new AccountTaskRepository(db);
    repo.recordCheckpoint('acc-1', {
      rows: [
        { key: 'A', title: 'Task A', reward: 10, status: 4 },
        { key: 'B', title: 'Task B', reward: 20, status: 1 }
      ],
      receipt: {
        runId: 'run-1',
        sessionAlias: 'session-1',
        observedAt: '2026-09-08T01:00:00.000Z',
        requiredAfter: '2026-09-08T00:59:00.000Z',
        serverTotal: 2,
        serverDone: 1,
        isFresh: true,
        isFinal: false
      }
    });

    const rows = repo.listByAccount('acc-1');
    expect(rows.map((r) => r.taskKey)).toEqual(['A', 'B']);

    const receiptData = repo.getLatestReceipt('acc-1');
    expect(receiptData).not.toBeNull();
    expect(receiptData?.receipt.runId).toBe('run-1');
    expect(receiptData?.receipt.serverTotal).toBe(2);
    expect(receiptData?.receipt.serverDone).toBe(1);
    expect(receiptData?.receipt.isFresh).toBe(true);
    expect(receiptData?.receipt.isFinal).toBe(false);
    expect(receiptData?.items.map((i) => ({ key: i.taskKey, status: i.status }))).toEqual([
      { key: 'A', status: 4 },
      { key: 'B', status: 1 }
    ]);
  });

  it('transactionally replaces the prior receipt item set', () => {
    const repo = new AccountTaskRepository(db);
    repo.recordCheckpoint('acc-1', {
      rows: [
        { key: 'A', title: 'Task A', reward: 10, status: 4 },
        { key: 'B', title: 'Task B', reward: 20, status: 1 }
      ],
      receipt: {
        runId: 'run-1',
        sessionAlias: 'session-1',
        observedAt: '2026-09-08T01:00:00.000Z',
        requiredAfter: '2026-09-08T00:59:00.000Z',
        serverTotal: 2,
        serverDone: 1,
        isFresh: true,
        isFinal: false
      }
    });

    repo.recordCheckpoint('acc-1', {
      rows: [
        { key: 'A', title: 'Task A', reward: 10, status: 4 },
        { key: 'C', title: 'Task C', reward: 30, status: 2 }
      ],
      receipt: {
        runId: 'run-2',
        sessionAlias: 'session-2',
        observedAt: '2026-09-08T01:05:00.000Z',
        requiredAfter: '2026-09-08T01:04:00.000Z',
        serverTotal: 2,
        serverDone: 1,
        isFresh: true,
        isFinal: false
      }
    });

    const receiptData = repo.getLatestReceipt('acc-1');
    expect(receiptData?.items.map((i) => ({ key: i.taskKey, status: i.status }))).toEqual([
      { key: 'A', status: 4 },
      { key: 'C', status: 2 }
    ]);

    const allRows = repo.listByAccount('acc-1');
    expect(allRows.map((r) => r.taskKey)).toContain('B');
  });

  it('keeps prior opId and provedAt when a later snapshot has no new proof', () => {
    const repo = new AccountTaskRepository(db);
    repo.recordCheckpoint('acc-1', {
      rows: [
        {
          key: 'A',
          title: 'Task A',
          reward: 10,
          status: 1,
          opId: 'op-a',
          provedAt: '2026-09-08T01:00:00.000Z'
        }
      ],
      receipt: {
        runId: 'run-1',
        sessionAlias: 'session-1',
        observedAt: '2026-09-08T01:00:00.000Z',
        requiredAfter: '2026-09-08T00:59:00.000Z',
        serverTotal: 1,
        serverDone: 0,
        isFresh: true,
        isFinal: false
      }
    });

    repo.recordCheckpoint('acc-1', {
      rows: [
        {
          key: 'A',
          title: 'Task A',
          reward: 10,
          status: 4
        }
      ],
      receipt: {
        runId: 'run-2',
        sessionAlias: 'session-1',
        observedAt: '2026-09-08T01:02:00.000Z',
        requiredAfter: '2026-09-08T01:01:00.000Z',
        serverTotal: 1,
        serverDone: 1,
        isFresh: true,
        isFinal: true
      }
    });

    const rows = repo.listByAccount('acc-1');
    expect(rows[0].status).toBe(4);
    expect(rows[0].opId).toBe('op-a');
    expect(rows[0].provedAt).toBe('2026-09-08T01:00:00.000Z');
  });

  it('rolls back rows receipt and receipt items when any write fails', () => {
    const repo = new AccountTaskRepository(db);
    expect(() =>
      repo.recordCheckpoint('acc-1', {
        rows: [
          { key: 'A', title: 'Task A', reward: 10, status: 4 },
          { key: 'B', title: null as unknown as string, reward: 20, status: 1 }
        ],
        receipt: {
          runId: 'run-1',
          sessionAlias: 'session-1',
          observedAt: '2026-09-08T01:00:00.000Z',
          requiredAfter: '2026-09-08T00:59:00.000Z',
          serverTotal: 2,
          serverDone: 1,
          isFresh: true,
          isFinal: false
        }
      })
    ).toThrow();

    expect(repo.listByAccount('acc-1')).toHaveLength(0);
    expect(repo.getLatestReceipt('acc-1')).toBeNull();
    const itemCount = db.prepare('SELECT COUNT(*) as count FROM account_task_receipt_items').get() as { count: number };
    expect(itemCount.count).toBe(0);
  });
});
