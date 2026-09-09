import { isDomReadTimeout } from './cancellation';
import type {
  AccountUiInteraction,
  UiLane,
  UiSchedulerEvent,
  UiSessionIdentity
} from './types';
import { toUiEvidenceLabel, type AutomationEvidenceNonTerminalEvent } from '../../../shared/schemas/automation-evidence.schema';

export interface RunUiInteractionSchedulerOptions {
  editorLaneLimit?: number;
  onEvent?: (event: UiSchedulerEvent) => void;
}

export interface UiLaneSnapshot {
  active: number;
  queued: number;
}

export interface UiSchedulerSnapshot {
  foreground: UiLaneSnapshot;
  editor: UiLaneSnapshot;
  quarantinedAlias: string | null;
  isShutdown: boolean;
  foregroundOwner?: string;
  foregroundWaiting: number;
  editorActive: number;
  editorWaiting: number;
  quarantinedSessionAliases: string[];
}

interface Ticket<T> {
  lane: UiLane;
  sessionAlias: string;
  label: string;
  signal: AbortSignal;
  operation: () => Promise<T>;
  enqueuedAt: number;
  started: boolean;
  abortedActive: boolean;
  cleanupAbortListener?: () => void;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class RunUiInteractionScheduler {
  private readonly editorLaneLimit: number;
  private readonly onEvent?: (event: UiSchedulerEvent) => void;
  private activeForeground = 0;
  private activeEditor = 0;
  private quarantinedAlias: string | null = null;
  private isShutdown = false;
  private shutdownError: Error | null = null;
  private currentForegroundOwner?: string;
  private readonly stoppedSessions = new Set<string>();
  private readonly closedSessions = new Set<string>();
  private readonly poisonedSessions = new Map<string, unknown>();
  private readonly retainedEditors = new Set<string>();
  private readonly activeEditorOwners = new Map<string, number>();

  private readonly queues: {
    foreground: Array<Ticket<unknown>>;
    editor: Array<Ticket<unknown>>;
  } = {
    foreground: [],
    editor: []
  };

  constructor(options?: RunUiInteractionSchedulerOptions) {
    this.editorLaneLimit = Math.max(1, options?.editorLaneLimit ?? 1);
    this.onEvent = options?.onEvent;
  }

  forSession(identity: UiSessionIdentity): AccountUiInteraction {
    return {
      focusMode: identity.focusMode ?? 'native',
      foreground: <T>(label: string, operation: () => Promise<T>) =>
        this.enqueue<T>('foreground', identity, label, operation),
      editor: <T>(label: string, operation: () => Promise<T>) =>
        this.enqueue<T>('editor', identity, label, operation)
    };
  }

  confirmProfileStopped(sessionAlias: string): void {
    if (this.stoppedSessions.has(sessionAlias)) return;
    this.stoppedSessions.add(sessionAlias);
    const ownedEditors = this.activeEditorOwners.get(sessionAlias) ?? 0;
    const hadUnsafeOwnership = this.poisonedSessions.delete(sessionAlias) ||
      this.retainedEditors.has(sessionAlias) || this.currentForegroundOwner === sessionAlias || ownedEditors > 0;
    this.retainedEditors.delete(sessionAlias);
    if (ownedEditors > 0) {
      this.activeEditor -= ownedEditors;
      this.activeEditorOwners.delete(sessionAlias);
      queueMicrotask(() => this.processQueue('editor'));
    }
    if (this.currentForegroundOwner === sessionAlias) {
      this.currentForegroundOwner = undefined;
      this.activeForeground = 0;
    }
    const nextPoisoned = this.poisonedSessions.keys().next();
    this.quarantinedAlias = nextPoisoned.done ? null : nextPoisoned.value;
    if (hadUnsafeOwnership) {
      this.emitEvent({
        type: 'profile-stopped',
        sessionAlias,
        at: Date.now()
      });
    }
    queueMicrotask(() => {
      this.processQueue('foreground');
      this.processQueue('editor');
    });
  }

  closeSession(sessionAlias: string): void {
    if (this.closedSessions.has(sessionAlias) || this.stoppedSessions.has(sessionAlias)) return;
    this.closedSessions.add(sessionAlias);
    const error = new Error('UI_SESSION_CLOSED');
    this.drainSessionQueues(sessionAlias, error);
  }

  shutdown(reason?: { code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED'; message?: string } | Error): void {
    if (this.isShutdown) {
      return;
    }
    this.isShutdown = true;

    let code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED' = 'RUN_ABORTED';
    let err: Error;

    if (reason instanceof Error) {
      err = reason;
      if ((reason as { code?: string }).code === 'RESOURCE_CLEANUP_FAILED') {
        code = 'RESOURCE_CLEANUP_FAILED';
      }
    } else if (reason) {
      code = reason.code;
      err = new Error(reason.message ?? `Scheduler shut down: ${reason.code}`);
      (err as { code?: string }).code = reason.code;
    } else {
      err = new Error('Scheduler shut down');
    }

    this.shutdownError = err;

    this.emitEvent({
      type: 'shutdown',
      code,
      at: Date.now()
    });

    const fgQueue = this.queues.foreground.splice(0, this.queues.foreground.length);
    for (const ticket of fgQueue) {
      ticket.cleanupAbortListener?.();
      ticket.reject(err);
    }

    const edQueue = this.queues.editor.splice(0, this.queues.editor.length);
    for (const ticket of edQueue) {
      ticket.cleanupAbortListener?.();
      ticket.reject(err);
    }
  }

  getSnapshot(): UiSchedulerSnapshot {
    return {
      foreground: {
        active: this.activeForeground,
        queued: this.queues.foreground.length
      },
      editor: {
        active: this.activeEditor,
        queued: this.queues.editor.length
      },
      quarantinedAlias: this.quarantinedAlias,
      isShutdown: this.isShutdown,
      foregroundOwner: this.currentForegroundOwner,
      foregroundWaiting: this.queues.foreground.length,
      editorActive: this.activeEditor,
      editorWaiting: this.queues.editor.length,
      quarantinedSessionAliases: [...new Set([
        ...this.poisonedSessions.keys(), ...this.retainedEditors
      ])]
    };
  }

  snapshot(): UiSchedulerSnapshot {
    return this.getSnapshot();
  }

  private enqueue<T>(
    lane: UiLane,
    identity: UiSessionIdentity,
    label: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.isShutdown) {
      return Promise.reject(this.shutdownError ?? new Error('Scheduler is shut down'));
    }

    if (this.stoppedSessions.has(identity.sessionAlias)) {
      return Promise.reject(new Error('UI_SESSION_STOPPED'));
    }

    if (this.closedSessions.has(identity.sessionAlias)) {
      return Promise.reject(new Error('UI_SESSION_CLOSED'));
    }

    if (this.poisonedSessions.has(identity.sessionAlias)) {
      return Promise.reject(this.poisonedSessions.get(identity.sessionAlias));
    }

    if (identity.signal.aborted) {
      return Promise.reject(identity.signal.reason ?? new Error('Aborted'));
    }

    return new Promise<T>((resolve, reject) => {
      const ticket: Ticket<T> = {
        lane,
        sessionAlias: identity.sessionAlias,
        label,
        signal: identity.signal,
        operation,
        enqueuedAt: Date.now(),
        started: false,
        abortedActive: false,
        resolve,
        reject
      };

      const onAbort = () => {
        if (!ticket.started) {
          const q = this.queues[lane];
          const idx = q.indexOf(ticket as Ticket<unknown>);
          if (idx !== -1) {
            q.splice(idx, 1);
          }
          ticket.reject(identity.signal.reason ?? new Error('Aborted'));
        }
      };

      identity.signal.addEventListener('abort', onAbort, { once: true });
      ticket.cleanupAbortListener = () => {
        identity.signal.removeEventListener('abort', onAbort);
      };

      this.queues[lane].push(ticket as Ticket<unknown>);

      this.emitEvent({
        type: 'queued',
        lane,
        sessionAlias: identity.sessionAlias,
        label,
        at: ticket.enqueuedAt
      });

      this.processQueue(lane);
    });
  }

  private processQueue(lane: UiLane): void {
    if (this.isShutdown) {
      return;
    }

    if (lane === 'foreground') {
      if (this.activeForeground > 0 || this.quarantinedAlias !== null) {
        return;
      }

      while (this.queues.foreground.length > 0) {
        const ticket = this.queues.foreground.shift()!;
        if (ticket.signal.aborted || this.stoppedSessions.has(ticket.sessionAlias) ||
          this.closedSessions.has(ticket.sessionAlias) || this.poisonedSessions.has(ticket.sessionAlias)) {
          ticket.cleanupAbortListener?.();
          ticket.reject(this.poisonedSessions.get(ticket.sessionAlias) ?? ticket.signal.reason ?? new Error('Aborted'));
          continue;
        }

        this.activeForeground++;
        this.currentForegroundOwner = ticket.sessionAlias;
        ticket.cleanupAbortListener?.();
        void this.runForegroundTicket(ticket);
        break;
      }
    } else {
      while (this.activeEditor < this.editorLaneLimit && this.queues.editor.length > 0) {
        const ticket = this.queues.editor.shift()!;
        if (ticket.signal.aborted || this.stoppedSessions.has(ticket.sessionAlias) ||
          this.closedSessions.has(ticket.sessionAlias) || this.poisonedSessions.has(ticket.sessionAlias)) {
          ticket.cleanupAbortListener?.();
          ticket.reject(this.poisonedSessions.get(ticket.sessionAlias) ?? ticket.signal.reason ?? new Error('Aborted'));
          continue;
        }

        this.activeEditor++;
        this.activeEditorOwners.set(
          ticket.sessionAlias,
          (this.activeEditorOwners.get(ticket.sessionAlias) ?? 0) + 1
        );
        ticket.cleanupAbortListener?.();
        void this.runEditorTicket(ticket);
      }
    }
  }

  private async runForegroundTicket(ticket: Ticket<unknown>): Promise<void> {
    const startedAt = Date.now();
    const waitMs = startedAt - ticket.enqueuedAt;
    ticket.started = true;

    this.emitEvent({
      type: 'started',
      lane: 'foreground',
      sessionAlias: ticket.sessionAlias,
      label: ticket.label,
      waitMs,
      at: startedAt
    });

    let releaseNormally = true;
    let callerSettled = false;
    let abortCleanup: (() => void) | undefined;

    try {
      let opPromise: Promise<unknown>;
      try {
        opPromise = Promise.resolve(ticket.operation());
      } catch (err) {
        opPromise = Promise.reject(err);
      }

      opPromise.then(
        () => {
          if (callerSettled && ticket.abortedActive) {
            this.emitEvent({
              type: 'late-settled',
              sessionAlias: ticket.sessionAlias,
              label: ticket.label,
              outcome: 'resolved',
              at: Date.now()
            });
          }
        },
        () => {
          if (callerSettled && ticket.abortedActive) {
            this.emitEvent({
              type: 'late-settled',
              sessionAlias: ticket.sessionAlias,
              label: ticket.label,
              outcome: 'rejected',
              at: Date.now()
            });
          }
        }
      );

      const abortPromise = new Promise<never>((_, reject) => {
        if (ticket.signal.aborted) {
          reject(ticket.signal.reason ?? new Error('Aborted'));
          return;
        }
        const handler = () => {
          reject(ticket.signal.reason ?? new Error('Aborted'));
        };
        ticket.signal.addEventListener('abort', handler, { once: true });
        abortCleanup = () => ticket.signal.removeEventListener('abort', handler);
      });

      const value = await Promise.race([opPromise, abortPromise]);

      if (ticket.signal.aborted) {
        throw ticket.signal.reason ?? new Error('Aborted');
      }

      callerSettled = true;
      ticket.resolve(value);

      const finishedAt = Date.now();
      this.emitEvent({
        type: 'finished',
        lane: 'foreground',
        sessionAlias: ticket.sessionAlias,
        label: ticket.label,
        holdMs: finishedAt - startedAt,
        outcome: 'resolved',
        at: finishedAt
      });
    } catch (error) {
      callerSettled = true;
      const isTimeout = isDomReadTimeout(error);
      const isActiveAbort = ticket.started && ticket.signal.aborted;

      if ((isTimeout || isActiveAbort) && !this.stoppedSessions.has(ticket.sessionAlias)) {
        ticket.abortedActive = isActiveAbort;
        this.poison(
          ticket.sessionAlias,
          ticket.label,
          error,
          isTimeout ? 'DOM_READ_TIMEOUT' : 'ACTIVE_ABORT'
        );
        releaseNormally = false;
      } else if (!isTimeout && !isActiveAbort) {
        const finishedAt = Date.now();
        this.emitEvent({
          type: 'finished',
          lane: 'foreground',
          sessionAlias: ticket.sessionAlias,
          label: ticket.label,
          holdMs: finishedAt - startedAt,
          outcome: 'rejected',
          at: finishedAt
        });
      }

      ticket.reject(error);
    } finally {
      abortCleanup?.();
      if (releaseNormally && this.currentForegroundOwner === ticket.sessionAlias) {
        if (!this.poisonedSessions.has(ticket.sessionAlias) || this.stoppedSessions.has(ticket.sessionAlias)) {
          this.activeForeground--;
          this.currentForegroundOwner = undefined;
          queueMicrotask(() => {
            this.processQueue('foreground');
          });
        }
      }
    }
  }

  private async runEditorTicket(ticket: Ticket<unknown>): Promise<void> {
    const startedAt = Date.now();
    const waitMs = startedAt - ticket.enqueuedAt;
    ticket.started = true;

    this.emitEvent({
      type: 'started',
      lane: 'editor',
      sessionAlias: ticket.sessionAlias,
      label: ticket.label,
      waitMs,
      at: startedAt
    });

    let callerSettled = false;
    let abortCleanup: (() => void) | undefined;
    let releaseNormally = true;

    try {
      let opPromise: Promise<unknown>;
      try {
        opPromise = Promise.resolve(ticket.operation());
      } catch (err) {
        opPromise = Promise.reject(err);
      }

      opPromise.then(
        () => {
          if (callerSettled && ticket.abortedActive) {
            this.emitEvent({
              type: 'late-settled',
              sessionAlias: ticket.sessionAlias,
              label: ticket.label,
              outcome: 'resolved',
              at: Date.now()
            });
          }
        },
        () => {
          if (callerSettled && ticket.abortedActive) {
            this.emitEvent({
              type: 'late-settled',
              sessionAlias: ticket.sessionAlias,
              label: ticket.label,
              outcome: 'rejected',
              at: Date.now()
            });
          }
        }
      );

      const abortPromise = new Promise<never>((_, reject) => {
        if (ticket.signal.aborted) {
          reject(ticket.signal.reason ?? new Error('Aborted'));
          return;
        }
        const handler = () => {
          reject(ticket.signal.reason ?? new Error('Aborted'));
        };
        ticket.signal.addEventListener('abort', handler, { once: true });
        abortCleanup = () => ticket.signal.removeEventListener('abort', handler);
      });

      const value = await Promise.race([opPromise, abortPromise]);

      if (ticket.signal.aborted) {
        throw ticket.signal.reason ?? new Error('Aborted');
      }

      callerSettled = true;
      ticket.resolve(value);

      const finishedAt = Date.now();
      this.emitEvent({
        type: 'finished',
        lane: 'editor',
        sessionAlias: ticket.sessionAlias,
        label: ticket.label,
        holdMs: finishedAt - startedAt,
        outcome: 'resolved',
        at: finishedAt
      });
    } catch (error) {
      callerSettled = true;
      const isTimeout = isDomReadTimeout(error);
      const isActiveAbort = ticket.started && ticket.signal.aborted;
      if (isTimeout || isActiveAbort) {
        ticket.abortedActive = ticket.signal.aborted;
        if (!this.stoppedSessions.has(ticket.sessionAlias)) {
          this.retainedEditors.add(ticket.sessionAlias);
          this.poison(
            ticket.sessionAlias,
            ticket.label,
            error,
            isTimeout ? 'DOM_READ_TIMEOUT' : 'ACTIVE_ABORT'
          );
          releaseNormally = false;
        }
      } else {
        const finishedAt = Date.now();
        this.emitEvent({
          type: 'finished',
          lane: 'editor',
          sessionAlias: ticket.sessionAlias,
          label: ticket.label,
          holdMs: finishedAt - startedAt,
          outcome: 'rejected',
          at: finishedAt
        });
      }
      ticket.reject(error);
    } finally {
      abortCleanup?.();
      if (releaseNormally) {
        if (this.poisonedSessions.has(ticket.sessionAlias) && !this.stoppedSessions.has(ticket.sessionAlias)) {
          this.retainedEditors.add(ticket.sessionAlias);
        } else {
          this.releaseEditorOwner(ticket.sessionAlias);
        }
      }
    }
  }

  private poison(
    sessionAlias: string,
    label: string,
    error: unknown,
    code: 'DOM_READ_TIMEOUT' | 'ACTIVE_ABORT'
  ): void {
    if (this.poisonedSessions.has(sessionAlias)) return;
    this.poisonedSessions.set(sessionAlias, error);
    this.quarantinedAlias ??= sessionAlias;
    this.drainSessionQueues(sessionAlias, error);
    this.emitEvent({
      type: 'quarantined',
      sessionAlias,
      label,
      code,
      at: Date.now()
    });
  }

  private drainSessionQueues(sessionAlias: string, error: unknown): void {
    for (const lane of ['foreground', 'editor'] as const) {
      const queue = this.queues[lane];
      for (let index = queue.length - 1; index >= 0; index--) {
        const ticket = queue[index];
        if (ticket.sessionAlias !== sessionAlias) continue;
        queue.splice(index, 1);
        ticket.cleanupAbortListener?.();
        ticket.reject(error);
      }
    }
  }

  private releaseEditorOwner(sessionAlias: string): void {
    const owned = this.activeEditorOwners.get(sessionAlias) ?? 0;
    if (owned === 0) return;
    if (owned === 1) this.activeEditorOwners.delete(sessionAlias);
    else this.activeEditorOwners.set(sessionAlias, owned - 1);
    this.activeEditor--;
    queueMicrotask(() => this.processQueue('editor'));
  }

  private emitEvent(event: UiSchedulerEvent): void {
    if (event.type === 'late-settled' && this.stoppedSessions.has(event.sessionAlias)) return;
    try {
      this.onEvent?.(event);
    } catch {
      // Listeners should never crash scheduler logic
    }
  }
}

export function createDirectUiInteraction(
  signal: AbortSignal,
  focusMode: 'native' | 'target' = 'native'
): AccountUiInteraction {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    return operation();
  };
  return {
    focusMode,
    foreground: (_label, operation) => run(operation),
    editor: (_label, operation) => run(operation)
  };
}

export function mapUiSchedulerEventToEvidence(
  runId: string,
  event: UiSchedulerEvent
): AutomationEvidenceNonTerminalEvent {
  const at = new Date(event.at).toISOString();
  switch (event.type) {
    case 'queued':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'ui-queued',
        lane: event.lane,
        label: toUiEvidenceLabel(event.label)
      };
    case 'started':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'ui-started',
        lane: event.lane,
        label: toUiEvidenceLabel(event.label),
        waitMs: event.waitMs
      };
    case 'finished':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'ui-finished',
        lane: event.lane,
        label: toUiEvidenceLabel(event.label),
        holdMs: event.holdMs,
        outcome: event.outcome
      };
    case 'quarantined':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'ui-quarantined',
        label: toUiEvidenceLabel(event.label),
        code: event.code
      };
    case 'profile-stopped':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'profile-stop',
        outcome: 'confirmed'
      };
    case 'late-settled':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        workerAlias: event.sessionAlias.split('-session-')[0],
        type: 'ui-late-settled',
        label: toUiEvidenceLabel(event.label),
        outcome: event.outcome
      };
    case 'shutdown':
      return {
        schemaVersion: 1,
        runId,
        at,
        type: 'scheduler-shutdown',
        code: event.code
      };
    default: {
      const _unreachable: never = event;
      throw new Error(`Unhandled scheduler event: ${JSON.stringify(_unreachable)}`);
    }
  }
}
