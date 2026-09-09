import { describe, expect, it } from 'vitest';

import {
  DiagnosticBoundaryReached,
  StepResultCollector,
  StepVerificationError,
  deriveStepVerdict,
  rewardAttemptSchema,
  stepResultSchema,
  validateRewardAttempt,
  validateStepResult,
  type StepResult,
} from '../stepEvidence';

const passResult = (overrides: Partial<StepResult> = {}): StepResult => ({
  stepId: 'S00',
  attemptId: 'attempt-00',
  verdict: 'pass',
  action: 'settled',
  business: 'pass',
  reward: 'pass',
  coverage: 'pass',
  reasonCode: 'VERIFIED',
  evidenceRefs: ['receipt:00'],
  ...overrides,
});

const owned = (result: StepResult, sessionAlias = 'worker-1-session-1') => ({
  sessionAlias,
  result,
});

describe('deriveStepVerdict', () => {
  it('does not turn a rewarded export into a completed artifact', () => {
    expect(deriveStepVerdict(['business', 'reward', 'coverage'], {
      business: 'unknown',
      reward: 'pass',
      coverage: 'pass',
    })).toBe('unknown');
  });

  it('gives failure priority over passing evidence', () => {
    expect(deriveStepVerdict(['business', 'reward', 'coverage'], {
      business: 'fail',
      reward: 'pass',
      coverage: 'pass',
    })).toBe('fail');
  });

  it('does not accept not-required for a required axis', () => {
    expect(deriveStepVerdict(['business'], {
      business: 'not-required',
      reward: 'not-required',
      coverage: 'not-required',
    })).toBe('unknown');
  });

  it('does not derive pass from an empty required-axis contract', () => {
    expect(deriveStepVerdict([], {
      business: 'not-required',
      reward: 'not-required',
      coverage: 'not-required',
    })).toBe('unknown');
  });

  it('does not derive pass from reward evidence without business and coverage', () => {
    expect(deriveStepVerdict(['reward'], {
      business: 'not-required',
      reward: 'pass',
      coverage: 'not-required',
    })).toBe('unknown');
  });

  it('does not derive pass from duplicate required axes', () => {
    expect(deriveStepVerdict(['business', 'business'], {
      business: 'pass',
      reward: 'not-required',
      coverage: 'not-required',
    })).toBe('unknown');
  });
});

describe('step evidence schemas', () => {
  it('rejects step ids outside S00 through S28', () => {
    expect(stepResultSchema.safeParse(passResult({ stepId: 'S29' })).success).toBe(false);
  });

  it('rejects reason codes outside the persistence allowlist', () => {
    expect(stepResultSchema.safeParse(passResult({ reasonCode: 'WHATEVER_CALLER_SAYS' })).success).toBe(false);
  });

  it('rejects malformed reward attempt identity', () => {
    expect(rewardAttemptSchema.safeParse({
      sessionAlias: 'worker-1-session-1',
      stepAttemptId: 'contains spaces',
      taskKey: 'export_task',
      actionDispatchedAt: 100,
    }).success).toBe(false);
  });

  it('rejects zero-based session aliases', () => {
    expect(rewardAttemptSchema.safeParse({
      sessionAlias: 'worker-0-session-1',
      stepAttemptId: 'attempt-00',
      taskKey: 'capcut_web_pwa_install',
      actionDispatchedAt: 100,
    }).success).toBe(false);
  });

  it('rejects a reward attempt task outside the observed CapCut task allowlist', () => {
    expect(rewardAttemptSchema.safeParse({
      sessionAlias: 'worker-1-session-1',
      stepAttemptId: 'attempt-00',
      taskKey: 'capcut_web_made_up_task',
      actionDispatchedAt: 100,
    }).success).toBe(false);
  });
});

describe('validateRewardAttempt', () => {
  const expected = {
    sessionAlias: 'worker-1-session-1',
    stepAttemptId: 'attempt-00',
    taskKey: 'capcut_web_pwa_install',
  } as const;

  it('accepts an attempt owned by the expected session, step attempt, and task', () => {
    expect(validateRewardAttempt(expected, {
      ...expected,
      actionDispatchedAt: 100,
    })).toEqual({
      ...expected,
      actionDispatchedAt: 100,
    });
  });

  it.each([
    ['sessionAlias', 'worker-2-session-1'],
    ['stepAttemptId', 'attempt-01'],
    ['taskKey', 'capcut_web_push_authorize'],
  ] as const)('rejects a reward attempt with the wrong %s owner', (field, value) => {
    expect(() => validateRewardAttempt(expected, {
      ...expected,
      [field]: value,
      actionDispatchedAt: 100,
    })).toThrow('REWARD_ATTEMPT_IDENTITY_MISMATCH');
  });
});

describe('validateStepResult', () => {
  const contract = {
    stepId: 'S00',
    attemptId: 'attempt-00',
    required: ['business', 'reward', 'coverage'] as const,
  };

  it('fails closed when evidence references are missing', () => {
    expect(() => validateStepResult(contract, passResult({ evidenceRefs: [] }))).toThrow('STEP_EVIDENCE_INVALID');
  });

  it('rejects a result from the wrong attempt identity', () => {
    expect(() => validateStepResult(contract, passResult({ attemptId: 'attempt-other' }))).toThrow('STEP_EVIDENCE_IDENTITY_MISMATCH');
  });

  it('rejects a pass that contradicts required evidence', () => {
    expect(() => validateStepResult(contract, passResult({ business: 'unknown' }))).toThrow('STEP_EVIDENCE_CONTRADICTION');
  });

  it('does not let the result mark a required axis not-required', () => {
    expect(() => validateStepResult(contract, passResult({ business: 'not-required', verdict: 'unknown' }))).toThrow('STEP_REQUIRED_EVIDENCE_MISSING');
  });

  it('rejects an executed-step contract that requires reward without business and coverage', () => {
    expect(() => validateStepResult({
      stepId: 'S00',
      attemptId: 'attempt-00',
      required: ['reward'],
    }, passResult({
      business: 'not-required',
      coverage: 'not-required',
    }))).toThrow('STEP_EVIDENCE_INVALID');
  });

  it.each([
    ['pass', 'EVIDENCE_FAILED', 'settled'],
    ['pass', 'VERIFIED', 'not-dispatched'],
    ['fail', 'VERIFIED', 'settled'],
    ['unknown', 'VERIFIED', 'settled'],
    ['blocked', 'VERIFIED', 'not-dispatched'],
    ['blocked', 'BLOCKED', 'settled'],
  ] as const)('rejects inconsistent %s, %s, %s terminal state', (verdict, reasonCode, action) => {
    expect(() => validateStepResult(contract, passResult({
      verdict,
      reasonCode,
      action,
      business: verdict === 'fail' ? 'fail' : verdict === 'unknown' ? 'unknown' : 'pass',
    }))).toThrow('STEP_RESULT_STATE_INVALID');
  });
});

describe('StepResultCollector', () => {
  const contracts = [
    { stepId: 'S00', attemptId: 'attempt-00', required: ['business', 'reward', 'coverage'] as const },
    { stepId: 'S01', attemptId: 'attempt-01', required: ['business', 'coverage'] as const },
    { stepId: 'S02', attemptId: 'attempt-02', required: ['business', 'coverage'] as const },
  ];

  it('rejects an empty contract collection', () => {
    expect(() => new StepResultCollector('worker-1-session-1', [])).toThrow('STEP_CONTRACTS_EMPTY');
  });

  it('rejects contracts without the business and coverage baseline', () => {
    expect(() => new StepResultCollector('worker-1-session-1', [{
      stepId: 'S00',
      attemptId: 'attempt-00',
      required: ['reward'],
    }])).toThrow();
  });

  it('rejects a duplicate terminal result', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);
    collector.record(owned(passResult()));

    expect(() => collector.record(owned(passResult()))).toThrow('STEP_RESULT_DUPLICATE');
  });

  it('rejects a result envelope owned by another session', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);

    expect(() => collector.record(owned(passResult(), 'worker-2-session-1'))).toThrow('STEP_RESULT_OWNER_MISMATCH');
  });

  it('preserves a passing result when a later step fails', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);
    collector.record(owned(passResult()));
    collector.record(owned(passResult({
      stepId: 'S01',
      attemptId: 'attempt-01',
      verdict: 'fail',
      reward: 'not-required',
      coverage: 'pass',
      business: 'fail',
      reasonCode: 'EVIDENCE_FAILED',
      evidenceRefs: ['artifact:failure-01'],
    })));

    expect(collector.results.map(({ stepId, verdict }) => ({ stepId, verdict }))).toEqual([
      { stepId: 'S00', verdict: 'pass' },
      { stepId: 'S01', verdict: 'fail' },
    ]);
  });

  it('stores an immutable copy of a result', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);
    const evidenceRefs = ['receipt:00'];
    collector.record(owned(passResult({ evidenceRefs })));

    evidenceRefs.push('late:mutation');

    expect(collector.results[0]?.evidenceRefs).toEqual(['receipt:00']);
    expect(Object.isFrozen(collector.results[0]?.evidenceRefs)).toBe(true);
    expect(Object.isFrozen(collector.results[0])).toBe(true);
  });

  it('does not count an already verified not-run step as executed or passed', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);
    collector.record(owned(passResult({
      stepId: 'S02',
      attemptId: 'attempt-02',
      verdict: 'not-run',
      action: 'not-dispatched',
      business: 'unknown',
      reward: 'not-required',
      coverage: 'unknown',
      reasonCode: 'ALREADY_VERIFIED',
      evidenceRefs: ['prerequisite:S01'],
    })));

    expect(collector.summary).toEqual({
      executed: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      blocked: 0,
      notRun: 1,
    });
  });

  it('restricts not-run to the two approved reasons', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);

    expect(() => collector.record(owned(passResult({
      stepId: 'S02',
      attemptId: 'attempt-02',
      verdict: 'not-run',
      action: 'not-dispatched',
      business: 'unknown',
      reward: 'not-required',
      coverage: 'unknown',
      reasonCode: 'EVIDENCE_UNKNOWN',
      evidenceRefs: ['prerequisite:S01'],
    })))).toThrow('STEP_NOT_RUN_REASON_INVALID');
  });

  it('counts a blocked not-dispatched step without marking it executed', () => {
    const collector = new StepResultCollector('worker-1-session-1', contracts);
    collector.record(owned(passResult({
      stepId: 'S02',
      attemptId: 'attempt-02',
      verdict: 'blocked',
      action: 'not-dispatched',
      business: 'unknown',
      reward: 'not-required',
      coverage: 'unknown',
      reasonCode: 'BLOCKED',
      evidenceRefs: ['prerequisite:S01'],
    })));

    expect(collector.summary).toEqual({
      executed: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      blocked: 1,
      notRun: 0,
    });
  });
});

describe('step control-flow errors', () => {
  it('keeps a failed result on StepVerificationError', () => {
    const result = passResult({ verdict: 'fail', business: 'fail', reasonCode: 'EVIDENCE_FAILED' });
    const error = new StepVerificationError(result);

    expect(error.name).toBe('StepVerificationError');
    expect(error.code).toBe('STEP_VERIFICATION_FAILED');
    expect(error.result).toEqual(result);
  });

  it('identifies an expected diagnostic boundary without a DOM timeout code', () => {
    const error = new DiagnosticBoundaryReached('S18');

    expect(error.name).toBe('DiagnosticBoundaryReached');
    expect(error.code).toBe('DIAGNOSTIC_BOUNDARY_REACHED');
    expect(error.stepId).toBe('S18');
  });
});
