import type { ActionProof, CapcutTask, TaskSnapshot } from './taskTypes';

export type HttpTaskEvidenceState = 'pending' | 'verified' | 'failed' | 'unknown';

export interface HttpTaskEvidence {
  readonly taskKey: string;
  readonly status: number;
  readonly state: HttpTaskEvidenceState;
  readonly proof?: ActionProof;
  readonly snapshotAt?: number;
  readonly updatedAt: number;
}

/** One run's evidence. The caller must supply only this account's responses. */
export class HttpTaskEvidenceReducer {
  private readonly entries = new Map<string, HttpTaskEvidence>();
  private snapshotAt = 0;

  applySnapshot(snapshot: TaskSnapshot): void {
    if (snapshot.at <= this.snapshotAt) return;
    this.snapshotAt = snapshot.at;
    for (const task of snapshot.byKey.values()) {
      const previous = this.entries.get(task.taskKey);
      const proof = previous?.proof;
      this.entries.set(task.taskKey, {
        taskKey: task.taskKey,
        status: task.status,
        state: previous?.state === 'unknown' ? 'unknown'
          : proof && proof.errNo !== 0 ? 'failed'
            : task.status === 4 && proof?.errNo === 0 && snapshot.at > proof.at ? 'verified' : 'pending',
        ...(proof ? { proof } : {}),
        snapshotAt: snapshot.at,
        updatedAt: Math.max(snapshot.at, previous?.updatedAt ?? 0)
      });
    }
  }

  applyProof(proof: ActionProof): void {
    const previous = this.entries.get(proof.actionKey);
    if (previous?.proof && proof.at <= previous.proof.at) return;
    const status = previous?.status ?? 1;
    this.entries.set(proof.actionKey, {
      taskKey: proof.actionKey,
      status,
      state: previous?.state === 'unknown' ? 'unknown'
        : proof.errNo !== 0 ? 'failed'
          : status === 4 && (previous?.snapshotAt ?? 0) > proof.at ? 'verified' : 'pending',
      proof: Object.freeze({ ...proof }),
      snapshotAt: previous?.snapshotAt,
      updatedAt: Math.max(proof.at, previous?.updatedAt ?? 0)
    });
  }

  markUnknown(taskKey: string, at = Date.now()): void {
    const previous = this.entries.get(taskKey);
    this.entries.set(taskKey, { ...previous, taskKey, status: previous?.status ?? 1, state: 'unknown', updatedAt: Math.max(at, previous?.updatedAt ?? 0) });
  }

  get(taskKey: string): HttpTaskEvidence | undefined { return this.entries.get(taskKey); }
  all(): HttpTaskEvidence[] { return [...this.entries.values()]; }
}

export function taskIsVerified(task: CapcutTask, evidence: HttpTaskEvidence | undefined): boolean {
  return task.status === 4 && evidence?.state === 'verified' && evidence.proof?.errNo === 0;
}
