import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { LogRepository } from '../../repositories/LogRepository';
import { LogBus, type ILogSink, type LogBusScheduler } from '../LogBus';
import type { CanonicalRuntimeLog } from '../../shared/../../shared/schemas/log.schema';

class FakeScheduler implements LogBusScheduler {
  public interval: { fn: () => void; ms: number } | null = null;
  public cleared = false;

  setInterval(fn: () => void, ms: number): number {
    this.interval = { fn, ms };
    return 1;
  }

  clearInterval(): void {
    this.cleared = true;
  }

  tick(): void {
    this.interval?.fn();
  }
}

class FailingSink implements ILogSink {
  public attempts = 0;
  insertBatch(): void {
    this.attempts += 1;
    throw new Error('disk full');
  }
}

let tmpDir: string;
let db: Database.Database;
let logRepo: LogRepository;
let scheduler: FakeScheduler;
let now: number;
let idCounter: number;

function createBus(sink: ILogSink = logRepo, maxBatchSize = 100): LogBus {
  return new LogBus(
    sink,
    { maxBatchSize, flushIntervalMs: 500 },
    {
      now: () => now,
      nextId: () => 'log-' + ++idCounter,
      scheduler
    }
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-logbus-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  logRepo = new LogRepository(db);
  scheduler = new FakeScheduler();
  now = Date.parse('2026-09-01T03:32:31.000Z');
  idCounter = 0;
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('LogBus.emit', () => {
  it('stamps each entry with an id and an ISO timestamp', () => {
    const bus = createBus();

    const entry = bus.emit({
      email: 'worker@example.com',
      step: 'Proxy',
      status: 'ERROR',
      message: 'Proxy connection timeout'
    });

    expect(entry).toEqual({
      id: 'log-1',
      email: 'worker@example.com',
      step: 'Proxy',
      status: 'ERROR',
      message: 'Proxy connection timeout',
      createdAt: '2026-09-01T03:32:31.000Z',
      streamSequence: 1
    });
  });

  it('delivers the entry to subscribers immediately for the live log panel', () => {
    const bus = createBus();
    const received: CanonicalRuntimeLog[] = [];
    bus.subscribe((log) => received.push(log));

    bus.emit({ email: 'system', step: 'Bootstrap', status: 'INFO', message: 'ready' });

    expect(received.map((log) => log.message)).toEqual(['ready']);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createBus();
    const received: CanonicalRuntimeLog[] = [];
    const unsubscribe = bus.subscribe((log) => received.push(log));

    unsubscribe();
    bus.emit({ email: 'system', step: 'Bootstrap', status: 'INFO', message: 'ready' });

    expect(received).toHaveLength(0);
  });

  it('keeps an accountId when one is supplied', () => {
    const bus = createBus();
    const entry = bus.emit({
      accountId: 'acc-1',
      email: 'a@b.com',
      step: 'Init',
      status: 'INFO',
      message: 'start'
    });
    expect(entry.accountId).toBe('acc-1');
  });
});

describe('LogBus batching', () => {
  it('queues entries instead of writing one row per emit', () => {
    const bus = createBus();

    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'one' });
    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'two' });

    expect(bus.pendingCount()).toBe(2);
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(0);
  });

  it('writes the whole queue on flush and empties it', () => {
    const bus = createBus();
    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'one' });
    bus.emit({ email: 'a@b.com', step: 'S', status: 'SUCCESS', message: 'two' });

    bus.flush();

    expect(bus.pendingCount()).toBe(0);
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(2);
  });

  it('flushes automatically once the batch size is reached', () => {
    const bus = createBus(logRepo, 2);

    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'one' });
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(0);

    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'two' });
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(2);
  });

  it('flushes on the scheduled interval once started', () => {
    const bus = createBus();
    bus.start();
    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'one' });

    scheduler.tick();

    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(1);
    expect(scheduler.interval?.ms).toBe(500);
  });
});

describe('LogBus resilience and shutdown', () => {
  it('keeps entries queued when the sink fails so they are not lost', () => {
    const sink = new FailingSink();
    const bus = createBus(sink);
    bus.emit({ email: 'a@b.com', step: 'S', status: 'ERROR', message: 'one' });

    bus.flush();

    expect(sink.attempts).toBe(1);
    expect(bus.pendingCount()).toBe(1);
  });

  it('flushes what is left and stops the timer on dispose', () => {
    const bus = createBus();
    bus.start();
    bus.emit({ email: 'a@b.com', step: 'S', status: 'INFO', message: 'last' });

    bus.dispose();

    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(1);
    expect(scheduler.cleared).toBe(true);
  });

  it('does nothing on flush when the queue is empty', () => {
    const sink = new FailingSink();
    const bus = createBus(sink);

    bus.flush();

    expect(sink.attempts).toBe(0);
  });

  it('UI-02 clear discards queued old logs, not later logs', () => {
    const bus = createBus();
    bus.emit({ email: 'system', step: 'test', status: 'INFO', message: 'old' });
    bus.clear(() => logRepo.clearAllLogs());
    bus.emit({ email: 'system', step: 'test', status: 'INFO', message: 'new' });
    bus.flush();
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).items.map((x) => x.message)).toEqual(['new']);
  });

  it('UI-03 a stale account ID does not poison an entire batch', () => {
    const bus = createBus();
    bus.emit({ accountId: 'deleted', email: 'old@example.test', step: 'test', status: 'INFO', message: 'old' });
    bus.emit({ email: 'system', step: 'test', status: 'INFO', message: 'other' });
    bus.flush();
    expect(bus.pendingCount()).toBe(0);
    expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).items).toHaveLength(2);
  });

  describe('T07 StartLogResetPort', () => {
    it('capture and commit resets existing DB and queue logs while preserving newer logs', () => {
      const bus = createBus();
      let resetPayload: { clearedThrough: number } | null = null;
      bus.onReset((p) => { resetPayload = p; });

      // 1 log in DB, 1 log in queue
      bus.emit({ email: 'old@example.test', step: 'old1', status: 'INFO', message: 'old in DB' });
      bus.flush();
      bus.emit({ email: 'old@example.test', step: 'old2', status: 'INFO', message: 'old in queue' });

      expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(1);
      expect(bus.pendingCount()).toBe(1);

      const ticket = bus.capture('run-1');
      expect(ticket.ids.length).toBe(2);

      // A newer preflight log arrives AFTER capture
      bus.emit({ email: 'system', step: 'Preflight', status: 'INFO', message: 'new preflight' });
      expect(bus.pendingCount()).toBe(2);

      const result = bus.commit(ticket);
      expect(result.clearedThrough).toBe(ticket.throughSequence);
      expect(resetPayload).toEqual({ clearedThrough: ticket.throughSequence });

      // After commit, old logs in DB and queue are gone, new preflight remains
      expect(logRepo.queryLogs({ page: 1, pageSize: 50 }).total).toBe(0);
      expect(bus.pendingCount()).toBe(1);

      bus.flush();
      const logsInDb = logRepo.queryLogs({ page: 1, pageSize: 50 }).items;
      expect(logsInDb).toHaveLength(1);
      expect(logsInDb[0].message).toBe('new preflight');
    });

    it('commit throws if ticket is committed twice', () => {
      const bus = createBus();
      const ticket = bus.capture('run-2');
      bus.commit(ticket);
      expect(() => bus.commit(ticket)).toThrow(/already been committed/);
    });

    it('listener throwing does not fail commit', () => {
      const bus = createBus();
      bus.onReset(() => { throw new Error('listener crash'); });
      const ticket = bus.capture('run-3');
      expect(() => bus.commit(ticket)).not.toThrow();
    });
  });

  describe('T11 retry schedule, FIFO recovery, and shutdown', () => {
    it('T11 failed writes wait for retry schedule and recover FIFO', () => {
      let failing = true;
      const attempts: number[] = [];
      const saved: string[] = [];
      const bus = createBus({
        insertBatch: (rows) => {
          attempts.push(rows.length);
          if (failing) throw new Error('fixture disk full');
          saved.push(...rows.map((row) => row.id));
        }
      }, 50);
      bus.start();
      const emitted: string[] = [];
      for (let i = 0; i < 1000; i += 1) {
        emitted.push(bus.emit({ email: 'system', step: 'fixture', status: 'INFO', message: String(i) }).id);
      }
      expect(attempts).toEqual([50]);
      scheduler.tick();
      expect(attempts).toHaveLength(1);
      now += 500;
      scheduler.tick();
      expect(attempts).toEqual([50, 50]);
      failing = false;
      for (let i = 0; i < 20; i += 1) {
        now += 500;
        scheduler.tick();
      }
      expect(saved).toEqual(emitted);
      expect(bus.pendingCount()).toBe(0);
      bus.dispose();
    });

    it('T11 dispose throws LOG_FLUSH_INCOMPLETE when pending entries remain after final forced attempt', () => {
      const failingSink: ILogSink = {
        insertBatch: () => {
          throw new Error('failing disk');
        }
      };
      const bus = createBus(failingSink, 50);
      bus.emit({ email: 'system', step: 'fixture', status: 'INFO', message: 'pending log' });
      expect(bus.pendingCount()).toBe(1);

      expect(() => bus.dispose()).toThrow('LOG_FLUSH_INCOMPLETE');
      expect(bus.pendingCount()).toBe(1);
    });
  });
});

