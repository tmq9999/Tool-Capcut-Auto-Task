import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createShutdownManager,
  type CloseableDatabase,
  type SafeDiagnosticLogger,
  type ShutdownDiagnosticCode
} from '../lifecycle';

interface LogEntry {
  code: ShutdownDiagnosticCode;
  message: string;
}

class FakeDatabase implements CloseableDatabase {
  public open = true;
  public closeCalls = 0;
  public shouldFailClose = false;

  close(): void {
    if (this.shouldFailClose) {
      throw new Error('Database close internal failure with sensitive token: secret_abc');
    }
    this.open = false;
    this.closeCalls++;
  }
}

class FakeApp {
  public quitCalls = 0;
  quit(): void {
    this.quitCalls++;
  }
}

class FakeEvent {
  public preventDefaultCalls = 0;
  preventDefault(): void {
    this.preventDefaultCalls++;
  }
}

class FakeLogger implements SafeDiagnosticLogger {
  public logs: LogEntry[] = [];
  error(code: ShutdownDiagnosticCode, message: string): void {
    this.logs.push({ code, message });
  }
}

describe('Shutdown Lifecycle Manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops automation before log flush, database close, and quit', async () => {
    const order: string[] = [];
    const manager = createShutdownManager({
      automation: {
        stop: async (code) => {
          expect(code).toBe('APP_SHUTDOWN');
          order.push('stop_automation');
        }
      },
      logBus: {
        flush: async () => {
          order.push('flush_logs');
        }
      },
      db: {
        open: true,
        close: () => {
          order.push('close_db');
        }
      },
      app: {
        quit: () => {
          order.push('quit');
        }
      }
    });

    await manager.handleBeforeQuit(new FakeEvent());
    expect(order).toEqual(['stop_automation', 'flush_logs', 'close_db', 'quit']);
  });

  it('prevents re-entry: second before-quit while shutting down still calls preventDefault but does not repeat close or quit', async () => {
    const mockDb = new FakeDatabase();
    const mockApp = new FakeApp();
    const logger = new FakeLogger();

    let resolveFlush: () => void = () => {};
    const pendingFlush = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });

    const manager = createShutdownManager({
      db: mockDb,
      logBus: { flush: () => pendingFlush },
      app: mockApp,
      logger,
      logFlushTimeoutMs: 2000
    });

    const event1 = new FakeEvent();
    const firstCall = manager.handleBeforeQuit(event1);

    // Trigger second before-quit while first is still pending
    const event2 = new FakeEvent();
    const secondCall = manager.handleBeforeQuit(event2);

    expect(event1.preventDefaultCalls).toBe(1);
    expect(event2.preventDefaultCalls).toBe(1);

    // Resolve first flush
    resolveFlush();
    await Promise.all([firstCall, secondCall]);

    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);
  });

  it('handles 10 duplicate before-quit events while shutdown is in flight: all preventDefault but only one shutdown execution', async () => {
    const mockDb = new FakeDatabase();
    const mockApp = new FakeApp();
    let resolveStop: () => void = () => {};
    const pendingStop = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });

    const manager = createShutdownManager({
      db: mockDb,
      automation: { stop: () => pendingStop },
      app: mockApp
    });

    const events = Array.from({ length: 10 }, () => new FakeEvent());
    const promises = events.map((e) => manager.handleBeforeQuit(e));

    for (const e of events) {
      expect(e.preventDefaultCalls).toBe(1);
    }

    resolveStop();
    await Promise.all(promises);

    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);

    // After shutdown finished, subsequent before-quit does NOT preventDefault
    const finalEvent = new FakeEvent();
    await manager.handleBeforeQuit(finalEvent);
    expect(finalEvent.preventDefaultCalls).toBe(0);
  });

  it('reports an automation timeout separately and still flushes, closes, and quits', async () => {
    const order: string[] = [];
    const logger = new FakeLogger();
    const db = new FakeDatabase();
    const app = new FakeApp();
    const manager = createShutdownManager({
      automation: { stop: async () => new Promise<void>(() => {}) },
      logBus: { flush: async () => { order.push('flush_logs'); } },
      db,
      app,
      logger,
      automationTimeoutMs: 100,
      logFlushTimeoutMs: 200
    });

    const shutdown = manager.handleBeforeQuit(new FakeEvent());
    await vi.advanceTimersByTimeAsync(100);
    await shutdown;

    expect(logger.logs).toEqual([{
      code: 'ERR_SHUTDOWN_AUTOMATION_TIMEOUT',
      message: 'Automation stop timed out during shutdown.'
    }]);
    expect(order).toEqual(['flush_logs']);
    expect(db.closeCalls).toBe(1);
    expect(app.quitCalls).toBe(1);
  });

  it('reports a log timeout separately after automation has stopped', async () => {
    const order: string[] = [];
    const logger = new FakeLogger();
    const db = new FakeDatabase();
    const app = new FakeApp();
    const manager = createShutdownManager({
      automation: { stop: async () => { order.push('stop_automation'); } },
      logBus: { flush: async () => new Promise<void>(() => {}) },
      db,
      app,
      logger,
      automationTimeoutMs: 100,
      logFlushTimeoutMs: 200
    });

    const shutdown = manager.handleBeforeQuit(new FakeEvent());
    await vi.advanceTimersByTimeAsync(200);
    await shutdown;

    expect(order).toEqual(['stop_automation']);
    expect(logger.logs).toEqual([{
      code: 'ERR_SHUTDOWN_LOG_TIMEOUT',
      message: 'LogBus flush timed out during shutdown.'
    }]);
    expect(db.closeCalls).toBe(1);
    expect(app.quitCalls).toBe(1);
  });

  it('enforces 2000ms timeout on hanging flush, logs only ERR_SHUTDOWN_LOG_TIMEOUT, and completes close and quit', async () => {
    const mockDb = new FakeDatabase();
    const mockApp = new FakeApp();
    const logger = new FakeLogger();

    const hangingFlush = new Promise<void>(() => {});

    const manager = createShutdownManager({
      db: mockDb,
      logBus: { flush: () => hangingFlush },
      app: mockApp,
      logger,
      logFlushTimeoutMs: 2000
    });

    const event = new FakeEvent();
    const shutdownPromise = manager.handleBeforeQuit(event);

    await vi.advanceTimersByTimeAsync(2000);
    await shutdownPromise;

    expect(event.preventDefaultCalls).toBe(1);
    expect(mockDb.open).toBe(false);
    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);

    expect(logger.logs).toEqual([
      {
        code: 'ERR_SHUTDOWN_LOG_TIMEOUT',
        message: 'LogBus flush timed out during shutdown.'
      }
    ]);
  });

  it('handles rejected flush cleanly: logs static ERR_SHUTDOWN_FLUSH code without raw exception content, closes DB and quits', async () => {
    const mockDb = new FakeDatabase();
    const mockApp = new FakeApp();
    const logger = new FakeLogger();

    const sensitiveSecret = 'SECRET_TOKEN_REDACTED';
    const rejectingLogBus = {
      flush: async () => {
        throw new Error(`Flush disk failure with sensitive context: ${sensitiveSecret}`);
      }
    };

    const manager = createShutdownManager({
      db: mockDb,
      logBus: rejectingLogBus,
      app: mockApp,
      logger,
      logFlushTimeoutMs: 2000
    });

    const event = new FakeEvent();
    await manager.handleBeforeQuit(event);

    expect(mockDb.open).toBe(false);
    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);

    expect(logger.logs.length).toBe(1);
    expect(logger.logs[0].code).toBe('ERR_SHUTDOWN_FLUSH');
    expect(logger.logs[0].message).not.toContain(sensitiveSecret);
    expect(logger.logs[0].message).not.toContain('Flush disk failure');
    expect(logger.logs[0].message).toBe('LogBus flush failed during shutdown.');
  });

  it('handles DB close failure: logs static ERR_SHUTDOWN_DB_CLOSE without raw exception content and still quits once', async () => {
    const mockDb = new FakeDatabase();
    mockDb.shouldFailClose = true;

    const mockApp = new FakeApp();
    const logger = new FakeLogger();

    const manager = createShutdownManager({
      db: mockDb,
      app: mockApp,
      logger,
      logFlushTimeoutMs: 2000
    });

    const event = new FakeEvent();
    await manager.handleBeforeQuit(event);

    expect(mockApp.quitCalls).toBe(1);
    expect(logger.logs.length).toBe(1);
    expect(logger.logs[0].code).toBe('ERR_SHUTDOWN_DB_CLOSE');
    expect(logger.logs[0].message).not.toContain('secret_abc');
    expect(logger.logs[0].message).not.toContain('Database close internal failure');
    expect(logger.logs[0].message).toBe('Database close failed during shutdown.');
  });
});
