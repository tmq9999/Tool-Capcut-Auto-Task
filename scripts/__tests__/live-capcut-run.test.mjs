import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createChildEnvironment,
  createLiveInvocation,
  createProductionDependencies,
  parseAccountIdsDocument,
  main
} from '../live-capcut-run.mjs';
import {
  LiveEvidenceError,
  EXIT_CODES
} from '../live-capcut-options.mjs';

const execFileAsync = promisify(execFile);
const RUN_ID = 'run-controller-a';
const ARTIFACT = RUN_ID + '.jsonl';

function newOptions(stage = 3) {
  return {
    mode: 'new-accounts',
    stage,
    headed: true,
    provider: 'gmail94',
    minutes: 1,
    caps: {
      threads: stage,
      mailLimit: stage,
      approvedMailboxes: stage,
      stopAfter: stage,
      maxBillablePurchases: stage
    }
  };
}

function healthOptions(stage = 3) {
  return {
    mode: 'health-only',
    stage,
    headed: true,
    threads: stage,
    minutes: 1
  };
}

function resumeOptions() {
  return {
    mode: 'resume',
    stage: 3,
    headed: true,
    threads: 3,
    minutes: 1,
    accountIdsFile: 'D:\\private\\accounts.json'
  };
}

function fakeDependencies(overrides = {}) {
  const order = [];
  let nowMs = 0;
  return {
    calls: order,
    spawnElectron: vi.fn(async () => {
      order.push('spawn');
      return { fakeChild: true };
    }),
    attachToApp: vi.fn(async () => {
      order.push('attach');
    }),
    resolveAppUserData: vi.fn(async () => 'D:\\rollout-user-data'),
    runHealth: vi.fn(async () => ({
      runId: RUN_ID,
      artifactBasename: ARTIFACT,
      attempted: 3,
      healthy: 3,
      stopped: 3,
      cleanupFailures: 0
    })),
    startRun: vi.fn(async () => ({ runId: RUN_ID, artifactBasename: ARTIFACT })),
    getProgress: vi.fn(async () => ({
      state: 'completed',
      accountsCompleted: 3,
      accountsFailed: 0,
      accountsStopped: 0
    })),
    stopRun: vi.fn(async () => {
      order.push('stop');
    }),
    readEvidenceByRunId: vi.fn(async () => {}),
    killChild: vi.fn(async () => {
      order.push('kill');
    }),
    writeStdout: vi.fn((line) => {
      order.push(['stdout', line]);
    }),
    now: vi.fn(() => nowMs),
    sleep: vi.fn(async (ms) => {
      nowMs += ms;
    }),
    cleanupTimeoutMs: 20,
    ...overrides
  };
}

describe('live rollout controller fake boundary', () => {
  it('can be imported without executing the CLI', async () => {
    const script = path.resolve('scripts/live-capcut-run.mjs');
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(script).href)})`
    ], { cwd: process.cwd(), env: { ...process.env } });

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('returns a null dry-run identity with zero side effects', async () => {
    const deps = fakeDependencies();
    const result = await main({ ...newOptions(1), mode: 'dry-run' }, deps);

    expect(result).toEqual({ exitCode: 0, runId: null, artifactBasename: null });
    for (const name of [
      'spawnElectron', 'attachToApp', 'resolveAppUserData', 'runHealth',
      'startRun', 'getProgress', 'stopRun', 'readEvidenceByRunId', 'killChild'
    ]) {
      expect(deps[name]).not.toHaveBeenCalled();
    }
    expect(deps.writeStdout).toHaveBeenCalledOnce();
    expect(deps.writeStdout).toHaveBeenCalledWith('ROLLOUT_DRY_RUN={"stage":1}\n');
  });

  it('health-only returns and validates its exact artifact without run.start', async () => {
    const deps = fakeDependencies();
    const result = await main(healthOptions(3), deps);

    expect(result).toEqual({ exitCode: 0, runId: RUN_ID, artifactBasename: ARTIFACT });
    expect(deps.runHealth).toHaveBeenCalledOnce();
    expect(deps.runHealth).toHaveBeenCalledWith({
      threadCount: 3,
      rolloutStage: 3,
      headless: false
    });
    expect(deps.startRun).not.toHaveBeenCalled();
    expect(deps.getProgress).not.toHaveBeenCalled();
    expect(deps.readEvidenceByRunId).toHaveBeenCalledWith({
      runId: RUN_ID,
      userDataDir: 'D:\\rollout-user-data',
      expected: 3,
      stage: 3,
      mode: 'health'
    });
    expect(deps.writeStdout).toHaveBeenCalledWith(
      'ROLLOUT_RESULT={"runId":"run-controller-a","artifact":"run-controller-a.jsonl"}\n'
    );
    const resultIndex = deps.calls.findIndex((entry) => Array.isArray(entry));
    expect(deps.calls.indexOf('kill')).toBeLessThan(resultIndex);
  });

  it('rejects independent health mode before any runner I/O', async () => {
    const deps = fakeDependencies();

    const result = await main({ ...healthOptions(3), requireIndependent: true }, deps);

    expect(result).toEqual({ exitCode: 2, runId: null, artifactBasename: null });
    for (const name of [
      'spawnElectron', 'attachToApp', 'resolveAppUserData', 'runHealth',
      'startRun', 'getProgress', 'stopRun', 'readEvidenceByRunId', 'killChild'
    ]) {
      expect(deps[name]).not.toHaveBeenCalled();
    }
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('new-account mode sends every exact cap to run.start', async () => {
    const deps = fakeDependencies();
    await main(newOptions(3), deps);

    expect(deps.startRun).toHaveBeenCalledOnce();
    expect(deps.startRun).toHaveBeenCalledWith(expect.objectContaining({
      threadCount: 3,
      rolloutStage: 3,
      missionTransport: 'ui',
      headless: false,
      mailLimit: 3,
      approvedMailboxes: 3,
      stopAfter: 3,
      maxBillablePurchases: 3,
      emailSource: { mode: 'api', provider: 'gmail94' }
    }));
  });

  it('forwards the independence assertion only to evidence validation', async () => {
    const deps = fakeDependencies();
    await main({ ...newOptions(3), requireIndependent: true }, deps);

    expect(deps.readEvidenceByRunId).toHaveBeenCalledWith({
      runId: RUN_ID,
      userDataDir: 'D:\\rollout-user-data',
      expected: 3,
      stage: 3,
      mode: 'new',
      requireIndependent: true
    });
    expect(deps.startRun.mock.calls[0][0]).not.toHaveProperty('requireIndependent');
    expect(deps.startRun.mock.calls[0][0]).not.toHaveProperty('uiScope');
  });

  it('resume sends no paid caps and leaves account file handling inside its adapter', async () => {
    const deps = fakeDependencies();
    await main(resumeOptions(), deps);

    expect(deps.startRun).toHaveBeenCalledWith(expect.objectContaining({
      threadCount: 3,
      rolloutStage: 3,
      missionTransport: 'ui',
      headless: false,
      mailLimit: 0,
      maxBillablePurchases: 0,
      accountIdsFile: 'D:\\private\\accounts.json'
    }));
    expect(deps.startRun.mock.calls[0][0]).not.toHaveProperty('approvedMailboxes');
    expect(deps.startRun.mock.calls[0][0]).not.toHaveProperty('stopAfter');
  });

  it('producer and validator resolve the same user-data directory', async () => {
    const exactDir = 'E:\\isolated-rollout-data';
    const deps = fakeDependencies({
      resolveAppUserData: vi.fn(async () => exactDir)
    });
    await main(newOptions(3), deps);

    expect(deps.readEvidenceByRunId).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      userDataDir: exactDir
    }));
    expect(deps.writeStdout.mock.calls.flat().join('')).not.toContain(exactDir);
  });

  it('validates only the run id returned by this invocation', async () => {
    const deps = fakeDependencies({
      readEvidenceByRunId: vi.fn(async ({ runId }) => {
        expect(runId).toBe(RUN_ID);
        throw new LiveEvidenceError('invalid exact artifact');
      })
    });
    const result = await main(newOptions(3), deps);

    expect(result).toEqual({ exitCode: 4, runId: RUN_ID, artifactBasename: ARTIFACT });
    expect(deps.readEvidenceByRunId).toHaveBeenCalledOnce();
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('does not advance to another rollout stage', async () => {
    const deps = fakeDependencies();
    await main(newOptions(1), deps);

    expect(deps.startRun).toHaveBeenCalledOnce();
    expect(deps.startRun.mock.calls[0][0].rolloutStage).toBe(1);
  });

  it('lets the run-owned stopAfter cap reach its terminal state without client Stop', async () => {
    const deps = fakeDependencies({
      getProgress: vi.fn()
        .mockResolvedValueOnce({
          state: 'running', accountsCompleted: 1, accountsFailed: 0, accountsStopped: 0
        })
        .mockResolvedValueOnce({
          state: 'completed', accountsCompleted: 1, accountsFailed: 0, accountsStopped: 0
        })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(0);
    expect(deps.stopRun).not.toHaveBeenCalled();
  });

  it('terminates Electron and requests Stop before kill when the deadline expires', async () => {
    const deps = fakeDependencies({
      getProgress: vi.fn(async () => ({
        state: 'running',
        accountsCompleted: 0,
        accountsFailed: 0,
        accountsStopped: 0
      }))
    });
    const result = await main({ ...newOptions(1), minutes: 0.0001 }, deps);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(deps.killChild).toHaveBeenCalledOnce();
    expect(deps.calls.indexOf('stop')).toBeLessThan(deps.calls.indexOf('kill'));
    expect(deps.readEvidenceByRunId).not.toHaveBeenCalled();
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('keeps timeout exit code when the best-effort Stop request fails', async () => {
    const deps = fakeDependencies({
      getProgress: vi.fn(async () => ({
        state: 'running', accountsCompleted: 0, accountsFailed: 0, accountsStopped: 0
      })),
      stopRun: vi.fn(async () => {
        throw new Error('STOP_FAILED');
      })
    });
    const result = await main({ ...newOptions(1), minutes: 0.0001 }, deps);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(deps.killChild).toHaveBeenCalledOnce();
  });

  it('requests bounded Stop before kill when start acknowledgement is ambiguous', async () => {
    const order = [];
    const deps = fakeDependencies({
      startRun: vi.fn(async () => {
        throw new Error('AMBIGUOUS_START_ACK');
      }),
      stopRun: vi.fn(async () => {
        order.push('stop');
      }),
      killChild: vi.fn(async () => {
        order.push('kill');
      })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(1);
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(order).toEqual(['stop', 'kill']);
  });

  it('requests bounded Stop before kill when progress polling fails', async () => {
    const order = [];
    const deps = fakeDependencies({
      getProgress: vi.fn(async () => {
        throw new Error('PROGRESS_FAILED');
      }),
      stopRun: vi.fn(async () => {
        order.push('stop');
      }),
      killChild: vi.fn(async () => {
        order.push('kill');
      })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(1);
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(order).toEqual(['stop', 'kill']);
  });

  it('bounds an unresolved Stop request and still kills the child', async () => {
    const order = [];
    const deps = fakeDependencies({
      startRun: vi.fn(async () => {
        throw new Error('AMBIGUOUS_START_ACK');
      }),
      stopRun: vi.fn(() => {
        order.push('stop');
        return new Promise(() => {});
      }),
      killChild: vi.fn(async () => {
        order.push('kill');
      })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(1);
    expect(order).toEqual(['stop', 'kill']);
  });

  it('retains child ownership and retries cleanup after a transient kill failure', async () => {
    const deps = fakeDependencies({
      killChild: vi.fn()
        .mockRejectedValueOnce(new Error('TRANSIENT_KILL_FAILURE'))
        .mockResolvedValueOnce(undefined)
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(0);
    expect(deps.killChild).toHaveBeenCalledTimes(2);
    expect(deps.killChild.mock.calls[0][0]).toBe(deps.killChild.mock.calls[1][0]);
    expect(deps.writeStdout).toHaveBeenCalledOnce();
  });

  it('turns success into cleanup failure when child ownership cannot be released', async () => {
    const deps = fakeDependencies({
      killChild: vi.fn(async () => {
        throw new Error('PERSISTENT_KILL_FAILURE');
      })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(1);
    expect(deps.killChild).toHaveBeenCalledTimes(2);
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it.each([
    ['attach', 'attachToApp', false],
    ['start acknowledgement', 'startRun', true],
    ['progress', 'getProgress', true],
    ['evidence', 'readEvidenceByRunId', true]
  ])('bounds a hanging %s phase across the whole invocation', async (_label, method, shouldStop) => {
    const deps = fakeDependencies({
      [method]: vi.fn(() => new Promise(() => {}))
    });
    const result = await main({ ...newOptions(1), minutes: 0.0001 }, deps);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(deps.stopRun).toHaveBeenCalledTimes(shouldStop ? 1 : 0);
    expect(deps.killChild).toHaveBeenCalledOnce();
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('bounds a hanging health IPC across the whole invocation', async () => {
    const deps = fakeDependencies({
      runHealth: vi.fn(() => new Promise(() => {}))
    });
    const result = await main({ ...healthOptions(3), minutes: 0.0001 }, deps);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(deps.stopRun).toHaveBeenCalledOnce();
    expect(deps.killChild).toHaveBeenCalledOnce();
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('kills the child after an attach failure without attempting IPC', async () => {
    const deps = fakeDependencies({
      attachToApp: vi.fn(async () => {
        throw new Error('ATTACH_FAILED');
      })
    });
    const result = await main(newOptions(1), deps);

    expect(result.exitCode).toBe(1);
    expect(deps.killChild).toHaveBeenCalledOnce();
    expect(deps.resolveAppUserData).not.toHaveBeenCalled();
    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it('limits provider opt-in and userData to the selected child without mutating parent env', () => {
    const parentEnv = {
      SAFE_PARENT: 'kept',
      VERIFY_GMAIL94_BUY: '1',
      VERIFY_DONGVANFB_BUY: '1',
      AUTOMANAGER_ROLLOUT_USER_DATA_DIR: 'C:\\stale'
    };
    const before = { ...parentEnv };
    const childEnv = createChildEnvironment({
      ...newOptions(1),
      userDataDir: 'D:\\isolated'
    }, parentEnv);

    expect(childEnv).toEqual({
      SAFE_PARENT: 'kept',
      VERIFY_GMAIL94_BUY: '1',
      AUTOMANAGER_ROLLOUT_USER_DATA_DIR: 'D:\\isolated'
    });
    expect(parentEnv).toEqual(before);
  });

  it('runs all four canonical dry-run stages without constructing production dependencies', async () => {
    const script = path.resolve('scripts/live-capcut-run.mjs');
    for (const stage of [1, 3, 5, 10]) {
      const args = [
        '--import', 'tsx', script,
        '--mode=dry-run', '--headed', `--stage=${stage}`,
        '--email=api:gmail94', `--threads=${stage}`, `--mail-limit=${stage}`,
        `--approved-mailboxes=${stage}`, `--stop-after=${stage}`,
        `--max-billable-purchases=${stage}`
      ];
      const result = await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        env: { ...process.env, VERIFY_GMAIL94_BUY: '' }
      });
      expect(result.stdout).toBe(`ROLLOUT_DRY_RUN={"stage":${stage}}\n`);
      expect(result.stderr).toBe('');
    }
  });

  it('sanitizes invalid CLI output before dependency construction', async () => {
    const script = path.resolve('scripts/live-capcut-run.mjs');
    const sentinel = 'secret@example.invalid';
    await expect(execFileAsync(process.execPath, [
      '--import', 'tsx', script,
      '--mode=health-only', '--headed', '--stage=3', '--threads=3',
      `--unknown=${sentinel}`
    ], { cwd: process.cwd(), env: { ...process.env } })).rejects.toMatchObject({
      code: 2,
      stdout: '',
      stderr: 'ROLLOUT_ERROR\n'
    });
  });

  it('validates resume account IDs without exposing their values', () => {
    const secretId = 'private-account-id';
    expect(() => parseAccountIdsDocument(JSON.stringify({
      accountIds: [secretId, secretId, 'third-id']
    }))).toThrow(expect.objectContaining({
      message: expect.not.stringContaining(secretId)
    }));
  });

  it('constructs production dependencies without launching or invoking IPC', async () => {
    const spawnProcess = vi.fn();
    const connectOverCDP = vi.fn();
    const validator = { validateRolloutEvidenceFile: vi.fn() };
    const dependencies = await createProductionDependencies(newOptions(1), {
      spawnProcess,
      loadPlaywright: async () => ({ chromium: { connectOverCDP } }),
      loadValidator: async () => validator
    });

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(connectOverCDP).not.toHaveBeenCalled();
    expect(validator.validateRolloutEvidenceFile).not.toHaveBeenCalled();
    expect(Object.keys(dependencies)).toEqual(expect.arrayContaining([
      'spawnElectron', 'attachToApp', 'resolveAppUserData', 'runHealth',
      'startRun', 'getProgress', 'stopRun', 'readEvidenceByRunId', 'killChild'
    ]));
  });

  it('validates resume account IDs before spawning Electron', async () => {
    const spawnProcess = vi.fn();
    const dependencies = await createProductionDependencies(resumeOptions(), {
      spawnProcess,
      readText: vi.fn(async () => JSON.stringify({ accountIds: ['only-one'] })),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() })
    });

    await expect(dependencies.spawnElectron()).rejects.toThrow('INVALID_ACCOUNT_IDS_FILE');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('uses a unique reserved port and child-only ownership nonce', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      child.emit('exit', 0);
      return true;
    });
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const nonce = 'a'.repeat(32);
    const dependencies = await createProductionDependencies(newOptions(1), {
      spawnProcess,
      reservePort: vi.fn(async () => 19456),
      createNonce: vi.fn(() => nonce),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 20
    });

    await dependencies.spawnElectron();
    const [executable, args, spawnOptions] = spawnProcess.mock.calls[0];
    expect(executable).toMatch(/electron\.exe$/);
    expect(args).toContain('--remote-debugging-port=19456');
    expect(args).not.toContain('--remote-debugging-port=9333');
    expect(spawnOptions.env.AUTOMANAGER_ROLLOUT_HANDSHAKE).toBe(nonce);
  });

  it('requires the exact child handshake before accepting attached IPC', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    const close = vi.fn(async () => {});
    const page = {
      url: () => 'app://renderer',
      waitForFunction: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        success: true,
        data: { userDataDir: 'D:\\isolated', rolloutHandshake: 'b'.repeat(32) }
      }))
    };
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => [{ pages: () => [page] }],
      close
    }));
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort: vi.fn(async () => 19457),
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
      loadPlaywright: async () => ({ chromium: { connectOverCDP } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 20
    });
    await dependencies.spawnElectron();

    await expect(dependencies.attachToApp()).rejects.toThrow('APP_OWNERSHIP_MISMATCH');
    expect(close).toHaveBeenCalledOnce();
  });

  it('requires confirmed child exit when production teardown kills it', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort: vi.fn(async () => 19458),
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 10
    });
    const spawned = await dependencies.spawnElectron();

    await expect(dependencies.killChild(spawned)).rejects.toThrow('CHILD_EXIT_UNCONFIRMED');
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('accepts confirmed child exit when browser disconnect close hangs', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      child.emit('exit', 0);
      return true;
    });
    const page = {
      url: () => 'app://renderer',
      waitForFunction: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        success: true,
        data: { userDataDir: 'D:\\isolated', rolloutHandshake: 'a'.repeat(32) }
      }))
    };
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort: vi.fn(async () => 19459),
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn(async () => ({
        contexts: () => [{ pages: () => [page] }],
        close: vi.fn(() => new Promise(() => {}))
      })) } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 10
    });
    const spawned = await dependencies.spawnElectron();
    await dependencies.attachToApp();

    await expect(dependencies.killChild(spawned)).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('bounds a hanging child cleanup and preserves the primary timeout code', async () => {
    const deps = fakeDependencies({
      getProgress: vi.fn(() => new Promise(() => {})),
      killChild: vi.fn(() => new Promise(() => {})),
      cleanupTimeoutMs: 5
    });
    const result = await main({ ...newOptions(1), minutes: 0.0001 }, deps);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(deps.killChild).toHaveBeenCalledTimes(2);
    expect(deps.writeStdout).not.toHaveBeenCalled();
  });

  it('does not spawn late after reserved-port work is aborted', async () => {
    let resolvePort;
    const reservePort = vi.fn(() => new Promise((resolve) => {
      resolvePort = resolve;
    }));
    const spawnProcess = vi.fn();
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort,
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess,
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() })
    });
    const controller = new AbortController();
    const spawning = dependencies.spawnElectron({ signal: controller.signal });
    controller.abort();
    resolvePort(19460);

    await expect(spawning).rejects.toThrow('ROLLOUT_ABORTED');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('bounds hanging production dependency loaders inside the invocation deadline', async () => {
    const result = await createLiveInvocation(newOptions(1), {
      loadPlaywright: () => new Promise(() => {}),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      now: () => 0,
      dependencyTimeoutMs: 5
    });

    expect(result).toEqual({ exitCode: 3, runId: null, artifactBasename: null });
  });

  it('handles a child spawn ENOENT error without an unhandled event', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => false);
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort: vi.fn(async () => 19461),
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), {
          code: 'ENOENT'
        })));
        return child;
      }),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 10
    });

    await expect(dependencies.spawnElectron()).rejects.toThrow('CHILD_SPAWN_FAILED');
    await expect(dependencies.killChild(child)).resolves.toBeUndefined();
    expect(child.listenerCount('error')).toBeGreaterThan(0);
  });

  it('does not treat a post-spawn child error as exit proof', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    const dependencies = await createProductionDependencies(newOptions(1), {
      reservePort: vi.fn(async () => 19462),
      createNonce: vi.fn(() => 'a'.repeat(32)),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
      loadPlaywright: async () => ({ chromium: { connectOverCDP: vi.fn() } }),
      loadValidator: async () => ({ validateRolloutEvidenceFile: vi.fn() }),
      teardownTimeoutMs: 10
    });
    const spawned = await dependencies.spawnElectron();
    child.emit('error', new Error('POST_SPAWN_ERROR'));

    await expect(dependencies.killChild(spawned)).rejects.toThrow('CHILD_EXIT_UNCONFIRMED');
    expect(child.exitCode).toBeNull();
  });

  it('transfers a pre-ack child to main ownership so spawn timeout still tears it down', async () => {
    const ownedChild = { fakeChild: true };
    const dependencies = fakeDependencies({
      spawnElectron: vi.fn(({ onSpawned }) => {
        onSpawned(ownedChild);
        return new Promise(() => {});
      })
    });
    const result = await main({ ...newOptions(1), minutes: 0.0001 }, dependencies);

    expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
    expect(dependencies.attachToApp).not.toHaveBeenCalled();
    expect(dependencies.killChild).toHaveBeenCalledWith(ownedChild);
  });
});
