import { describe, expect, it } from 'vitest';
import {
  acquireSingleInstance,
  startPrimaryInstance,
  type FocusableWindow,
  type SingleInstanceApp
} from '../singleInstance';

class FakeSingleInstanceApp implements SingleInstanceApp {
  public quitCalls = 0;
  public requestCalls = 0;
  public listeners: Array<() => void> = [];

  constructor(private readonly lockGranted: boolean) {}

  requestSingleInstanceLock(): boolean {
    this.requestCalls += 1;
    return this.lockGranted;
  }

  on(_event: 'second-instance', listener: () => void): void {
    this.listeners.push(listener);
  }

  quit(): void {
    this.quitCalls += 1;
  }

  emitSecondInstance(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeFocusableWindow implements FocusableWindow {
  public destroyed = false;
  public minimized = false;
  public restoreCalls = 0;
  public showCalls = 0;
  public focusCalls = 0;

  isDestroyed(): boolean { return this.destroyed; }
  isMinimized(): boolean { return this.minimized; }
  restore(): void { this.restoreCalls += 1; this.minimized = false; }
  show(): void { this.showCalls += 1; }
  focus(): void { this.focusCalls += 1; }
}

describe('singleInstance', () => {
  it('quits a second instance before runtime initialization can be scheduled', () => {
    const app = new FakeSingleInstanceApp(false);
    let scheduleCalls = 0;
    const acquired = startPrimaryInstance(
      app,
      () => null,
      () => { scheduleCalls += 1; }
    );

    expect(acquired).toBe(false);
    expect(app.requestCalls).toBe(1);
    expect(app.quitCalls).toBe(1);
    expect(app.listeners).toHaveLength(0);
    expect(scheduleCalls).toBe(0);
  });

  it('schedules primary initialization only after the lock is granted', () => {
    const app = new FakeSingleInstanceApp(true);
    let requestCallsSeenByInitializer = 0;

    expect(startPrimaryInstance(
      app,
      () => null,
      () => { requestCallsSeenByInitializer = app.requestCalls; }
    )).toBe(true);

    expect(requestCallsSeenByInitializer).toBe(1);
    expect(app.quitCalls).toBe(0);
  });

  it('focuses and restores the existing window on second-instance', () => {
    const app = new FakeSingleInstanceApp(true);
    const window = new FakeFocusableWindow();
    window.minimized = true;
    expect(acquireSingleInstance(app, () => window)).toBe(true);

    app.emitSecondInstance();

    expect(window.restoreCalls).toBe(1);
    expect(window.showCalls).toBe(1);
    expect(window.focusCalls).toBe(1);
  });
});
