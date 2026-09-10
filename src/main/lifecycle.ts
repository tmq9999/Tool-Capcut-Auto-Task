export interface CloseableDatabase {
  open: boolean;
  close(): void;
}

export interface FlushableLogBus {
  flush(): Promise<void>;
}

export interface QuitApplication {
  quit(): void;
}

export interface BeforeQuitEvent {
  preventDefault(): void;
}

export type ShutdownDiagnosticCode =
  | 'ERR_SHUTDOWN_AUTOMATION_TIMEOUT'
  | 'ERR_SHUTDOWN_AUTOMATION_STOP'
  | 'ERR_SHUTDOWN_LOG_TIMEOUT'
  | 'ERR_SHUTDOWN_FLUSH'
  | 'ERR_SHUTDOWN_DB_CLOSE';

export interface SafeDiagnosticLogger {
  error(code: ShutdownDiagnosticCode, message: string): void;
}

export interface StoppableAutomation {
  stop(code: 'APP_SHUTDOWN'): Promise<void>;
}

export interface ShutdownDependencies {
  automation?: StoppableAutomation;
  db: CloseableDatabase;
  logBus?: FlushableLogBus;
  app: QuitApplication;
  logger?: SafeDiagnosticLogger;
  automationTimeoutMs?: number;
  logFlushTimeoutMs?: number;
}

export interface ShutdownManager {
  handleBeforeQuit(event: BeforeQuitEvent): Promise<void>;
}

async function runBounded(
  operation: () => Promise<void>,
  timeoutMs: number,
  logger: SafeDiagnosticLogger | undefined,
  timeoutCode: ShutdownDiagnosticCode,
  timeoutMessage: string,
  failureCode: ShutdownDiagnosticCode,
  failureMessage: string
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([
      operation().then(() => 'done' as const),
      timeout
    ]);
    if (result === 'timeout') logger?.error(timeoutCode, timeoutMessage);
  } catch {
    logger?.error(failureCode, failureMessage);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createShutdownManager(deps: ShutdownDependencies): ShutdownManager {
  let isShuttingDown = false;
  let isShutdownFinished = false;

  return {
    async handleBeforeQuit(event: BeforeQuitEvent): Promise<void> {
      if (isShutdownFinished) return;
      event.preventDefault();
      if (isShuttingDown) return;
      isShuttingDown = true;

      try {
        if (deps.automation) {
          await runBounded(
            () => deps.automation!.stop('APP_SHUTDOWN'),
            deps.automationTimeoutMs ?? 15_000,
            deps.logger,
            'ERR_SHUTDOWN_AUTOMATION_TIMEOUT',
            'Automation stop timed out during shutdown.',
            'ERR_SHUTDOWN_AUTOMATION_STOP',
            'Automation stop failed during shutdown.'
          );
        }

        if (deps.logBus) {
          await runBounded(
            () => deps.logBus!.flush(),
            deps.logFlushTimeoutMs ?? 2_000,
            deps.logger,
            'ERR_SHUTDOWN_LOG_TIMEOUT',
            'LogBus flush timed out during shutdown.',
            'ERR_SHUTDOWN_FLUSH',
            'LogBus flush failed during shutdown.'
          );
        }
      } finally {
        try {
          if (deps.db.open) {
            deps.db.close();
          }
        } catch {
          deps.logger?.error('ERR_SHUTDOWN_DB_CLOSE', 'Database close failed during shutdown.');
        }

        isShutdownFinished = true;
        deps.app.quit();
      }
    }
  };
}
