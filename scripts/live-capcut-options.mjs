import path from 'node:path';
import process from 'node:process';

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  OPTION_ERROR: 2,
  TIMEOUT: 3,
  EVIDENCE_FAILURE: 4
});

export class LiveOptionError extends Error {
  constructor(message, exitCode = EXIT_CODES.OPTION_ERROR) {
    super(message);
    this.name = 'LiveOptionError';
    this.exitCode = exitCode;
  }
}

export class LiveTimeoutError extends Error {
  constructor(message, exitCode = EXIT_CODES.TIMEOUT) {
    super(message);
    this.name = 'LiveTimeoutError';
    this.exitCode = exitCode;
  }
}

export class LiveEvidenceError extends Error {
  constructor(message, exitCode = EXIT_CODES.EVIDENCE_FAILURE) {
    super(message);
    this.name = 'LiveEvidenceError';
    this.exitCode = exitCode;
  }
}

export function resolveExitCode(err) {
  if (!err) return EXIT_CODES.SUCCESS;
  if (err instanceof LiveOptionError || err.exitCode === EXIT_CODES.OPTION_ERROR) {
    return EXIT_CODES.OPTION_ERROR;
  }
  if (err instanceof LiveTimeoutError || err.exitCode === EXIT_CODES.TIMEOUT) {
    return EXIT_CODES.TIMEOUT;
  }
  if (err instanceof LiveEvidenceError || err.exitCode === EXIT_CODES.EVIDENCE_FAILURE) {
    return EXIT_CODES.EVIDENCE_FAILURE;
  }
  return 1;
}

export function assertBillableEmailAllowed(source, env) {
  if (source.mode !== 'api') return;
  const flag = source.provider === 'gmail94'
    ? 'VERIFY_GMAIL94_BUY'
    : 'VERIFY_DONGVANFB_BUY';
  if (env[flag] !== '1') {
    throw new Error(
      'Nguồn ' + source.provider + ' có trả phí; chỉ được chạy khi đã có phê duyệt và ' +
      flag + '=1.'
    );
  }
}

export function terminalAccountCount(progress) {
  return Number(progress?.accountsCompleted ?? 0) +
    Number(progress?.accountsFailed ?? 0) +
    Number(progress?.accountsStopped ?? 0);
}

export function isTerminalRunState(state) {
  return state === 'completed' || state === 'stopped' ||
    state === 'blocked' || state === 'failed';
}

export function parseHeadlessFlag(argv) {
  return argv.includes('--headless');
}

/** @typedef {1 | 3 | 5 | 10} RolloutStage */
/** @typedef {{ threads: number, mailLimit: number, approvedMailboxes: number, stopAfter: number, maxBillablePurchases: number }} EqualCaps */
/** @typedef {{ requireIndependent?: true }} IndependenceOption */
/** @typedef {{ mode: 'dry-run', stage: RolloutStage, headed: true, provider: 'gmail94' | 'dongvanfb', minutes: number, caps: EqualCaps } & IndependenceOption} DryRunOptions */
/** @typedef {{ mode: 'health-only', stage: 3 | 10, headed: true, threads: number, minutes: number, userDataDir?: string }} HealthOptions */
/** @typedef {{ mode: 'new-accounts', stage: RolloutStage, headed: true, provider: 'gmail94' | 'dongvanfb', minutes: number, caps: EqualCaps, userDataDir?: string } & IndependenceOption} NewAccountOptions */
/** @typedef {{ mode: 'resume', stage: 3, headed: true, accountIdsFile: string, threads: 3, minutes: number, userDataDir?: string } & IndependenceOption} ResumeOptions */
/** @typedef {DryRunOptions | HealthOptions | NewAccountOptions | ResumeOptions} LiveCapcutOptions */

function parseKnownFlags(argv) {
  const flags = {
    headed: false,
    headless: false,
    mode: null,
    stage: null,
    threads: null,
    mailLimit: null,
    approvedMailboxes: null,
    stopAfter: null,
    maxBillablePurchases: null,
    email: null,
    provider: null,
    minutes: 45,
    userDataDir: null,
    accountIdsFile: null,
    missionTransport: 'ui',
    requireIndependent: false
  };

  const rawModes = [];

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new LiveOptionError('Unexpected positional argument.');
    }

    if (arg === '--headed') {
      flags.headed = true;
    } else if (arg === '--headless') {
      flags.headless = true;
    } else if (arg === '--require-independent') {
      if (flags.requireIndependent) {
        throw new LiveOptionError('Independence option may be specified only once.');
      }
      flags.requireIndependent = true;
    } else if (arg === '--dry-run') {
      rawModes.push('dry-run');
    } else if (arg === '--health-only') {
      rawModes.push('health-only');
    } else if (arg === '--new-accounts') {
      rawModes.push('new-accounts');
    } else if (arg === '--resume') {
      rawModes.push('resume');
    } else if (arg.startsWith('--mode=')) {
      const modeVal = arg.slice('--mode='.length).trim();
      rawModes.push(modeVal);
    } else if (arg.startsWith('--stage=')) {
      if (flags.stage !== null) {
        throw new LiveOptionError('Stage option may be specified only once.');
      }
      flags.stage = Number(arg.slice('--stage='.length));
    } else if (arg.startsWith('--rollout-stage=')) {
      if (flags.stage !== null) {
        throw new LiveOptionError('Stage option may be specified only once.');
      }
      flags.stage = Number(arg.slice('--rollout-stage='.length));
    } else if (arg.startsWith('--threads=')) {
      flags.threads = Number(arg.slice('--threads='.length));
    } else if (arg.startsWith('--mail-limit=')) {
      flags.mailLimit = Number(arg.slice('--mail-limit='.length));
    } else if (arg.startsWith('--approved-mailboxes=')) {
      flags.approvedMailboxes = Number(arg.slice('--approved-mailboxes='.length));
    } else if (arg.startsWith('--stop-after=')) {
      flags.stopAfter = Number(arg.slice('--stop-after='.length));
    } else if (arg.startsWith('--max-billable-purchases=')) {
      flags.maxBillablePurchases = Number(arg.slice('--max-billable-purchases='.length));
    } else if (arg.startsWith('--email=')) {
      if (flags.email !== null) {
        throw new LiveOptionError('Email option may be specified only once.');
      }
      flags.email = arg.slice('--email='.length).trim();
    } else if (arg.startsWith('--provider=')) {
      if (flags.provider !== null) {
        throw new LiveOptionError('Provider option may be specified only once.');
      }
      flags.provider = arg.slice('--provider='.length).trim();
    } else if (arg.startsWith('--minutes=')) {
      flags.minutes = Number(arg.slice('--minutes='.length));
    } else if (arg.startsWith('--user-data-dir=')) {
      flags.userDataDir = arg.slice('--user-data-dir='.length).trim();
    } else if (arg.startsWith('--account-ids-file=')) {
      flags.accountIdsFile = arg.slice('--account-ids-file='.length).trim();
    } else if (arg.startsWith('--mission-transport=')) {
      flags.missionTransport = arg.slice('--mission-transport='.length).trim();
    } else {
      const optionName = arg.split('=', 1)[0];
      throw new LiveOptionError(`Unknown option: "${optionName}"`);
    }
  }

  if (rawModes.length > 1) {
    const unique = [...new Set(rawModes)];
    if (unique.length > 1) {
      throw new LiveOptionError(`Conflicting modes specified: ${unique.join(', ')}`);
    }
    flags.mode = unique[0];
  } else if (rawModes.length === 1) {
    flags.mode = rawModes[0];
  }

  return flags;
}

function validateSelectedMode(flags, env) {
  if (flags.headless) {
    throw new LiveOptionError('Headless mode is rejected. Rollout requires explicit --headed.');
  }
  if (!flags.headed) {
    throw new LiveOptionError('Rollout requires explicit --headed mode.');
  }

  if (flags.missionTransport !== 'ui') {
    throw new LiveOptionError(`Mission transport must be "ui", got "${flags.missionTransport}".`);
  }

  if (!Number.isFinite(flags.minutes) || flags.minutes <= 0) {
    throw new LiveOptionError('Minutes must be a finite number greater than zero.');
  }

  if (flags.userDataDir) {
    if (!path.isAbsolute(flags.userDataDir) || flags.userDataDir.startsWith('.')) {
      throw new LiveOptionError('User data dir must be an absolute path.');
    }
    const repoRoot = path.resolve(process.cwd());
    const resolvedUserData = path.resolve(flags.userDataDir);
    const rel = path.relative(repoRoot, resolvedUserData);
    const isOutsideRepo = rel === '..' || rel.startsWith('..' + path.sep);
    if (!isOutsideRepo && !path.isAbsolute(rel)) {
      throw new LiveOptionError('User data dir cannot be inside repository.');
    }
  }

  if (!flags.mode) {
    throw new LiveOptionError('Mode must be explicitly specified (dry-run, health-only, new-accounts, or resume).');
  }

  const validModes = ['dry-run', 'health-only', 'new-accounts', 'resume'];
  if (!validModes.includes(flags.mode)) {
    throw new LiveOptionError(`Invalid mode: "${flags.mode}". Expected one of: ${validModes.join(', ')}`);
  }

  // Health-only mode
  if (flags.mode === 'health-only') {
    if (flags.requireIndependent) {
      throw new LiveOptionError('INDEPENDENT_HEALTH_UNSUPPORTED');
    }
    if (
      flags.email !== null ||
      flags.provider !== null ||
      flags.mailLimit !== null ||
      flags.approvedMailboxes !== null ||
      flags.stopAfter !== null ||
      flags.maxBillablePurchases !== null ||
      flags.accountIdsFile !== null
    ) {
      throw new LiveOptionError('health-only rejects account, email, approval, and purchase options.');
    }

    if (flags.stage !== 3 && flags.stage !== 10) {
      throw new LiveOptionError(`health-only requires stage 3 or 10, got ${flags.stage}`);
    }

    if (flags.threads !== flags.stage) {
      throw new LiveOptionError(`health-only requires threads (${flags.threads}) to equal stage (${flags.stage}).`);
    }

    return {
      mode: 'health-only',
      stage: flags.stage,
      headed: true,
      threads: flags.threads,
      minutes: flags.minutes,
      ...(flags.userDataDir ? { userDataDir: flags.userDataDir } : {})
    };
  }

  // Resume mode
  if (flags.mode === 'resume') {
    if (
      flags.email !== null ||
      flags.provider !== null ||
      flags.mailLimit !== null ||
      flags.approvedMailboxes !== null ||
      flags.maxBillablePurchases !== null
    ) {
      throw new LiveOptionError('resume mode rejects email and billable purchase options.');
    }

    if (!flags.accountIdsFile) {
      throw new LiveOptionError('resume mode requires --account-ids-file.');
    }

    if (flags.stage !== 3 || flags.threads !== 3) {
      throw new LiveOptionError(`resume mode requires stage 3 and threads 3, got stage=${flags.stage}, threads=${flags.threads}`);
    }

    return {
      mode: 'resume',
      stage: 3,
      headed: true,
      accountIdsFile: flags.accountIdsFile,
      threads: 3,
      minutes: flags.minutes,
      ...(flags.requireIndependent ? { requireIndependent: true } : {}),
      ...(flags.userDataDir ? { userDataDir: flags.userDataDir } : {})
    };
  }

  // New-accounts or dry-run mode
  const allowedStages = [1, 3, 5, 10];
  if (!allowedStages.includes(flags.stage)) {
    throw new LiveOptionError(`Rollout stage must be 1, 3, 5, or 10, got ${flags.stage}`);
  }

  if (flags.accountIdsFile !== null) {
    throw new LiveOptionError(`${flags.mode} does not accept --account-ids-file.`);
  }

  let emailProvider = null;
  if (flags.email !== null) {
    const match = /^api:(gmail94|dongvanfb)$/.exec(flags.email);
    if (!match) {
      throw new LiveOptionError('Email source must name a supported API provider.');
    }
    emailProvider = match[1];
  }
  if (flags.provider !== null && emailProvider !== null && flags.provider !== emailProvider) {
    throw new LiveOptionError('Email source and provider must agree.');
  }
  const resolvedProvider = flags.provider ?? emailProvider;

  if (resolvedProvider !== 'gmail94' && resolvedProvider !== 'dongvanfb') {
    throw new LiveOptionError(
      'Provider must be gmail94 or dongvanfb.'
    );
  }

  const requiredCaps = {
    threads: flags.threads,
    mailLimit: flags.mailLimit,
    approvedMailboxes: flags.approvedMailboxes,
    stopAfter: flags.stopAfter,
    maxBillablePurchases: flags.maxBillablePurchases
  };

  for (const [key, value] of Object.entries(requiredCaps)) {
    if (!Number.isInteger(value) || value !== flags.stage) {
      throw new LiveOptionError(
        `Cap ${key} must equal rollout stage ${flags.stage}, got ${value}`
      );
    }
  }

  if (flags.mode === 'new-accounts') {
    const requiredFlag = resolvedProvider === 'gmail94'
      ? 'VERIFY_GMAIL94_BUY'
      : 'VERIFY_DONGVANFB_BUY';
    if (env[requiredFlag] !== '1') {
      throw new LiveOptionError(
        `Nguồn ${resolvedProvider} có trả phí; chỉ được chạy khi đã có phê duyệt và ${requiredFlag}=1.`
      );
    }

    return {
      mode: 'new-accounts',
      stage: flags.stage,
      headed: true,
      provider: resolvedProvider,
      minutes: flags.minutes,
      caps: requiredCaps,
      ...(flags.requireIndependent ? { requireIndependent: true } : {}),
      ...(flags.userDataDir ? { userDataDir: flags.userDataDir } : {})
    };
  }

  // mode === 'dry-run'
  return {
    mode: 'dry-run',
    stage: flags.stage,
    headed: true,
    provider: resolvedProvider,
    minutes: flags.minutes,
    caps: requiredCaps,
    ...(flags.requireIndependent ? { requireIndependent: true } : {})
  };
}

/**
 * Parses only the documented flags, validates the selected discriminant and
 * returns one frozen option object. Throws `LiveOptionError` before any I/O.
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {LiveCapcutOptions}
 */
export function parseLiveCapcutOptions(argv, env = process.env) {
  const parsed = parseKnownFlags(argv);
  return Object.freeze(validateSelectedMode(parsed, env));
}
