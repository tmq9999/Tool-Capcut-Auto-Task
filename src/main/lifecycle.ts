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
  | 'ERR_SHUTDOWN_TIMEOUT'
  | 'ERR_SHUTDOWN_FLUSH'
  | 'ERR_SHUTDOWN_DB_CLOSE';

export interface SafeDiagnosticLogger {
  error(code: ShutdownDiagnosticCode, message: string): void;
}

export interface ShutdownDependencies {
  db: CloseableDatabase;
  logBus?: FlushableLogBus;
  app: QuitApplication;
  logger?: SafeDiagnosticLogger;
  timeoutMs?: number;
}

export interface ShutdownManager {
  handleBeforeQuit(event: BeforeQuitEvent): Promise<void>;
}

export function createShutdownManager(deps: ShutdownDependencies): ShutdownManager {
  let isShuttingDown = false;
  let isShutdownFinished = false;
  const timeoutDuration = deps.timeoutMs ?? 2000;

  return {
    async handleBeforeQuit(event: BeforeQuitEvent): Promise<void> {
      if (isShuttingDown || isShutdownFinished) {
        return;
      }
      isShuttingDown = true;
      event.preventDefault();

      try {
        if (deps.logBus) {
          let timeoutHandle: NodeJS.Timeout | null = null;

          const timeoutPromise = new Promise<'timeout'>((resolve) => {
            timeoutHandle = setTimeout(() => {
              resolve('timeout');
            }, timeoutDuration);
          });

          try {
            const flushPromise = deps.logBus.flush().then(() => 'flushed' as const);
            const raceResult = await Promise.race([flushPromise, timeoutPromise]);

            if (raceResult === 'timeout') {
              deps.logger?.error('ERR_SHUTDOWN_TIMEOUT', 'LogBus flush timed out during shutdown.');
            }
          } catch {
            deps.logger?.error('ERR_SHUTDOWN_FLUSH', 'LogBus flush failed during shutdown.');
          } finally {
            if (timeoutHandle !== null) {
              clearTimeout(timeoutHandle);
            }
          }
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
