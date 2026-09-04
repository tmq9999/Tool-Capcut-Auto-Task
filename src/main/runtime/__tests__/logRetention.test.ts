/**
 * =============================================================================
 * DỌN LOG QUÁ HẠN — AGENTS.md §18
 * =============================================================================
 * Audit 04/09/2026: `LogRepository.cleanupOldLogs()` tồn tại và đã có test riêng,
 * nhưng grep toàn repo cho thấy KHÔNG consumer nào ngoài test — không ai gọi nó.
 * Settings có sẵn `logs.retention` mà cũng không ai đọc. `runtime_logs` phình vô
 * hạn: DB thật đã 1573 dòng chỉ sau MỘT ngày chạy.
 * =============================================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { LogRepository } from '../../repositories/LogRepository';
import { SettingsRepository } from '../../repositories/SettingsRepository';
import { LogBus, type ILogSink } from '../../services/LogBus';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings/default-settings';
import { runLogRetentionCleanup } from '../logRetention';
import type { CanonicalRuntimeLog } from '../../../shared/schemas/log.schema';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-retention-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Một dòng log có tuổi đặt trước, để đo đúng ranh giới ngày của retention. */
function agedLog(id: string, ageDays: number): CanonicalRuntimeLog {
  return {
    id,
    email: 'worker@example.com',
    step: 'Proxy',
    status: 'INFO',
    message: 'dong log ' + id,
    createdAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString()
  };
}

/** Gom mọi dòng LogBus phát ra để khẳng định đúng MỘT dòng tổng kết được ghi. */
function captureBus(): { bus: LogBus; emitted: CanonicalRuntimeLog[] } {
  const sink: ILogSink = { insertBatch: () => {} };
  const bus = new LogBus(sink, { maxBatchSize: 1000 });
  const emitted: CanonicalRuntimeLog[] = [];
  bus.subscribe((entry) => emitted.push(entry));
  return { bus, emitted };
}

function seedRetention(repo: SettingsRepository, retention: '7' | '30' | '90' | 'never'): void {
  repo.saveAppSettings({ ...DEFAULT_APP_SETTINGS, logs: { retention } });
}

describe('runLogRetentionCleanup', () => {
  it('xoá log quá hạn theo logs.retention và ghi số dòng đã xoá', () => {
    const logRepo = new LogRepository(db);
    const settingsRepo = new SettingsRepository(db);
    seedRetention(settingsRepo, '30');

    logRepo.insertBatch([
      agedLog('log-hom-nay', 0),
      agedLog('log-10-ngay', 10),
      agedLog('log-40-ngay', 40),
      agedLog('log-100-ngay', 100)
    ]);

    const { bus, emitted } = captureBus();
    runLogRetentionCleanup({ repositories: { logRepo, settingsRepo }, logBus: bus });

    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(2);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].status).toBe('INFO');
    expect(emitted[0].message).toContain('2');
  });

  it('tôn trọng retention 7 ngày', () => {
    const logRepo = new LogRepository(db);
    const settingsRepo = new SettingsRepository(db);
    seedRetention(settingsRepo, '7');

    logRepo.insertBatch([agedLog('log-3-ngay', 3), agedLog('log-10-ngay', 10)]);

    const { bus } = captureBus();
    runLogRetentionCleanup({ repositories: { logRepo, settingsRepo }, logBus: bus });

    const remaining = logRepo.queryLogs({ page: 1, pageSize: 50 });
    expect(remaining.total).toBe(1);
    expect(remaining.items[0].id).toBe('log-3-ngay');
  });

  it('retention = never thì KHÔNG xoá dòng nào và nói rõ là bỏ qua', () => {
    const logRepo = new LogRepository(db);
    const settingsRepo = new SettingsRepository(db);
    seedRetention(settingsRepo, 'never');

    logRepo.insertBatch([agedLog('log-1000-ngay', 1000)]);

    const { bus, emitted } = captureBus();
    runLogRetentionCleanup({ repositories: { logRepo, settingsRepo }, logBus: bus });

    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(1);
    expect(emitted[0].message).toContain('never');
  });

  it('DB chưa có bản ghi settings thì dùng mặc định 30 ngày', () => {
    const logRepo = new LogRepository(db);
    const settingsRepo = new SettingsRepository(db);

    logRepo.insertBatch([agedLog('log-40-ngay', 40), agedLog('log-1-ngay', 1)]);

    const { bus } = captureBus();
    runLogRetentionCleanup({ repositories: { logRepo, settingsRepo }, logBus: bus });

    const remaining = logRepo.queryLogs({ page: 1, pageSize: 50 });
    expect(remaining.total).toBe(1);
    expect(remaining.items[0].id).toBe('log-1-ngay');
  });

  /**
   * §18: "Never delete logs outside configured retention rules". Đọc settings hỏng
   * thì KHÔNG biết luật của người dùng là gì, nên không được lấy mặc định 30 ngày
   * ra xoá — xoá nhầm log của người đã đặt `never` là mất dữ liệu không lấy lại.
   */
  it('đọc settings hỏng thì KHÔNG xoá gì, chỉ cảnh báo', () => {
    const logRepo = new LogRepository(db);
    const brokenSettings = {
      getAppSettings: (): never => {
        throw new Error('app_settings corrupted');
      }
    };

    logRepo.insertBatch([agedLog('log-500-ngay', 500)]);

    const { bus, emitted } = captureBus();
    expect(() =>
      runLogRetentionCleanup({ repositories: { logRepo, settingsRepo: brokenSettings }, logBus: bus })
    ).not.toThrow();

    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(1);
    expect(emitted[0].status).toBe('WARNING');
  });

  /**
   * Tiền lệ cùng ngày: bản đóng gói chết ở bước DB_CONNECT với đúng một dòng
   * stderr. Dọn log là việc dọn dẹp, không phải điều kiện để app mở được.
   */
  it('lỗi khi xoá KHÔNG được ném ra ngoài làm vỡ khởi động', () => {
    const settingsRepo = new SettingsRepository(db);
    seedRetention(settingsRepo, '30');

    const brokenLogRepo = {
      cleanupOldLogs: (): never => {
        throw new Error('database is locked');
      }
    };

    const { bus, emitted } = captureBus();
    expect(() =>
      runLogRetentionCleanup({ repositories: { logRepo: brokenLogRepo, settingsRepo }, logBus: bus })
    ).not.toThrow();

    expect(emitted[0].status).toBe('WARNING');
    expect(emitted[0].message).toContain('database is locked');
  });
});
