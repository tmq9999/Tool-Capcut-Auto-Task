import type { UnsettledTaskProof } from './types';
import type { TaskListFailureDetail } from './httpTasks';

export class TaskEvidenceError extends Error {
  readonly unsettledProofs: readonly UnsettledTaskProof[];
  readonly diagnostic?: TaskListFailureDetail;

  constructor(
    message: string,
    proofs: readonly UnsettledTaskProof[],
    optionsOrDiagnostic?: TaskListFailureDetail | { cause?: unknown; diagnostic?: TaskListFailureDetail } | unknown
  ) {
    super(message);
    this.name = 'TaskEvidenceError';
    this.unsettledProofs = proofs.map((x) => ({ key: x.key, proof: { ...x.proof } }));
    if (optionsOrDiagnostic && typeof optionsOrDiagnostic === 'object') {
      if ('reason' in optionsOrDiagnostic && 'phase' in optionsOrDiagnostic) {
        this.diagnostic = optionsOrDiagnostic as TaskListFailureDetail;
      } else {
        const opts = optionsOrDiagnostic as { cause?: unknown; diagnostic?: TaskListFailureDetail };
        if (opts.diagnostic) {
          this.diagnostic = opts.diagnostic;
        }
        if (opts.cause) {
          this.cause = opts.cause;
          if (!this.diagnostic && typeof opts.cause === 'object' && opts.cause !== null && 'diagnostic' in opts.cause) {
            this.diagnostic = (opts.cause as { diagnostic?: TaskListFailureDetail }).diagnostic;
          }
        }
      }
    }
  }
}

