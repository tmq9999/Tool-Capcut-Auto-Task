import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  EXIT_CODES,
  LiveEvidenceError,
  LiveTimeoutError,
  isTerminalRunState,
  parseLiveCapcutOptions,
  resolveExitCode
} from './live-capcut-options.mjs';

const ELECTRON = path.resolve('node_modules/electron/dist/electron.exe');
const POLL_MS = 500;
const STOP_SETTLE_MS = 1_000;
const KILL_ATTEMPTS = 2;

function emptyResult(exitCode, runId = null, artifactBasename = null) {
  return { exitCode, runId, artifactBasename };
}

function evidenceMode(mode) {
  if (mode === 'new-accounts') return 'new';
  if (mode === 'health-only') return 'health';
  return mode;
}

function expectedCount(options) {
  return options.mode === 'new-accounts' ? options.caps.stopAfter : options.stage;
}

function normalizeIdentity(value) {
  const runId = value?.runId;
  const artifactBasename = value?.artifactBasename;
  if (
    typeof runId !== 'string' ||
    typeof artifactBasename !== 'string' ||
    artifactBasename !== runId + '.jsonl'
  ) {
    throw new LiveEvidenceError('INVALID_ARTIFACT_IDENTITY');
  }
  return { runId, artifactBasename };
}

function sameResolvedPath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function buildRunConfig(options) {
  const shared = {
    threadCount: options.mode === 'new-accounts' ? options.caps.threads : options.threads,
    rolloutStage: options.stage,
    missionTransport: 'ui',
    browser: 'multilogin',
    headless: false,
    retryCount: 3,
    stepDelayMinMs: 500,
    stepDelayMaxMs: 2000,
    typeDelayMinMs: 50,
    typeDelayMaxMs: 150,
    module: 'credit',
    proxy: { mode: 'proxykey', keys: [] },
    password: {
      mode: 'random',
      length: 12,
      uppercase: true,
      numbers: true,
      special: false
    },
    testDurationMs: 10_000,
    skipWithoutTrial: false
  };

  if (options.mode === 'new-accounts') {
    return {
      ...shared,
      mailLimit: options.caps.mailLimit,
      approvedMailboxes: options.caps.approvedMailboxes,
      stopAfter: options.caps.stopAfter,
      maxBillablePurchases: options.caps.maxBillablePurchases,
      emailSource: { mode: 'api', provider: options.provider }
    };
  }

  return {
    ...shared,
    mailLimit: 0,
    maxBillablePurchases: 0,
    accountIdsFile: options.accountIdsFile
  };
}

/** Build a child-only environment without mutating or authorizing the parent. */
export function createChildEnvironment(options, sourceEnv = process.env, runtime = {}) {
  const childEnv = { ...sourceEnv };
  delete childEnv.VERIFY_GMAIL94_BUY;
  delete childEnv.VERIFY_DONGVANFB_BUY;
  delete childEnv.AUTOMANAGER_ROLLOUT_USER_DATA_DIR;

  if (options.mode === 'new-accounts') {
    const flag = options.provider === 'gmail94'
      ? 'VERIFY_GMAIL94_BUY'
      : 'VERIFY_DONGVANFB_BUY';
    if (sourceEnv[flag] === '1') childEnv[flag] = '1';
  }
  if (options.userDataDir) {
    childEnv.AUTOMANAGER_ROLLOUT_USER_DATA_DIR = options.userDataDir;
  }
  if (runtime.rolloutHandshake) {
    childEnv.AUTOMANAGER_ROLLOUT_HANDSHAKE = runtime.rolloutHandshake;
  } else {
    delete childEnv.AUTOMANAGER_ROLLOUT_HANDSHAKE;
  }
  return childEnv;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (!Number.isInteger(port)) throw new Error('DEBUG_PORT_UNAVAILABLE');
  return port;
}

async function waitForTerminal(options, dependencies) {
  const deadline = dependencies.deadline;

  while (dependencies.now() < deadline) {
    const progress = await withinDeadline(
      () => dependencies.getProgress(),
      deadline,
      dependencies.now
    );
    if (isTerminalRunState(progress?.state)) return;
    await withinDeadline(
      () => dependencies.sleep(Math.min(POLL_MS, Math.max(0, deadline - dependencies.now()))),
      deadline,
      dependencies.now
    );
  }

  throw new LiveTimeoutError('ROLLOUT_TIMEOUT');
}

async function withinDeadline(operation, deadline, now) {
  const remaining = deadline - now();
  if (remaining <= 0) throw new LiveTimeoutError('ROLLOUT_TIMEOUT');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new LiveTimeoutError('ROLLOUT_TIMEOUT')),
          remaining
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestBoundedStop(dependencies) {
  await Promise.race([
    Promise.resolve().then(() => dependencies.stopRun()).catch(() => {}),
    dependencies.sleep(STOP_SETTLE_MS)
  ]);
}

async function releaseChild(child, dependencies) {
  let lastError;
  for (let attempt = 0; attempt < KILL_ATTEMPTS; attempt += 1) {
    try {
      await withinDuration(
        () => dependencies.killChild(child),
        dependencies.cleanupTimeoutMs ?? 5_000,
        'CHILD_CLEANUP_TIMEOUT'
      );
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  void lastError;
  return false;
}

async function withinDuration(operation, durationMs, code) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), durationMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run exactly one parsed rollout stage through injected process boundaries. */
export async function main(options, dependencies) {
  if (options.mode === 'health-only' && options.requireIndependent) {
    return emptyResult(EXIT_CODES.OPTION_ERROR);
  }
  if (options.mode === 'dry-run') {
    dependencies.writeStdout(
      'ROLLOUT_DRY_RUN=' + JSON.stringify({ stage: options.stage }) + '\n'
    );
    return emptyResult(EXIT_CODES.SUCCESS);
  }

  let child = null;
  let identity = null;
  let result;
  let runtimeMayBeActive = false;
  const invocationController = new AbortController();
  const deadline = dependencies.invocationDeadline ??
    dependencies.now() + options.minutes * 60_000;
  const bounded = (operation) => withinDeadline(operation, deadline, dependencies.now);
  try {
    child = await bounded(() => dependencies.spawnElectron({
      signal: invocationController.signal,
      onSpawned: (ownedChild) => {
        child = ownedChild;
      }
    }));
    await bounded(() => dependencies.attachToApp(child, {
      signal: invocationController.signal
    }));
    const userDataDir = await bounded(() => dependencies.resolveAppUserData());
    if (
      typeof userDataDir !== 'string' ||
      (options.userDataDir && !sameResolvedPath(userDataDir, options.userDataDir))
    ) {
      throw new LiveEvidenceError('USER_DATA_MISMATCH');
    }

    if (options.mode === 'health-only') {
      runtimeMayBeActive = true;
      identity = normalizeIdentity(await bounded(() => dependencies.runHealth({
        threadCount: options.threads,
        rolloutStage: options.stage,
        headless: false
      })));
    } else {
      runtimeMayBeActive = true;
      identity = normalizeIdentity(await bounded(
        () => dependencies.startRun(buildRunConfig(options))
      ));
      await waitForTerminal(options, { ...dependencies, deadline });
    }

    await bounded(() => dependencies.readEvidenceByRunId({
      runId: identity.runId,
      userDataDir,
      expected: expectedCount(options),
      stage: options.stage,
      mode: evidenceMode(options.mode),
      ...(options.requireIndependent ? { requireIndependent: true } : {})
    }));
    runtimeMayBeActive = false;
    result = emptyResult(EXIT_CODES.SUCCESS, identity.runId, identity.artifactBasename);
  } catch (error) {
    invocationController.abort();
    result = emptyResult(
      resolveExitCode(error),
      identity?.runId ?? null,
      identity?.artifactBasename ?? null
    );
  } finally {
    invocationController.abort();
    if (runtimeMayBeActive) {
      await requestBoundedStop(dependencies);
      runtimeMayBeActive = false;
    }
    if (child !== null) {
      const released = await releaseChild(child, dependencies);
      if (released) child = null;
      if (!released && result.exitCode === EXIT_CODES.SUCCESS) {
        result = emptyResult(1, identity?.runId ?? null, identity?.artifactBasename ?? null);
      }
    }
  }
  if (result.exitCode === EXIT_CODES.SUCCESS) {
    dependencies.writeStdout(
      'ROLLOUT_RESULT=' + JSON.stringify({
        runId: identity.runId,
        artifact: identity.artifactBasename
      }) + '\n'
    );
  }
  return result;
}

/** Include dynamic dependency loading in the same absolute invocation budget. */
export async function createLiveInvocation(options, factoryDependencies = {}) {
  const now = factoryDependencies.now ?? (() => Date.now());
  const durationMs = factoryDependencies.dependencyTimeoutMs ?? options.minutes * 60_000;
  const invocationDeadline = now() + durationMs;
  try {
    const dependencies = await withinDeadline(
      () => createProductionDependencies(options, factoryDependencies),
      invocationDeadline,
      now
    );
    return await main(options, { ...dependencies, invocationDeadline });
  } catch (error) {
    return emptyResult(resolveExitCode(error));
  }
}

function unwrapData(response, code) {
  if (!response?.success || response.data === undefined || response.data === null) {
    throw new Error(code);
  }
  return response.data;
}

export function parseAccountIdsDocument(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_ACCOUNT_IDS_FILE');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.accountIds) ||
    value.accountIds.length !== 3 ||
    value.accountIds.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value.accountIds).size !== value.accountIds.length
  ) {
    throw new Error('INVALID_ACCOUNT_IDS_FILE');
  }
  return value.accountIds;
}

/** Construct production adapters without invoking any returned side effect. */
export async function createProductionDependencies(options, factoryDependencies = {}) {
  const loadPlaywright = factoryDependencies.loadPlaywright ?? (() => import('playwright-core'));
  const loadValidator = factoryDependencies.loadValidator ?? (() => import('./verify-rollout-evidence.mjs'));
  const spawnProcess = factoryDependencies.spawnProcess ?? spawn;
  const readText = factoryDependencies.readText ?? readFile;
  const reservePort = factoryDependencies.reservePort ?? reserveLoopbackPort;
  const createNonce = factoryDependencies.createNonce ?? (() => randomBytes(32).toString('hex'));
  const teardownTimeoutMs = factoryDependencies.teardownTimeoutMs ?? 5_000;
  const [{ chromium }, validator] = await Promise.all([
    loadPlaywright(),
    loadValidator()
  ]);
  let child = null;
  let browser = null;
  let page = null;
  let resumeAccountIds = null;
  let debuggingPort = null;
  let childExitPromise = null;
  let childSpawnFailed = false;
  let resolvedUserData = null;
  let browserOwned = false;
  const rolloutHandshake = createNonce();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const boundedTeardown = async (operation, code) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(code)), teardownTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    now: () => Date.now(),
    sleep,
    writeStdout: (line) => process.stdout.write(line),
    async spawnElectron(context = {}) {
      const signal = context.signal;
      if (signal?.aborted) throw new Error('ROLLOUT_ABORTED');
      if (options.mode === 'resume') {
        resumeAccountIds = parseAccountIdsDocument(
          await readText(options.accountIdsFile, 'utf8')
        );
      }
      debuggingPort = await reservePort();
      if (signal?.aborted) throw new Error('ROLLOUT_ABORTED');
      child = spawnProcess(ELECTRON, ['.', `--remote-debugging-port=${debuggingPort}`], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: createChildEnvironment(options, process.env, { rolloutHandshake })
      });
      context.onSpawned?.(child);
      const childSpawnPromise = new Promise((resolve, reject) => {
        const onSpawn = () => {
          child.off('error', onInitialError);
          resolve();
        };
        const onInitialError = () => {
          child.off('spawn', onSpawn);
          childSpawnFailed = true;
          reject(new Error('CHILD_SPAWN_FAILED'));
        };
        child.once('spawn', onSpawn);
        child.once('error', onInitialError);
      });
      // Retain a no-op listener after initial acknowledgement so a later
      // process error cannot become an uncaught EventEmitter exception.
      child.on('error', () => {});
      childExitPromise = new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('close', resolve);
      });
      await childSpawnPromise;
      return child;
    },
    async attachToApp(_target, context = {}) {
      const signal = context.signal;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (signal?.aborted) throw new Error('ROLLOUT_ABORTED');
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`, {
            timeout: 3000
          });
          if (signal?.aborted) {
            const abortedBrowser = browser;
            browser = null;
            await boundedTeardown(
              () => abortedBrowser.close(),
              'APP_OWNERSHIP_DISCONNECT_FAILED'
            ).catch(() => {});
            throw new Error('ROLLOUT_ABORTED');
          }
          const pages = browser.contexts().flatMap((context) => context.pages());
          page = pages.find((candidate) => !candidate.url().startsWith('devtools://')) ?? pages[0];
          if (!page) throw new Error('APP_WINDOW_UNAVAILABLE');
          await page.waitForFunction(
            () => Boolean(window.electronAPI?.run?.start && window.electronAPI?.run?.userData),
            null,
            { timeout: 60_000 }
          );
          const response = await page.evaluate(async () => window.electronAPI.run.userData());
          const data = unwrapData(response, 'USER_DATA_UNAVAILABLE');
          if (
            typeof data.userDataDir !== 'string' ||
            data.rolloutHandshake !== rolloutHandshake
          ) {
            const mismatchedBrowser = browser;
            browser = null;
            page = null;
            await boundedTeardown(
              () => mismatchedBrowser.close(),
              'APP_OWNERSHIP_DISCONNECT_FAILED'
            ).catch(() => {});
            throw new Error('APP_OWNERSHIP_MISMATCH');
          }
          resolvedUserData = data.userDataDir;
          browserOwned = true;
          return;
        } catch (error) {
          if (
            error?.message === 'APP_OWNERSHIP_MISMATCH' ||
            error?.message === 'ROLLOUT_ABORTED'
          ) throw error;
          if (attempt === 39) throw new Error('APP_ATTACH_FAILED', { cause: error });
          await sleep(1000);
        }
      }
    },
    async resolveAppUserData() {
      if (resolvedUserData === null) throw new Error('USER_DATA_UNAVAILABLE');
      return resolvedUserData;
    },
    async runHealth(input) {
      const response = await page.evaluate(
        async (request) => window.electronAPI.run.health(request),
        input
      );
      return unwrapData(response, 'HEALTH_FAILED');
    },
    async startRun(config) {
      let ipcConfig = config;
      if (options.mode === 'resume') {
        if (resumeAccountIds === null) throw new Error('INVALID_ACCOUNT_IDS_FILE');
        const { accountIdsFile: _accountIdsFile, ...rest } = config;
        ipcConfig = { ...rest, emailSource: { mode: 'existing', accountIds: resumeAccountIds } };
      }
      const response = await page.evaluate(
        async (request) => window.electronAPI.run.start(request),
        ipcConfig
      );
      const data = unwrapData(response, 'RUN_START_FAILED');
      return { runId: data.runId, artifactBasename: data.artifactBasename };
    },
    async getProgress() {
      const response = await page.evaluate(async () => window.electronAPI.run.progress());
      return unwrapData(response, 'RUN_PROGRESS_FAILED');
    },
    async stopRun() {
      const response = await page.evaluate(async () => window.electronAPI.run.stop());
      if (!response?.success) throw new Error('RUN_STOP_FAILED');
    },
    async readEvidenceByRunId(input) {
      await validator.validateRolloutEvidenceFile(input);
    },
    async killChild(target = child) {
      if (childSpawnFailed) return;
      let closeError = null;
      let closeSettled = !browserOwned || !browser;
      if (browserOwned && browser) {
        try {
          await boundedTeardown(() => browser.close(), 'BROWSER_CLOSE_UNCONFIRMED');
          browser = null;
          page = null;
          browserOwned = false;
          closeSettled = true;
        } catch (error) {
          closeError = error;
        }
      }
      if (target?.exitCode === null || target?.exitCode === undefined) {
        if (typeof target?.kill !== 'function' || target.kill() !== true) {
          throw new Error('CHILD_KILL_REJECTED');
        }
      }
      if (
        childExitPromise &&
        (target?.exitCode === null || target?.exitCode === undefined)
      ) {
        await boundedTeardown(() => childExitPromise, 'CHILD_EXIT_UNCONFIRMED');
      }
      if (!closeSettled && target?.exitCode !== null && target?.exitCode !== undefined) {
        browser = null;
        page = null;
        browserOwned = false;
        closeError = null;
      }
      if (closeError) throw closeError;
    }
  };
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const options = parseLiveCapcutOptions(process.argv.slice(2), process.env);
    if (options.mode === 'dry-run') {
      process.stdout.write(
        'ROLLOUT_DRY_RUN=' + JSON.stringify({ stage: options.stage }) + '\n'
      );
      process.exitCode = EXIT_CODES.SUCCESS;
    } else {
      process.exitCode = (await createLiveInvocation(options)).exitCode;
    }
  } catch (error) {
    process.stderr.write('ROLLOUT_ERROR\n');
    process.exitCode = resolveExitCode(error);
  }
}
