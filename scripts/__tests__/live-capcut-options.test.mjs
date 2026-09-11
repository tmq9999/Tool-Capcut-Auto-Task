import path from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBillableEmailAllowed,
  isTerminalRunState,
  terminalAccountCount,
  parseHeadlessFlag,
  parseMissionTransport,
  parseLiveCapcutOptions,
  LiveOptionError,
  LiveTimeoutError,
  LiveEvidenceError,
  EXIT_CODES,
  resolveExitCode
} from '../live-capcut-options.mjs';

describe('live CapCut harness legacy safety', () => {
  it('allows custom-domain verification without a billable flag', () => {
    expect(() => assertBillableEmailAllowed({ mode: 'custom' }, {})).not.toThrow();
  });

  it('blocks Gmail94 purchase unless its dedicated flag is present', () => {
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      {}
    )).toThrow('VERIFY_GMAIL94_BUY=1');
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      { VERIFY_GMAIL94_BUY: '1' }
    )).not.toThrow();
  });

  it('counts account outcomes and recognizes every terminal run state', () => {
    expect(terminalAccountCount({
      accountsCompleted: 4,
      accountsFailed: 2,
      accountsStopped: 1
    })).toBe(7);
    expect(['completed', 'stopped', 'blocked', 'failed'].every(isTerminalRunState))
      .toBe(true);
    expect(isTerminalRunState('running')).toBe(false);
  });

  it('parses the explicit headless live-run flag', () => {
    expect(parseHeadlessFlag(['--headless'])).toBe(true);
    expect(parseHeadlessFlag([])).toBe(false);
  });

  it('maps HTTP-only flags without implying browser execution', () => {
    expect(parseMissionTransport(['--http-only'])).toBe('http-only');
    expect(parseMissionTransport(['--mission-transport=ui'])).toBe('ui');
  });
});

describe('live CapCut rollout options controller (Task 13 Step 1)', () => {
  it('accepts the optional independence assertion without changing purchase caps', () => {
    const parsed = parseLiveCapcutOptions([
      '--mode=new-accounts',
      '--headed',
      '--require-independent',
      '--stage=1',
      '--email=api:gmail94',
      '--threads=1',
      '--mail-limit=1',
      '--approved-mailboxes=1',
      '--stop-after=1',
      '--max-billable-purchases=1'
    ], { VERIFY_GMAIL94_BUY: '1' });

    expect(parsed).toMatchObject({
      requireIndependent: true,
      caps: {
        threads: 1,
        mailLimit: 1,
        approvedMailboxes: 1,
        stopAfter: 1,
        maxBillablePurchases: 1
      }
    });
  });

  it('rejects an unknown option before side effects', () => {
    const sideEffectSpy = vi.fn();
    const validStage1Argv = [
      '--mode=new-accounts',
      '--headed',
      '--stage=1',
      '--email=api:gmail94',
      '--threads=1',
      '--mail-limit=1',
      '--approved-mailboxes=1',
      '--stop-after=1',
      '--max-billable-purchases=1'
    ];
    const env = { VERIFY_GMAIL94_BUY: '1' };

    const executeLiveRun = (argv, environment, onLaunch) => {
      const options = parseLiveCapcutOptions(argv, environment);
      return onLaunch(options);
    };

    expect(() => {
      executeLiveRun([...validStage1Argv, '--mystery=1'], env, sideEffectSpy);
    }).toThrow(LiveOptionError);

    expect(sideEffectSpy).not.toHaveBeenCalled();
  });

  it('requires explicit headed mode and rejects headless', () => {
    const baseArgv = [
      '--mode=new-accounts',
      '--stage=1',
      '--email=api:gmail94',
      '--threads=1',
      '--mail-limit=1',
      '--approved-mailboxes=1',
      '--stop-after=1',
      '--max-billable-purchases=1'
    ];
    const env = { VERIFY_GMAIL94_BUY: '1' };

    // Omit --headed
    expect(() => parseLiveCapcutOptions(baseArgv, env)).toThrow(LiveOptionError);

    // Provide --headless
    expect(() => parseLiveCapcutOptions([...baseArgv, '--headless'], env)).toThrow(LiveOptionError);

    // Provide both --headed and --headless
    expect(() => parseLiveCapcutOptions([...baseArgv, '--headed', '--headless'], env)).toThrow(LiveOptionError);

    // Valid with --headed
    expect(() => parseLiveCapcutOptions([...baseArgv, '--headed'], env)).not.toThrow();
  });

  it('requires every new-account cap to equal rollout stage', () => {
    const env = { VERIFY_GMAIL94_BUY: '1' };
    const stages = [1, 3, 5, 10];
    const capKeys = [
      'threads',
      'mail-limit',
      'approved-mailboxes',
      'stop-after',
      'max-billable-purchases'
    ];

    for (const stage of stages) {
      const buildArgv = (overrides = {}) => {
        const caps = {
          threads: stage,
          'mail-limit': stage,
          'approved-mailboxes': stage,
          'stop-after': stage,
          'max-billable-purchases': stage,
          ...overrides
        };
        const args = [
          '--mode=new-accounts',
          '--headed',
          `--stage=${stage}`,
          '--email=api:gmail94'
        ];
        for (const [k, v] of Object.entries(caps)) {
          if (v !== undefined) {
            args.push(`--${k}=${v}`);
          }
        }
        return args;
      };

      // Valid fully equal tuple
      const parsed = parseLiveCapcutOptions(buildArgv(), env);
      expect(parsed.mode).toBe('new-accounts');
      expect(parsed.stage).toBe(stage);
      expect(parsed.caps).toEqual({
        threads: stage,
        mailLimit: stage,
        approvedMailboxes: stage,
        stopAfter: stage,
        maxBillablePurchases: stage
      });

      // Omit each cap and set each cap to stage + 1
      for (const capKey of capKeys) {
        // Omit
        expect(() => parseLiveCapcutOptions(buildArgv({ [capKey]: undefined }), env)).toThrow(LiveOptionError);
        // Mismatched (stage + 1)
        expect(() => parseLiveCapcutOptions(buildArgv({ [capKey]: stage + 1 }), env)).toThrow(LiveOptionError);
      }
    }

    // Reject invalid stage (e.g. 2)
    const invalidStageArgv = [
      '--mode=new-accounts',
      '--headed',
      '--stage=2',
      '--email=api:gmail94',
      '--threads=2',
      '--mail-limit=2',
      '--approved-mailboxes=2',
      '--stop-after=2',
      '--max-billable-purchases=2'
    ];
    expect(() => parseLiveCapcutOptions(invalidStageArgv, env)).toThrow(LiveOptionError);
  });

  it('requires the provider-specific opt-in only for a paid invocation', () => {
    const stage1Args = (provider, mode = 'new-accounts') => [
      `--mode=${mode}`,
      '--headed',
      '--stage=1',
      `--email=api:${provider}`,
      '--threads=1',
      '--mail-limit=1',
      '--approved-mailboxes=1',
      '--stop-after=1',
      '--max-billable-purchases=1'
    ];

    // Gmail94 paid invocation without flag or false
    expect(() => parseLiveCapcutOptions(stage1Args('gmail94'), {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions(stage1Args('gmail94'), { VERIFY_GMAIL94_BUY: '0' })).toThrow(LiveOptionError);
    // Gmail94 paid invocation with correct flag
    const parsedGmail = parseLiveCapcutOptions(stage1Args('gmail94'), { VERIFY_GMAIL94_BUY: '1' });
    expect(parsedGmail.provider).toBe('gmail94');

    // DongVanFB paid invocation without flag or false
    expect(() => parseLiveCapcutOptions(stage1Args('dongvanfb'), {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions(stage1Args('dongvanfb'), { VERIFY_DONGVANFB_BUY: '0' })).toThrow(LiveOptionError);
    // DongVanFB paid invocation with correct flag
    const parsedDongvan = parseLiveCapcutOptions(stage1Args('dongvanfb'), { VERIFY_DONGVANFB_BUY: '1' });
    expect(parsedDongvan.provider).toBe('dongvanfb');

    // Dry-run parses without opt-in flag and still cannot execute
    const dryRunGmail = parseLiveCapcutOptions(stage1Args('gmail94', 'dry-run'), {});
    expect(dryRunGmail.mode).toBe('dry-run');
    expect(dryRunGmail.provider).toBe('gmail94');

    const dryRunDongvan = parseLiveCapcutOptions(stage1Args('dongvanfb', 'dry-run'), {});
    expect(dryRunDongvan.mode).toBe('dry-run');
    expect(dryRunDongvan.provider).toBe('dongvanfb');
  });

  it('health-only rejects all account email approval and purchase options', () => {
    // stage/thread pairs: only 3/3 and 10/10 parse; 3/10 and 10/3 reject
    expect(() => parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=3', '--threads=10'], {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=10', '--threads=3'], {})).toThrow(LiveOptionError);

    const parsed3 = parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=3', '--threads=3'], {});
    expect(parsed3.mode).toBe('health-only');
    expect(parsed3.stage).toBe(3);
    expect(parsed3.threads).toBe(3);

    const parsed10 = parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=10', '--threads=10'], {});
    expect(parsed10.mode).toBe('health-only');
    expect(parsed10.stage).toBe(10);
    expect(parsed10.threads).toBe(10);

    // Disallow other stages (e.g. 1 or 5) for health-only
    expect(() => parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=1', '--threads=1'], {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions(['--mode=health-only', '--headed', '--stage=5', '--threads=5'], {})).toThrow(LiveOptionError);

    // Forbidden options on health-only
    const forbiddenOptions = [
      '--email=api:gmail94',
      '--provider=gmail94',
      '--mail-limit=3',
      '--approved-mailboxes=3',
      '--max-billable-purchases=3',
      '--stop-after=3',
      '--account-ids-file=accounts.txt'
    ];

    for (const opt of forbiddenOptions) {
      expect(() => parseLiveCapcutOptions([
        '--mode=health-only',
        '--headed',
        '--stage=3',
        '--threads=3',
        opt
      ], {})).toThrow(LiveOptionError);
    }

    expect(() => parseLiveCapcutOptions([
      '--mode=health-only',
      '--headed',
      '--stage=3',
      '--threads=3',
      '--require-independent'
    ], {})).toThrow('INDEPENDENT_HEALTH_UNSUPPORTED');
  });

  it('resume rejects email and all billable options', () => {
    const secretContent = 'secret-account-id-12345-do-not-leak';
    const dummyFilePath = `d:/dummy/${secretContent}.txt`;

    const validResumeArgv = [
      '--mode=resume',
      '--headed',
      '--stage=3',
      '--threads=3',
      `--account-ids-file=${dummyFilePath}`
    ];

    const parsed = parseLiveCapcutOptions(validResumeArgv, {});
    expect(parsed.mode).toBe('resume');
    expect(parsed.stage).toBe(3);
    expect(parsed.threads).toBe(3);
    expect(parsed.accountIdsFile).toBe(dummyFilePath);

    // Resume forbids email and billable options
    const forbiddenForResume = [
      '--email=api:gmail94',
      '--provider=gmail94',
      '--mail-limit=3',
      '--approved-mailboxes=3',
      '--max-billable-purchases=3'
    ];

    for (const opt of forbiddenForResume) {
      expect(() => {
        try {
          parseLiveCapcutOptions([...validResumeArgv, opt], {});
        } catch (err) {
          // Assert account-ID file contents are never included in error message
          expect(err.message).not.toContain(secretContent);
          throw err;
        }
      }).toThrow(LiveOptionError);
    }
  });

  it('rejects a relative or repository-contained user-data override', () => {
    const baseArgv = [
      '--mode=health-only',
      '--headed',
      '--stage=3',
      '--threads=3'
    ];

    // Relative path '.'
    expect(() => parseLiveCapcutOptions([
      ...baseArgv,
      '--user-data-dir=private-relative-path'
    ], {})).toThrow(expect.objectContaining({
      message: expect.not.stringContaining('private-relative-path')
    }));
    expect(() => parseLiveCapcutOptions([...baseArgv, '--user-data-dir=.'], {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions([...baseArgv, '--user-data-dir=./test-data'], {})).toThrow(LiveOptionError);

    // Path inside process.cwd()
    const insideRepoPath = path.resolve(process.cwd(), 'scratch-data');
    expect(() => parseLiveCapcutOptions([...baseArgv, `--user-data-dir=${insideRepoPath}`], {})).toThrow(LiveOptionError);
    const dotDotPrefixInsideRepo = path.resolve(process.cwd(), '..private-data');
    expect(() => parseLiveCapcutOptions([
      ...baseArgv,
      `--user-data-dir=${dotDotPrefixInsideRepo}`
    ], {})).toThrow(expect.objectContaining({
      message: expect.not.stringContaining(dotDotPrefixInsideRepo)
    }));

    // Absolute directory outside repository parses
    const outsidePath = path.resolve(process.cwd(), '../outside-repo-user-data');
    const parsed = parseLiveCapcutOptions([...baseArgv, `--user-data-dir=${outsidePath}`], {});
    expect(parsed.userDataDir).toBe(outsidePath);
  });

  it('uses documented exit codes', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.OPTION_ERROR).toBe(2);
    expect(EXIT_CODES.TIMEOUT).toBe(3);
    expect(EXIT_CODES.EVIDENCE_FAILURE).toBe(4);

    const optErr = new LiveOptionError('invalid option');
    expect(optErr.exitCode).toBe(2);
    expect(resolveExitCode(optErr)).toBe(2);

    const timeoutErr = new LiveTimeoutError('timed out');
    expect(timeoutErr.exitCode).toBe(3);
    expect(resolveExitCode(timeoutErr)).toBe(3);

    const evidenceErr = new LiveEvidenceError('evidence failed');
    expect(evidenceErr.exitCode).toBe(4);
    expect(resolveExitCode(evidenceErr)).toBe(4);

    expect(resolveExitCode(null)).toBe(0);
  });

  it.each(['Infinity', 'NaN', '0', '-1'])(
    'rejects a non-finite or non-positive duration: %s',
    (minutes) => {
      expect(() => parseLiveCapcutOptions([
        '--mode=health-only',
        '--headed',
        '--stage=3',
        '--threads=3',
        `--minutes=${minutes}`
      ], {})).toThrow(LiveOptionError);
    }
  );

  it('does not echo unknown sensitive option values', () => {
    const sentinel = 'secret@example.invalid';
    expect(() => parseLiveCapcutOptions([
      '--mode=health-only',
      '--headed',
      '--stage=3',
      '--threads=3',
      `--unknown=${sentinel}`
    ], {})).toThrow(expect.objectContaining({
      message: expect.not.stringContaining(sentinel)
    }));
  });

  it('preserves the rollout-stage alias without allowing conflicting stage values', () => {
    expect(parseLiveCapcutOptions([
      '--mode=health-only',
      '--headed',
      '--rollout-stage=3',
      '--threads=3'
    ], {})).toMatchObject({ stage: 3 });

    expect(() => parseLiveCapcutOptions([
      '--mode=health-only',
      '--headed',
      '--stage=10',
      '--rollout-stage=3',
      '--threads=3'
    ], {})).toThrow(LiveOptionError);
  });

  it('rejects conflicting or malformed email/provider combinations', () => {
    const base = [
      '--mode=dry-run', '--headed', '--stage=1', '--threads=1',
      '--mail-limit=1', '--approved-mailboxes=1', '--stop-after=1',
      '--max-billable-purchases=1'
    ];
    expect(() => parseLiveCapcutOptions([
      ...base, '--email=api:gmail94', '--provider=dongvanfb'
    ], {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions([
      ...base, '--email=malformed-secret-value', '--provider=gmail94'
    ], {})).toThrow(expect.objectContaining({
      message: expect.not.stringContaining('malformed-secret-value')
    }));
    expect(() => parseLiveCapcutOptions([
      ...base, '--provider=gmail94', '--provider=dongvanfb'
    ], {})).toThrow(LiveOptionError);
    expect(() => parseLiveCapcutOptions([
      ...base, '--email=api:gmail94', '--email=api:dongvanfb'
    ], {})).toThrow(LiveOptionError);
    expect(parseLiveCapcutOptions([
      ...base, '--email=api:gmail94', '--provider=gmail94'
    ], {})).toMatchObject({ provider: 'gmail94' });
  });
});
