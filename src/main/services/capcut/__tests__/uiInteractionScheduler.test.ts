import { describe, expect, it, vi } from 'vitest';
import { DomReadTimeoutError } from '../cancellation';
import type { UiSchedulerEvent } from '../types';
import {
  RunUiInteractionScheduler,
  createDirectUiInteraction
} from '../uiInteractionScheduler';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RunUiInteractionScheduler', () => {
  it('admits foreground tickets in strict FIFO order', async () => {
    const events: UiSchedulerEvent[] = [];
    const scheduler = new RunUiInteractionScheduler({
      onEvent: (e) => events.push(e)
    });

    const sessionA = { sessionAlias: 'session-a', signal: new AbortController().signal };
    const sessionB = { sessionAlias: 'session-b', signal: new AbortController().signal };
    const sessionC = { sessionAlias: 'session-c', signal: new AbortController().signal };

    const interactionA = scheduler.forSession(sessionA);
    const interactionB = scheduler.forSession(sessionB);
    const interactionC = scheduler.forSession(sessionC);

    const started: string[] = [];
    let activeForeground = 0;
    let peakForeground = 0;

    const defA = createDeferred<string>();
    const defB = createDeferred<string>();
    const defC = createDeferred<string>();

    const runA = interactionA.foreground('op-a', async () => {
      activeForeground++;
      peakForeground = Math.max(peakForeground, activeForeground);
      started.push('A');
      return defA.promise;
    }).finally(() => {
      activeForeground--;
    });

    const runB = interactionB.foreground('op-b', async () => {
      activeForeground++;
      peakForeground = Math.max(peakForeground, activeForeground);
      started.push('B');
      return defB.promise;
    }).finally(() => {
      activeForeground--;
    });

    const runC = interactionC.foreground('op-c', async () => {
      activeForeground++;
      peakForeground = Math.max(peakForeground, activeForeground);
      started.push('C');
      return defC.promise;
    }).finally(() => {
      activeForeground--;
    });

    await Promise.resolve();
    expect(started).toEqual(['A']);
    expect(peakForeground).toBe(1);

    defA.resolve('done-a');
    await runA;
    await Promise.resolve();

    expect(started).toEqual(['A', 'B']);
    expect(peakForeground).toBe(1);

    defB.resolve('done-b');
    await runB;
    await Promise.resolve();

    expect(started).toEqual(['A', 'B', 'C']);
    expect(peakForeground).toBe(1);

    defC.resolve('done-c');
    await runC;

    expect(peakForeground).toBe(1);
    expect(started).toEqual(['A', 'B', 'C']);
  });

  it('removes an aborted queued ticket without invoking it', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    const ctrlC = new AbortController();

    const defA = createDeferred<void>();
    const defC = createDeferred<void>();
    let bCallbackCount = 0;
    const started: string[] = [];

    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: ctrlA.signal });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: ctrlB.signal });
    const intC = scheduler.forSession({ sessionAlias: 'session-c', signal: ctrlC.signal });

    const runA = intA.foreground('op-a', async () => {
      started.push('A');
      await defA.promise;
    });

    const runB = intB.foreground('op-b', async () => {
      bCallbackCount++;
      started.push('B');
    });

    const runC = intC.foreground('op-c', async () => {
      started.push('C');
      await defC.promise;
    });

    await Promise.resolve();
    expect(started).toEqual(['A']);

    ctrlB.abort(new Error('b-cancelled'));
    await expect(runB).rejects.toThrow('b-cancelled');
    expect(bCallbackCount).toBe(0);

    defA.resolve();
    await runA;
    await Promise.resolve();

    expect(started).toEqual(['A', 'C']);
    defC.resolve();
    await runC;
  });

  it('enforces the configured editor capacity and FIFO admission', async () => {
    // Test with limit 1
    const s1 = new RunUiInteractionScheduler({ editorLaneLimit: 1 });
    const sig = new AbortController().signal;
    const i1 = s1.forSession({ sessionAlias: 'session-1', signal: sig });

    let active = 0;
    let peak1 = 0;
    const start1: string[] = [];
    const d1A = createDeferred<void>();
    const d1B = createDeferred<void>();

    const r1A = i1.editor('e-a', async () => {
      active++;
      peak1 = Math.max(peak1, active);
      start1.push('A');
      await d1A.promise;
      active--;
    });
    const r1B = i1.editor('e-b', async () => {
      active++;
      peak1 = Math.max(peak1, active);
      start1.push('B');
      await d1B.promise;
      active--;
    });

    await Promise.resolve();
    expect(start1).toEqual(['A']);
    expect(peak1).toBe(1);

    d1A.resolve();
    await r1A;
    await Promise.resolve();
    expect(start1).toEqual(['A', 'B']);
    expect(peak1).toBe(1);

    d1B.resolve();
    await r1B;

    // Test with limit 2
    const s2 = new RunUiInteractionScheduler({ editorLaneLimit: 2 });
    const i2 = s2.forSession({ sessionAlias: 'session-2', signal: sig });
    active = 0;
    let peak2 = 0;
    const start2: string[] = [];
    const d2A = createDeferred<void>();
    const d2B = createDeferred<void>();
    const d2C = createDeferred<void>();

    const r2A = i2.editor('e-a', async () => {
      active++;
      peak2 = Math.max(peak2, active);
      start2.push('A');
      await d2A.promise;
      active--;
    });
    const r2B = i2.editor('e-b', async () => {
      active++;
      peak2 = Math.max(peak2, active);
      start2.push('B');
      await d2B.promise;
      active--;
    });
    const r2C = i2.editor('e-c', async () => {
      active++;
      peak2 = Math.max(peak2, active);
      start2.push('C');
      await d2C.promise;
      active--;
    });

    await Promise.resolve();
    expect(start2).toEqual(['A', 'B']);
    expect(peak2).toBe(2);

    d2A.resolve();
    await r2A;
    await Promise.resolve();
    expect(start2).toEqual(['A', 'B', 'C']);
    expect(peak2).toBe(2);

    d2B.resolve();
    d2C.resolve();
    await Promise.all([r2B, r2C]);
  });

  it('keeps foreground quarantined after DOM_READ_TIMEOUT', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sig = new AbortController().signal;
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });

    let bStarted = false;
    const timeoutErr = new DomReadTimeoutError('canvas-area:mouse-move');

    const runA = intA.foreground('op-a', async () => {
      throw timeoutErr;
    });

    const runB = intB.foreground('op-b', async () => {
      bStarted = true;
    });

    await expect(runA).rejects.toThrow(timeoutErr);
    await Promise.resolve();

    expect(bStarted).toBe(false);
    expect(scheduler.getSnapshot().quarantinedAlias).toBe('session-a');
    expect(scheduler.getSnapshot().foreground.queued).toBe(1);

    // B should remain pending until cleanup confirmation
    scheduler.confirmProfileStopped('session-a');
    await runB;
    expect(bStarted).toBe(true);
    expect(scheduler.getSnapshot().quarantinedAlias).toBeNull();
  });

  it('releases quarantine only for the exact stopped session alias', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sig = new AbortController().signal;
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });

    let bStarted = false;
    await expect(
      intA.foreground('op-a', async () => {
        throw new DomReadTimeoutError('canvas-area:mouse-move');
      })
    ).rejects.toThrow();

    const runB = intB.foreground('op-b', async () => {
      bStarted = true;
    });

    await Promise.resolve();
    expect(bStarted).toBe(false);

    // Confirm wrong session
    scheduler.confirmProfileStopped('session-c');
    await Promise.resolve();
    expect(bStarted).toBe(false);
    expect(scheduler.getSnapshot().quarantinedAlias).toBe('session-a');

    // Confirm exact session
    scheduler.confirmProfileStopped('session-a');
    await runB;
    expect(bStarted).toBe(true);
    expect(scheduler.getSnapshot().quarantinedAlias).toBeNull();
  });

  it('does not release quarantine when profile stop is never confirmed', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new RunUiInteractionScheduler();
      const sig = new AbortController().signal;
      const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
      const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });

      let bStarted = false;
      await expect(
        intA.foreground('op-a', async () => {
          throw new DomReadTimeoutError('canvas-area:mouse-move');
        })
      ).rejects.toThrow();

      void intB.foreground('op-b', async () => {
        bStarted = true;
      });

      await vi.advanceTimersByTimeAsync(3600_000);
      expect(bStarted).toBe(false);
      expect(scheduler.getSnapshot().quarantinedAlias).toBe('session-a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('quarantines an active operation aborted after it starts', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const ctrlA = new AbortController();
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: ctrlA.signal });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: new AbortController().signal });

    const defA = createDeferred<string>();
    let aStarted = false;
    let bStarted = false;

    const runA = intA.foreground('op-a', async () => {
      aStarted = true;
      return defA.promise;
    });

    await Promise.resolve();
    expect(aStarted).toBe(true);

    ctrlA.abort(new Error('user-aborted-active'));
    await expect(runA).rejects.toThrow('user-aborted-active');

    const runB = intB.foreground('op-b', async () => {
      bStarted = true;
    });

    await Promise.resolve();
    expect(bStarted).toBe(false);
    expect(scheduler.getSnapshot().quarantinedAlias).toBe('session-a');

    scheduler.confirmProfileStopped('session-a');
    await runB;
    expect(bStarted).toBe(true);
  });

  it('rejects the caller promptly and absorbs a late active settlement', async () => {
    const events: UiSchedulerEvent[] = [];
    const scheduler = new RunUiInteractionScheduler({
      onEvent: (e) => events.push(e)
    });
    const ctrlA = new AbortController();
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: ctrlA.signal });

    const defA = createDeferred<string>();
    const runA = intA.foreground('op-a', () => defA.promise);

    await Promise.resolve();
    ctrlA.abort(new Error('cancelled'));

    await expect(runA).rejects.toThrow('cancelled');

    // Late resolution
    defA.resolve('late-val');
    await Promise.resolve();

    const lateEvents = events.filter((e) => e.type === 'late-settled');
    expect(lateEvents).toHaveLength(1);
    expect(lateEvents[0]).toMatchObject({
      type: 'late-settled',
      sessionAlias: 'session-a',
      label: 'op-a',
      outcome: 'resolved'
    });
  });

  it('treats abort concurrent with operation resolution as unsafe', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const ctrlA = new AbortController();
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: ctrlA.signal });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: new AbortController().signal });

    const defA = createDeferred<string>();
    const runA = intA.foreground('op-a', async () => defA.promise);

    await Promise.resolve();
    // Concurrent resolution and abort in the same turn
    defA.resolve('success');
    ctrlA.abort(new Error('concurrent-abort'));

    await expect(runA).rejects.toThrow();

    let bStarted = false;
    const runB = intB.foreground('op-b', async () => {
      bStarted = true;
    });

    await Promise.resolve();
    expect(bStarted).toBe(false);
    expect(scheduler.getSnapshot().quarantinedAlias).toBe('session-a');

    scheduler.confirmProfileStopped('session-a');
    await runB;
    expect(bStarted).toBe(true);
  });

  it('does not quarantine an operation aborted while still queued', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sigA = new AbortController().signal;
    const ctrlB = new AbortController();
    const sigC = new AbortController().signal;

    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sigA });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: ctrlB.signal });
    const intC = scheduler.forSession({ sessionAlias: 'session-c', signal: sigC });

    const defA = createDeferred<void>();
    let bCalled = false;
    let cStarted = false;

    const runA = intA.foreground('op-a', async () => defA.promise);
    const runB = intB.foreground('op-b', async () => {
      bCalled = true;
    });
    const runC = intC.foreground('op-c', async () => {
      cStarted = true;
    });

    await Promise.resolve();
    ctrlB.abort(new Error('b-aborted-while-queued'));
    await expect(runB).rejects.toThrow('b-aborted-while-queued');
    expect(bCalled).toBe(false);

    defA.resolve();
    await runA;
    await runC;

    expect(cStarted).toBe(true);
    expect(scheduler.getSnapshot().quarantinedAlias).toBeNull();
  });

  it('releases normally after an ordinary non-session error', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sig = new AbortController().signal;
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });

    const runA = intA.foreground('op-a', async () => {
      throw new Error('ordinary-network-error');
    });

    let bStarted = false;
    const runB = intB.foreground('op-b', async () => {
      bStarted = true;
    });

    await expect(runA).rejects.toThrow('ordinary-network-error');
    await runB;

    expect(bStarted).toBe(true);
    expect(scheduler.getSnapshot().quarantinedAlias).toBeNull();
  });

  it('does not starve a foreground waiter behind later tickets', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sig = new AbortController().signal;
    const defA = createDeferred<void>();

    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });

    const executionOrder: string[] = [];

    const runA = intA.foreground('op-a', async () => {
      executionOrder.push('A');
      await defA.promise;
    });

    const runB = intB.foreground('op-b', async () => {
      executionOrder.push('B');
    });

    const laterRuns: Array<Promise<void>> = [];
    for (let i = 0; i < 100; i++) {
      const intLater = scheduler.forSession({ sessionAlias: `session-${i}`, signal: sig });
      laterRuns.push(
        intLater.foreground(`op-${i}`, async () => {
          executionOrder.push(`C${i}`);
        })
      );
    }

    await Promise.resolve();
    defA.resolve();
    await runA;
    await runB;
    await Promise.all(laterRuns);

    expect(executionOrder[0]).toBe('A');
    expect(executionOrder[1]).toBe('B');
    expect(executionOrder).toHaveLength(102);
  });

  it('shutdown drains both queues and rejects future acquisitions', async () => {
    const scheduler = new RunUiInteractionScheduler();
    const sig = new AbortController().signal;
    const defA = createDeferred<void>();

    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: sig });
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });
    const intC = scheduler.forSession({ sessionAlias: 'session-c', signal: sig });

    let bCalled = false;
    let cCalled = false;

    const runA = intA.foreground('op-a', async () => defA.promise);
    const runAEd = intA.editor('op-a-ed', async () => defA.promise);
    const runB = intB.foreground('op-b', async () => {
      bCalled = true;
    });
    const runC = intC.editor('op-c', async () => {
      cCalled = true;
    });

    await Promise.resolve();
    scheduler.shutdown({ code: 'RESOURCE_CLEANUP_FAILED', message: 'Tài nguyên dọn dẹp thất bại' });

    await expect(runB).rejects.toThrow('Tài nguyên dọn dẹp thất bại');
    await expect(runC).rejects.toThrow('Tài nguyên dọn dẹp thất bại');
    expect(bCalled).toBe(false);
    expect(cCalled).toBe(false);

    // Future ticket
    const intFuture = scheduler.forSession({ sessionAlias: 'session-future', signal: sig });
    await expect(intFuture.foreground('op-f', async () => {})).rejects.toThrow('Tài nguyên dọn dẹp thất bại');

    const snap = scheduler.getSnapshot();
    expect(snap.foreground.queued).toBe(0);
    expect(snap.editor.queued).toBe(0);
    expect(snap.isShutdown).toBe(true);

    defA.resolve();
    await Promise.all([runA, runAEd]);
  });

  it('shutdown is idempotent while an unsafe operation settles late', async () => {
    const events: UiSchedulerEvent[] = [];
    const scheduler = new RunUiInteractionScheduler({
      onEvent: (e) => events.push(e)
    });
    const ctrlA = new AbortController();
    const intA = scheduler.forSession({ sessionAlias: 'session-a', signal: ctrlA.signal });

    const defA = createDeferred<string>();
    const runA = intA.foreground('op-a', async () => defA.promise);

    await Promise.resolve();
    ctrlA.abort(new Error('aborted-unsafe'));
    await expect(runA).rejects.toThrow('aborted-unsafe');

    scheduler.shutdown({ code: 'RUN_ABORTED', message: 'Run aborted' });
    scheduler.shutdown({ code: 'RUN_ABORTED', message: 'Run aborted' });

    defA.reject(new Error('late-rejection-after-shutdown'));
    await Promise.resolve();

    const shutdownEvents = events.filter((e) => e.type === 'shutdown');
    expect(shutdownEvents).toHaveLength(1);

    const sig = new AbortController().signal;
    const intB = scheduler.forSession({ sessionAlias: 'session-b', signal: sig });
    await expect(intB.foreground('op-b', async () => {})).rejects.toThrow('Run aborted');
  });

  it('direct interaction checks cancellation and does not schedule', async () => {
    const ctrl = new AbortController();
    const direct = createDirectUiInteraction(ctrl.signal);

    const resF = await direct.foreground('f1', async () => 'f1-result');
    const resE = await direct.editor('e1', async () => 'e1-result');
    expect(resF).toBe('f1-result');
    expect(resE).toBe('e1-result');

    ctrl.abort(new Error('direct-cancelled'));

    let opFCount = 0;
    let opECount = 0;

    await expect(
      direct.foreground('f2', async () => {
        opFCount++;
      })
    ).rejects.toThrow('direct-cancelled');

    await expect(
      direct.editor('e2', async () => {
        opECount++;
      })
    ).rejects.toThrow('direct-cancelled');

    expect(opFCount).toBe(0);
    expect(opECount).toBe(0);
  });
});
