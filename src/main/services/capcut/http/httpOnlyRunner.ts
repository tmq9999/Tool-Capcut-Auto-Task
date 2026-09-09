import type { AccountHttpSession } from './accountSession';
import { assertAccountHttpSessionUsable } from './accountSession';
import type { CapcutTask, TaskSnapshot } from './taskTypes';
import { HttpTaskEvidenceReducer } from './taskEvidence';
import type { HttpContract } from './contractRegistry';

export interface HttpMissionOperation {
  readonly name: string;
  readonly taskKeys: readonly string[];
  readonly contract?: HttpContract;
  run(session: AccountHttpSession, signal: AbortSignal, need: ReadonlySet<string>): Promise<HttpOperationReceipt>;
}

export interface HttpOperationReceipt {
  readonly operationId: string;
  readonly taskKeys: readonly string[];
  readonly proofs: readonly { actionKey: string; errNo: number; opId: string }[];
}

export interface HttpOnlyRunResult {
  snapshot: TaskSnapshot;
  evidence: HttpTaskEvidenceReducer;
  operations: string[];
}

export interface HttpOnlyRunnerDeps {
  getTaskList(signal: AbortSignal): Promise<TaskSnapshot>;
}

/** Executes only explicitly registered HTTP operations; no browser fallback exists. */
export class HttpOnlyRunner {
  constructor(private readonly deps: HttpOnlyRunnerDeps, private readonly operations: readonly HttpMissionOperation[]) {}

  async run(session: AccountHttpSession, signal: AbortSignal): Promise<HttpOnlyRunResult> {
    assertAccountHttpSessionUsable(session);
    signal.throwIfAborted();
    let snapshot = await this.deps.getTaskList(signal);
    const writers = new Set<string>();
    for (const operation of this.operations) {
      if (!operation.contract || !['fixture-verified', 'live-verified'].includes(operation.contract.state)) {
        throw new Error('CONTRACT_UNAVAILABLE');
      }
      for (const key of operation.taskKeys) {
        if (writers.has(key)) throw new Error('HTTP_OPERATION_DUPLICATE');
        writers.add(key);
      }
    }
    const tasksById = new Map([...snapshot.byKey.values()].map(task => [task.taskId, task]));
    const covered = (task: CapcutTask, ancestors = new Set<number>()): boolean => {
      if (task.status === 4 || writers.has(task.taskKey)) return true;
      if (!task.childIds.length || ancestors.has(task.taskId)) return false;
      const path = new Set(ancestors).add(task.taskId);
      return task.childIds.every(id => {
        const child = tasksById.get(id);
        return child !== undefined && covered(child, path);
      });
    };
    for (const task of availableHttpTasks(snapshot)) {
      // Server-managed parent rewards have children, not their own mutation.
      if (!covered(task)) throw new Error('HTTP_OPERATION_UNAVAILABLE');
    }
    const evidence = new HttpTaskEvidenceReducer();
    evidence.applySnapshot(snapshot);
    const executed: string[] = [];
    for (const operation of this.operations) {
      signal.throwIfAborted();
      const need = new Set(operation.taskKeys.filter((key) => {
        const task = snapshot.byKey.get(key);
        return task !== undefined && task.status !== 4;
      }));
      if (!need.size) continue;
      assertAccountHttpSessionUsable(session);
      const receipt = await operation.run(session, signal, need);
      if (!receipt.operationId || receipt.taskKeys.length !== need.size ||
        [...need].some((key) => !receipt.taskKeys.includes(key)) ||
        receipt.proofs.length !== need.size || receipt.proofs.some((proof) => proof.errNo !== 0 || !need.has(proof.actionKey))) {
        throw new Error('HTTP_OPERATION_RECEIPT_INVALID');
      }
      for (const proof of receipt.proofs) evidence.applyProof({ actionKey: proof.actionKey, opId: proof.opId, errNo: proof.errNo, errTips: '', at: Date.now() });
      executed.push(operation.name);
      snapshot = await this.deps.getTaskList(signal);
      evidence.applySnapshot(snapshot);
      if ([...need].some((key) => snapshot.byKey.get(key)?.status !== 4)) {
        throw new Error('HTTP_OPERATION_PROOF_PENDING');
      }
    }
    return { snapshot, evidence, operations: executed };
  }
}

export function availableHttpTasks(snapshot: TaskSnapshot): CapcutTask[] {
  return [...snapshot.byKey.values()].filter((task) => task.status !== 4);
}
