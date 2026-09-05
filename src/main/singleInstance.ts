export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
}

export interface FocusableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function acquireSingleInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}

export function startPrimaryInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null,
  scheduleInitialization: () => void
): boolean {
  if (!acquireSingleInstance(app, getWindow)) return false;
  scheduleInitialization();
  return true;
}
