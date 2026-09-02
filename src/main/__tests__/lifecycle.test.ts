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

describe('Shutdown Lifecycle Manager (Task 9 RED)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('orders execution correctly: flush before close before quit, closing DB once and quitting once', async () => {
    const executionOrder: string[] = [];

    const mockDb = new FakeDatabase();
    const originalClose = mockDb.close.bind(mockDb);
    mockDb.close = () => {
      executionOrder.push('close_db');
      originalClose();
    };

    const mockLogBus = {
      flush: async () => {
        executionOrder.push('flush_logbus');
      }
    };

    const mockApp = new FakeApp();
    const originalQuit = mockApp.quit.bind(mockApp);
    mockApp.quit = () => {
      executionOrder.push('app_quit');
      originalQuit();
    };

    const logger = new FakeLogger();

    const manager = createShutdownManager({
      db: mockDb,
      logBus: mockLogBus,
      app: mockApp,
      logger,
      timeoutMs: 2000
    });

    const event = new FakeEvent();
    const shutdownPromise = manager.handleBeforeQuit(event);

    await shutdownPromise;

    expect(event.preventDefaultCalls).toBe(1);
    expect(executionOrder).toEqual(['flush_logbus', 'close_db', 'app_quit']);
    expect(mockDb.open).toBe(false);
    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);
    expect(logger.logs.length).toBe(0);
  });

  it('prevents re-entry: second before-quit while shutting down does not repeat preventDefault, close, or quit', async () => {
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
      timeoutMs: 2000
    });

    const event1 = new FakeEvent();
    const firstCall = manager.handleBeforeQuit(event1);

    // Trigger second before-quit while first is still pending
    const event2 = new FakeEvent();
    const secondCall = manager.handleBeforeQuit(event2);

    expect(event1.preventDefaultCalls).toBe(1);
    expect(event2.preventDefaultCalls).toBe(0);

    // Resolve first flush
    resolveFlush();
    await Promise.all([firstCall, secondCall]);

    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);
  });

  it('enforces 2000ms timeout on hanging flush, logs only ERR_SHUTDOWN_TIMEOUT, and completes close and quit', async () => {
    const mockDb = new FakeDatabase();
    const mockApp = new FakeApp();
    const logger = new FakeLogger();

    // Never-resolving flush promise
    const hangingFlush = new Promise<void>(() => {});

    const manager = createShutdownManager({
      db: mockDb,
      logBus: { flush: () => hangingFlush },
      app: mockApp,
      logger,
      timeoutMs: 2000
    });

    const event = new FakeEvent();
    const shutdownPromise = manager.handleBeforeQuit(event);

    // Advance fake timer by 2000ms to trigger timeout
    await vi.advanceTimersByTimeAsync(2000);
    await shutdownPromise;

    expect(event.preventDefaultCalls).toBe(1);
    expect(mockDb.open).toBe(false);
    expect(mockDb.closeCalls).toBe(1);
    expect(mockApp.quitCalls).toBe(1);

    expect(logger.logs).toEqual([
      {
        code: 'ERR_SHUTDOWN_TIMEOUT',
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
      timeoutMs: 2000
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
      timeoutMs: 2000
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
