import { isDomReadTimeout } from './cancellation';
import type {
  AccountUiInteraction,
  UiLane,
  UiSchedulerEvent,
  UiSessionIdentity
} from './types';
import type { AutomationEvidenceEvent } from '../../../shared/schemas/automation-evidence.schema';

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
      foreground: <T>(label: string, operation: () => Promise<T>) =>
        this.enqueue<T>('foreground', identity, label, operation),
      editor: <T>(label: string, operation: () => Promise<T>) =>
        this.enqueue<T>('editor', identity, label, operation)
    };
  }

  confirmProfileStopped(sessionAlias: string): void {
    if (this.quarantinedAlias === sessionAlias) {
      this.quarantinedAlias = null;
      this.emitEvent({
        type: 'profile-stopped',
        sessionAlias,
        at: Date.now()
      });
      queueMicrotask(() => {
        this.processQueue('foreground');
      });
    }
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
      quarantinedSessionAliases: this.quarantinedAlias ? [this.quarantinedAlias] : []
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
        if (ticket.signal.aborted) {
          ticket.cleanupAbortListener?.();
          ticket.reject(ticket.signal.reason ?? new Error('Aborted'));
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
        if (ticket.signal.aborted) {
          ticket.cleanupAbortListener?.();
          ticket.reject(ticket.signal.reason ?? new Error('Aborted'));
          continue;
        }

        this.activeEditor++;
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

      let abortCleanup: (() => void) | undefined;
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
      abortCleanup?.();

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
        at: finishedAt
      });
    } catch (error) {
      callerSettled = true;
      const isTimeout = isDomReadTimeout(error);
      const isActiveAbort = ticket.started && ticket.signal.aborted;

      if (isTimeout || isActiveAbort) {
        ticket.abortedActive = isActiveAbort;
        this.quarantine(
          ticket.sessionAlias,
          ticket.label,
          isTimeout ? 'DOM_READ_TIMEOUT' : 'ACTIVE_ABORT'
        );
        releaseNormally = false;
      }

      ticket.reject(error);
    } finally {
      this.activeForeground--;
      if (this.currentForegroundOwner === ticket.sessionAlias) {
        this.currentForegroundOwner = undefined;
      }
      if (releaseNormally) {
        queueMicrotask(() => {
          this.processQueue('foreground');
        });
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

      let abortCleanup: (() => void) | undefined;
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
      abortCleanup?.();

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
        at: finishedAt
      });
    } catch (error) {
      callerSettled = true;
      if (ticket.started && ticket.signal.aborted) {
        ticket.abortedActive = true;
      }
      ticket.reject(error);
    } finally {
      this.activeEditor--;
      queueMicrotask(() => {
        this.processQueue('editor');
      });
    }
  }

  private quarantine(
    sessionAlias: string,
    label: string,
    code: 'DOM_READ_TIMEOUT' | 'ACTIVE_ABORT'
  ): void {
    this.quarantinedAlias = sessionAlias;
    this.emitEvent({
      type: 'quarantined',
      sessionAlias,
      label,
      code,
      at: Date.now()
    });
  }

  private emitEvent(event: UiSchedulerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Listeners should never crash scheduler logic
    }
  }
}

export function createDirectUiInteraction(signal: AbortSignal): AccountUiInteraction {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    return operation();
  };
  return {
    foreground: (_label, operation) => run(operation),
    editor: (_label, operation) => run(operation)
  };
}

export function mapUiSchedulerEventToEvidence(
  runId: string,
  event: UiSchedulerEvent
): AutomationEvidenceEvent {
  const at = new Date(event.at).toISOString();
  switch (event.type) {
    case 'queued':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'ui-queued',
        lane: event.lane,
        label: event.label
      };
    case 'started':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'ui-started',
        lane: event.lane,
        label: event.label,
        waitMs: event.waitMs
      };
    case 'finished':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'ui-finished',
        lane: event.lane,
        label: event.label,
        holdMs: event.holdMs
      };
    case 'quarantined':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'ui-quarantined',
        label: event.label,
        code: event.code
      };
    case 'profile-stopped':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'profile-stop',
        outcome: 'confirmed'
      };
    case 'late-settled':
      return {
        schemaVersion: 1,
        runId,
        at,
        sessionAlias: event.sessionAlias,
        type: 'ui-late-settled',
        label: event.label,
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

