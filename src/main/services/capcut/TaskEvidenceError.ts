import type { UnsettledTaskProof } from './types';

export class TaskEvidenceError extends Error {
  readonly unsettledProofs: readonly UnsettledTaskProof[];

  constructor(message: string, proofs: readonly UnsettledTaskProof[]) {
    super(message);
    this.name = 'TaskEvidenceError';
    this.unsettledProofs = proofs.map((x) => ({ key: x.key, proof: { ...x.proof } }));
  }
}
