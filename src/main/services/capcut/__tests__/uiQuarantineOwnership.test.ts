import { describe, expect, it, vi } from 'vitest';
import { RunUiInteractionScheduler, mapUiSchedulerEventToEvidence } from '../uiInteractionScheduler';
import { DomReadTimeoutError } from '../cancellation';

describe('quarantined session logical foreground ownership', () => {
  it('retains lane ownership until exact confirmed stop and rejects later use of the stopped session', async () => {
    const scheduler = new RunUiInteractionScheduler({ editorLaneLimit: 1 });
    const a = scheduler.forSession({ sessionAlias: 'worker-1-session-1', signal: new AbortController().signal });
    const b = scheduler.forSession({ sessionAlias: 'worker-2-session-1', signal: new AbortController().signal });
    await expect(a.foreground('canvas-area', async () => { throw new DomReadTimeoutError('canvas-area'); })).rejects.toThrow();
    const operation = vi.fn(async () => {});
    const waiting = b.foreground('auth', operation);
    expect(scheduler.snapshot()).toMatchObject({ foregroundOwner: 'worker-1-session-1', foreground: { active: 1 }, foregroundWaiting: 1 });
    scheduler.confirmProfileStopped('worker-3-session-1');
    expect(operation).not.toHaveBeenCalled();
    scheduler.confirmProfileStopped('worker-1-session-1');
    await waiting;
    expect(operation).toHaveBeenCalledTimes(1);
    expect(scheduler.snapshot().foreground.active).toBe(0);
    await expect(a.foreground('auth', operation)).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('removes the active abort listener after an ordinary failure', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const scheduler = new RunUiInteractionScheduler();
    const ui = scheduler.forSession({ sessionAlias: 'worker-1-session-1', signal: controller.signal });
    await expect(ui.foreground('auth', async () => { throw new Error('ordinary'); })).rejects.toThrow('ordinary');
    expect(remove.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(2);
  });

  it('maps raw UI labels to safe evidence categories', () => {
    const event = mapUiSchedulerEventToEvidence('run-safe', { type: 'queued', lane: 'foreground',
      sessionAlias: 'worker-1-session-1', label: 'auth:secret@example.invalid', at: 1 });
    expect(event).toMatchObject({ label: 'auth', workerAlias: 'worker-1' });
    expect(JSON.stringify(event)).not.toContain('secret@example.invalid');
  });

  it('does not admit another editor while the aborted editor operation is unresolved', async () => {
    const controller = new AbortController();
    const scheduler = new RunUiInteractionScheduler({ editorLaneLimit: 1 });
    const ui = scheduler.forSession({ sessionAlias: 'worker-1-session-1', signal: controller.signal });
    let finish!: () => void;
    const pending = ui.editor('design-studio', () => new Promise<void>((resolve) => { finish = resolve; }));
    const rejected = expect(pending).rejects.toThrow('stopped');
    controller.abort(new Error('stopped'));
    await rejected;
    const next = vi.fn(async () => {});
    const queued = scheduler.forSession({ sessionAlias: 'worker-2-session-1', signal: new AbortController().signal }).editor('video-studio', next);
    expect(next).not.toHaveBeenCalled();
    expect(scheduler.snapshot().editorActive).toBe(1);
    scheduler.confirmProfileStopped('worker-1-session-1');
    await queued;
    expect(next).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    expect(scheduler.snapshot().editorActive).toBe(0);
  });

  it('does not recreate quarantine when stop confirmation wins the abort settlement race', async () => {
    const controller = new AbortController();
    const scheduler = new RunUiInteractionScheduler();
    const alias = 'worker-1-session-1';
    const pending = scheduler.forSession({ sessionAlias: alias, signal: controller.signal })
      .foreground('auth', () => new Promise<void>(() => {}));
    const rejected = expect(pending).rejects.toThrow('stopped');
    controller.abort(new Error('stopped'));
    scheduler.confirmProfileStopped(alias);
    await rejected;
    expect(scheduler.snapshot().quarantinedSessionAliases).toEqual([]);
    expect(scheduler.snapshot().foreground.active).toBe(0);
    const next = vi.fn(async () => {});
    await scheduler.forSession({ sessionAlias: 'worker-2-session-1', signal: new AbortController().signal }).foreground('auth', next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
