import { z } from 'zod';

import { EvidenceTaskKeySchema } from '../../../shared/schemas/automation-evidence.schema';

export type EvidenceAxis = 'business' | 'reward' | 'coverage';
export type EvidenceState = 'pass' | 'fail' | 'unknown' | 'not-required';
export type StepVerdict = 'pass' | 'fail' | 'unknown' | 'blocked' | 'not-run';

export interface StepResult {
  stepId: string;
  attemptId: string;
  verdict: StepVerdict;
  action: 'not-dispatched' | 'dispatched' | 'settled';
  business: EvidenceState;
  reward: EvidenceState;
  coverage: EvidenceState;
  reasonCode: string;
  evidenceRefs: string[];
}

export type StepObserver = (result: StepResult) => void;

export interface RewardStepResult {
  verdict: 'pass' | 'fail' | 'unknown';
  proofAt?: number;
  snapshotAt?: number;
  status?: number;
  reasonCode: string;
  evidenceRefs: string[];
}

export interface RewardAttempt {
  sessionAlias: string;
  stepAttemptId: string;
  taskKey: string;
  actionDispatchedAt: number;
}

export interface ExpectedRewardAttempt {
  sessionAlias: string;
  stepAttemptId: string;
  taskKey: string;
}

export type VerifyRewardStep = (
  attempt: RewardAttempt,
  deadlineAt: number,
) => Promise<RewardStepResult>;

export const STEP_REASON_CODES = [
  'VERIFIED',
  'EVIDENCE_FAILED',
  'EVIDENCE_UNKNOWN',
  'BLOCKED',
  'ALREADY_VERIFIED',
  'NOT_APPLICABLE',
] as const;

const identitySchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sessionAliasSchema = z.string()
  .regex(/^worker-[1-9]\d*-session-[1-9]\d*$/);

export const stepIdSchema = z.string()
  .regex(/^S(?:0[0-9]|1[0-9]|2[0-8])$/);

const evidenceStateSchema = z.enum(['pass', 'fail', 'unknown', 'not-required']);
const evidenceRefSchema = z.string().min(1).max(512);

export const stepResultSchema = z.object({
  stepId: stepIdSchema,
  attemptId: identitySchema,
  verdict: z.enum(['pass', 'fail', 'unknown', 'blocked', 'not-run']),
  action: z.enum(['not-dispatched', 'dispatched', 'settled']),
  business: evidenceStateSchema,
  reward: evidenceStateSchema,
  coverage: evidenceStateSchema,
  reasonCode: z.enum(STEP_REASON_CODES),
  evidenceRefs: z.array(evidenceRefSchema).min(1),
}).strict();

export const rewardAttemptSchema = z.object({
  sessionAlias: sessionAliasSchema,
  stepAttemptId: identitySchema,
  taskKey: EvidenceTaskKeySchema,
  actionDispatchedAt: z.number().finite().nonnegative(),
}).strict();

const expectedRewardAttemptSchema = rewardAttemptSchema.omit({ actionDispatchedAt: true });

export function validateRewardAttempt(
  expected: ExpectedRewardAttempt,
  candidate: unknown,
): RewardAttempt {
  const parsedExpected = expectedRewardAttemptSchema.safeParse(expected);
  const parsedCandidate = rewardAttemptSchema.safeParse(candidate);
  if (!parsedExpected.success || !parsedCandidate.success) {
    throw new Error('REWARD_ATTEMPT_INVALID');
  }
  const attempt = parsedCandidate.data;
  if (attempt.sessionAlias !== parsedExpected.data.sessionAlias
    || attempt.stepAttemptId !== parsedExpected.data.stepAttemptId
    || attempt.taskKey !== parsedExpected.data.taskKey) {
    throw new Error('REWARD_ATTEMPT_IDENTITY_MISMATCH');
  }
  return Object.freeze(attempt);
}

export interface StepEvidenceContract {
  stepId: string;
  attemptId: string;
  required: readonly EvidenceAxis[];
}

const stepEvidenceContractSchema = z.object({
  stepId: stepIdSchema,
  attemptId: identitySchema,
  required: z.array(z.enum(['business', 'reward', 'coverage'])).min(1),
}).strict().superRefine((contract, context) => {
  if (new Set(contract.required).size !== contract.required.length) {
    context.addIssue({
      code: 'custom',
      message: 'Required evidence axes must be unique',
      path: ['required'],
    });
  }
  if (!contract.required.includes('business') || !contract.required.includes('coverage')) {
    context.addIssue({
      code: 'custom',
      message: 'Executed steps require business and coverage evidence',
      path: ['required'],
    });
  }
});

export function deriveStepVerdict(
  required: readonly EvidenceAxis[],
  observed: Record<EvidenceAxis, EvidenceState>,
): 'pass' | 'fail' | 'unknown' {
  if (required.length === 0
    || new Set(required).size !== required.length
    || !required.includes('business')
    || !required.includes('coverage')) {
    return 'unknown';
  }
  const requiredStates = required.map((axis) => observed[axis]);
  if (requiredStates.includes('fail')) {
    return 'fail';
  }
  if (requiredStates.some((state) => state !== 'pass')) {
    return 'unknown';
  }
  return 'pass';
}

function immutableResult(result: StepResult): StepResult {
  return Object.freeze({
    ...result,
    evidenceRefs: Object.freeze([...result.evidenceRefs]) as unknown as string[],
  });
}

export function validateStepResult(
  contract: StepEvidenceContract,
  candidate: unknown,
): StepResult {
  const parsedContract = stepEvidenceContractSchema.safeParse(contract);
  const parsedResult = stepResultSchema.safeParse(candidate);
  if (!parsedContract.success || !parsedResult.success) {
    throw new Error('STEP_EVIDENCE_INVALID');
  }

  const result = parsedResult.data;
  if (result.stepId !== parsedContract.data.stepId
    || result.attemptId !== parsedContract.data.attemptId) {
    throw new Error('STEP_EVIDENCE_IDENTITY_MISMATCH');
  }

  const required = new Set<EvidenceAxis>(parsedContract.data.required);
  for (const axis of ['business', 'reward', 'coverage'] as const) {
    if (required.has(axis) && result[axis] === 'not-required') {
      throw new Error('STEP_REQUIRED_EVIDENCE_MISSING');
    }
    if (!required.has(axis) && result[axis] !== 'not-required') {
      throw new Error('STEP_EVIDENCE_CONTRACT_MISMATCH');
    }
  }

  if (result.verdict === 'not-run') {
    if (result.reasonCode !== 'ALREADY_VERIFIED' && result.reasonCode !== 'NOT_APPLICABLE') {
      throw new Error('STEP_NOT_RUN_REASON_INVALID');
    }
    if (result.action !== 'not-dispatched') {
      throw new Error('STEP_NOT_RUN_ACTION_INVALID');
    }
    return immutableResult(result);
  }

  const terminalState = {
    pass: { action: 'settled', reasonCode: 'VERIFIED' },
    fail: { action: 'settled', reasonCode: 'EVIDENCE_FAILED' },
    unknown: { action: 'settled', reasonCode: 'EVIDENCE_UNKNOWN' },
    blocked: { action: 'not-dispatched', reasonCode: 'BLOCKED' },
  } as const;
  const expectedState = terminalState[result.verdict];
  if (result.action !== expectedState.action || result.reasonCode !== expectedState.reasonCode) {
    throw new Error('STEP_RESULT_STATE_INVALID');
  }

  if (result.verdict === 'blocked') {
    return immutableResult(result);
  }

  const derived = deriveStepVerdict(parsedContract.data.required, result);
  if (result.verdict !== derived) {
    throw new Error('STEP_EVIDENCE_CONTRADICTION');
  }

  return immutableResult(result);
}

export interface StepResultSummary {
  executed: number;
  passed: number;
  failed: number;
  unknown: number;
  blocked: number;
  notRun: number;
}

export interface OwnedStepResult {
  sessionAlias: string;
  result: StepResult;
}

const ownedStepResultSchema = z.object({
  sessionAlias: sessionAliasSchema,
  result: stepResultSchema,
}).strict();

export class StepResultCollector {
  readonly sessionAlias: string;

  readonly #contracts = new Map<string, StepEvidenceContract>();
  readonly #results = new Map<string, StepResult>();

  constructor(sessionAlias: string, contracts: readonly StepEvidenceContract[]) {
    this.sessionAlias = sessionAliasSchema.parse(sessionAlias);
    if (contracts.length === 0) {
      throw new Error('STEP_CONTRACTS_EMPTY');
    }
    for (const candidate of contracts) {
      const contract = stepEvidenceContractSchema.parse(candidate);
      if (this.#contracts.has(contract.stepId)) {
        throw new Error('STEP_CONTRACT_DUPLICATE');
      }
      this.#contracts.set(contract.stepId, Object.freeze({
        ...contract,
        required: Object.freeze([...contract.required]),
      }));
    }
  }

  record(candidate: unknown): StepResult {
    const parsedEnvelope = ownedStepResultSchema.safeParse(candidate);
    if (!parsedEnvelope.success) {
      throw new Error('STEP_EVIDENCE_INVALID');
    }
    if (parsedEnvelope.data.sessionAlias !== this.sessionAlias) {
      throw new Error('STEP_RESULT_OWNER_MISMATCH');
    }
    const resultCandidate = parsedEnvelope.data.result;

    const contract = this.#contracts.get(resultCandidate.stepId);
    if (!contract || contract.attemptId !== resultCandidate.attemptId) {
      throw new Error('STEP_EVIDENCE_IDENTITY_MISMATCH');
    }
    if (this.#results.has(contract.stepId)) {
      throw new Error('STEP_RESULT_DUPLICATE');
    }

    const result = validateStepResult(contract, resultCandidate);
    this.#results.set(result.stepId, result);
    return result;
  }

  get results(): readonly StepResult[] {
    return Object.freeze([...this.#results.values()]);
  }

  get summary(): StepResultSummary {
    const summary: StepResultSummary = {
      executed: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      blocked: 0,
      notRun: 0,
    };
    for (const result of this.#results.values()) {
      if (result.verdict === 'not-run') {
        summary.notRun += 1;
        continue;
      }
      if (result.verdict === 'blocked') {
        summary.blocked += 1;
        continue;
      }
      summary.executed += 1;
      if (result.verdict === 'pass') summary.passed += 1;
      if (result.verdict === 'fail') summary.failed += 1;
      if (result.verdict === 'unknown') summary.unknown += 1;
    }
    return summary;
  }
}

export class StepVerificationError extends Error {
  readonly code: 'STEP_VERIFICATION_FAILED' | 'STEP_VERIFICATION_UNKNOWN';
  readonly result: StepResult;

  constructor(result: StepResult) {
    if (result.verdict !== 'fail' && result.verdict !== 'unknown') {
      throw new Error('STEP_VERIFICATION_ERROR_VERDICT_INVALID');
    }
    super(`Step ${result.stepId} verification ${result.verdict}`);
    this.name = 'StepVerificationError';
    this.code = result.verdict === 'fail'
      ? 'STEP_VERIFICATION_FAILED'
      : 'STEP_VERIFICATION_UNKNOWN';
    this.result = immutableResult(stepResultSchema.parse(result));
  }
}

export class DiagnosticBoundaryReached extends Error {
  readonly code = 'DIAGNOSTIC_BOUNDARY_REACHED' as const;
  readonly stepId: string;

  constructor(stepId: string) {
    const parsedStepId = stepIdSchema.parse(stepId);
    super(`Diagnostic boundary reached after ${parsedStepId}`);
    this.name = 'DiagnosticBoundaryReached';
    this.stepId = parsedStepId;
  }
}
