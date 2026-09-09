import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutomationRunService, type AutomationRunCollaborators } from '../AutomationRunService';
import type { BrowserLauncher } from '../capcut/launcher';
// @ts-expect-error offline validator is an ESM script without emitted declarations.
import { validateRolloutEvidence } from '../../../../scripts/verify-rollout-evidence.mjs';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('AutomationRunService health path', () => {
  it('launches and stops only owned health profiles with exact artifact identity', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-'));
    tempDirectories.push(userDataDir);
    const sourceCreate = vi.fn(() => { throw new Error('health must not create work source'); });
    const proxyAcquire = vi.fn(() => { throw new Error('health must not acquire proxy'); });
    const accountCreate = vi.fn(() => { throw new Error('health must not create account'); });
    const otpRead = vi.fn(() => { throw new Error('health must not read OTP'); });
    const launched: string[] = [];
    const stopped: string[] = [];
    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `health-profile-${launched.length + 1}`;
        launched.push(profileId);
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9200 + launched.length, page: {} as never, context: {} as never };
      },
      stop: async (profileId) => { stopped.push(profileId); }
    };
    const collaborators = {
      workSources: { create: sourceCreate },
      emailOtp: { readOtp: otpRead },
      proxies: { acquire: proxyAcquire, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('health requires owned launcher'); }, stopProfile: async () => {} },
      accounts: { create: accountCreate, update: () => ({ success: true }) },
      logBus: { emit: () => {} },
      launcher: () => launcher
    } as unknown as AutomationRunCollaborators;
    const service = new AutomationRunService(collaborators, {
      userDataDir,
      nextId: () => 'run-health-1'
    });

    const result = await service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false });

    expect(result).toEqual({
      runId: 'run-health-1',
      artifactBasename: 'run-health-1.jsonl',
      attempted: 3,
      healthy: 3,
      stopped: 3,
      cleanupFailures: 0
    });
    expect(launched).toHaveLength(3);
    expect(stopped).toEqual(launched);
    expect(sourceCreate).not.toHaveBeenCalled();
    expect(proxyAcquire).not.toHaveBeenCalled();
    expect(accountCreate).not.toHaveBeenCalled();
    expect(otpRead).not.toHaveBeenCalled();

    const events = fs.readFileSync(path.join(userDataDir, 'rollout-evidence', result.artifactBasename), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; mode?: string; stage?: number; uiScope?: string });
    expect(events[0]).toMatchObject({ type: 'run-start', mode: 'health', stage: 3, uiScope: 'session-target' });
    expect(events.filter((event) => event.type === 'profile-start')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'profile-stop')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'terminal', mode: 'health', stage: 3 });
    expect(validateRolloutEvidence(events, {
      runId: 'run-health-1', expected: 3, stage: 3, mode: 'health'
    })).toMatchObject({ runId: 'run-health-1', accounts: 0, sessions: 3 });
  });

  it('uses target-mode session-local schedulers so one held health profile does not block peers', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-independent-'));
    tempDirectories.push(userDataDir);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const stopped: string[] = [];
    let sequence = 0;
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => {
          const current = ++sequence;
          expect(options.ui?.focusMode).toBe('target');
          await options.ui?.editor('health-editor', async () => {
            if (current === 1) await held;
          });
          const profileId = `health-independent-${current}`;
          options.onProfileStarted?.(profileId);
          return { profileId, port: 9222, page: {} as never, context: {} as never };
        },
        stop: async (profileId) => { stopped.push(profileId); }
      })
    }, { userDataDir, nextId: () => 'run-health-independent' });

    const run = service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false });
    try {
      await vi.waitFor(() => expect(stopped).toHaveLength(2));
    } finally {
      release();
    }
    await expect(run).resolves.toMatchObject({ healthy: 3, stopped: 3 });
  });

  it('exposes the configured userData directory and fails closed when absent', () => {
    const collaborators = {} as AutomationRunCollaborators;
    expect(new AutomationRunService(collaborators, { userDataDir: 'D:\\runtime-data' }).getUserDataDir())
      .toBe('D:\\runtime-data');
    expect(() => new AutomationRunService(collaborators).getUserDataDir())
      .toThrow('RUNTIME_USER_DATA_UNAVAILABLE');
  });

  it('adopts and stops a returned profile id even when the launcher omitted its callback', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-returned-id-'));
    tempDirectories.push(userDataDir);
    const stop = vi.fn(async () => {});
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async () => ({ profileId: 'returned-only', port: 9222, page: {} as never, context: {} as never }),
        stop
      })
    }, { userDataDir, nextId: () => 'run-health-returned-id' });

    const result = await service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false });

    expect(result.stopped).toBe(3);
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('drains sibling ownership and closes failed evidence when one launch rejects', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-launch-fail-'));
    tempDirectories.push(userDataDir);
    let launchCount = 0;
    const stopped: string[] = [];
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => {
          const current = ++launchCount;
          if (current === 2) throw new Error('secret launch failure');
          const profileId = `owned-${current}`;
          options.onProfileStarted?.(profileId);
          await Promise.resolve();
          return { profileId, port: 9222, page: {} as never, context: {} as never };
        },
        stop: async (profileId) => { stopped.push(profileId); }
      })
    }, { userDataDir, nextId: () => 'run-health-launch-fail' });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    expect(stopped.sort()).toEqual(['owned-1', 'owned-3']);
    expect(service.isRunning()).toBe(false);
    const events = fs.readFileSync(path.join(userDataDir, 'rollout-evidence', 'run-health-launch-fail.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.at(-1)).toMatchObject({ type: 'terminal', mode: 'health', state: 'failed', code: 'INTERNAL_ERROR' });
  });

  it('blocks another health run until a profile published after launch timeout is stopped once', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-late-id-'));
    tempDirectories.push(userDataDir);
    const publishLate: Array<() => void> = [];
    const stop = vi.fn(async () => {});
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => new Promise<never>(() => {
          const index = publishLate.length + 1;
          publishLate.push(() => options.onProfileStarted?.(`late-health-profile-${index}`));
        }),
        stop
      })
    }, {
      userDataDir, nextId: (() => { let id = 0; return () => `run-health-late-${++id}`; })(),
      sessionLaunchStopGraceMs: 0, profileStopTimeoutMs: 100
    });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toMatchObject({ code: 'CONFIG_ERROR' });

    for (const publish of publishLate) publish();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(stop).toHaveBeenCalledTimes(3);
    expect(service.isRunning()).toBe(false);
  });

  it('aborts every health facade and rejects post-terminal work after unresolved launch timeouts', async () => {
    const facades: NonNullable<Parameters<BrowserLauncher['launch']>[0]['ui']>[] = [];
    const signals: AbortSignal[] = [];
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => {
          facades.push(options.ui!);
          signals.push(options.signal!);
          return await new Promise<never>(() => {});
        },
        stop: async () => {}
      })
    }, {
      userDataDir: 'unused', nextId: () => 'run-health-unresolved-facades', sessionLaunchStopGraceMs: 5,
      createTelemetry: () => ({ record: () => {}, close: async () => {}, filePath: () => 'unused', artifactBasename: () => 'run.jsonl' })
    });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');

    expect(facades).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const callbacks = facades.map(() => vi.fn(async () => {}));
    await Promise.all(facades.map((ui, index) =>
      expect(ui.foreground('post-terminal', callbacks[index])).rejects.toMatchObject({
        code: 'RESOURCE_CLEANUP_FAILED'
      })
    ));
    expect(callbacks.every((callback) => callback.mock.calls.length === 0)).toBe(true);
  });

  it('retains known health profile ownership after stop failure and blocks another run', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-stop-fail-'));
    tempDirectories.push(userDataDir);
    const stop = vi.fn(async () => { throw new Error('provider stop unknown'); });
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => {
          const profileId = `known-health-${Math.random()}`;
          options.onProfileStarted?.(profileId);
          return { profileId, port: 9222, page: {} as never, context: {} as never };
        },
        stop
      })
    }, { userDataDir, nextId: () => 'run-health-stop-fail', profileStopTimeoutMs: 10 });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    expect(service.isRunning()).toBe(true);
    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('adopts and stops a returned-only id that resolves after the health launch deadline', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-health-late-return-'));
    tempDirectories.push(userDataDir);
    const resolveLaunches: Array<(value: { profileId: string; port: number; page: never; context: never }) => void> = [];
    const stop = vi.fn(async () => {});
    const launcher = {
      name: 'api-v3' as const,
      launch: async () => new Promise<{ profileId: string; port: number; page: never; context: never }>((resolve) => {
        resolveLaunches.push(resolve);
      }),
      stop
    };
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never }, launcher: () => launcher
    }, { userDataDir, nextId: () => 'run-health-late-return', sessionLaunchStopGraceMs: 0 });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    resolveLaunches.forEach((resolve, index) => resolve({
      profileId: `returned-after-timeout-${index + 1}`, port: 9222, page: {} as never, context: {} as never
    }));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(stop).toHaveBeenCalledTimes(3);
    expect(service.isRunning()).toBe(false);
  });

  it('keeps late returned-only ownership uncertain when its bounded stop times out', async () => {
    const resolveLaunches: Array<(value: { profileId: string; port: number; page: never; context: never }) => void> = [];
    const resolveStops: Array<() => void> = [];
    const stop = vi.fn(async () => new Promise<void>((resolve) => { resolveStops.push(resolve); }));
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async () => new Promise<{ profileId: string; port: number; page: never; context: never }>((resolve) => {
          resolveLaunches.push(resolve);
        }),
        stop
      })
    }, {
      userDataDir: 'unused', nextId: () => 'run-health-late-stop-timeout',
      sessionLaunchStopGraceMs: 0, profileStopTimeoutMs: 0,
      createTelemetry: () => ({ record: () => {}, close: async () => {}, filePath: () => 'unused', artifactBasename: () => 'run.jsonl' })
    });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    resolveLaunches.forEach((resolve, index) => resolve({
      profileId: `late-stop-timeout-${index + 1}`, port: 9222, page: {} as never, context: {} as never
    }));
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    resolveStops.forEach((resolve) => resolve());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(stop).toHaveBeenCalledTimes(3);
    expect(service.isRunning()).toBe(true);
  });

  it('fails health when returned-only profile adoption cannot record evidence', async () => {
    const record = vi.fn((event: { type: string }) => {
      if (event.type === 'profile-start') throw new Error('profile evidence failed');
    });
    const stop = vi.fn(async () => {});
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async () => ({ profileId: `returned-evidence-${Math.random()}`, port: 9222, page: {} as never, context: {} as never }),
        stop
      })
    }, {
      userDataDir: 'unused', nextId: () => 'run-health-returned-evidence',
      createTelemetry: () => ({ record, close: async () => {}, filePath: () => 'unused', artifactBasename: () => 'run.jsonl' })
    });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('fails and aborts health when scheduler evidence recording throws', async () => {
    const record = vi.fn((event: { type: string }) => {
      if (event.type === 'ui-queued') throw new Error('evidence write failed');
    });
    const service = new AutomationRunService({
      workSources: { create: () => { throw new Error('unused'); } }, emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never },
      launcher: () => ({
        name: 'api-v3',
        launch: async (options) => {
          const profileId = `evidence-health-${Math.random()}`;
          options.onProfileStarted?.(profileId);
          await options.ui!.foreground('renderer-health:mouse', async () => {});
          return { profileId, port: 9222, page: {} as never, context: {} as never };
        },
        stop: async () => {}
      })
    }, {
      userDataDir: 'unused', nextId: () => 'run-health-evidence-fail',
      createTelemetry: () => ({ record, close: async () => {}, filePath: () => 'unused', artifactBasename: () => 'run.jsonl' })
    });

    await expect(service.runHealthCheck({ threadCount: 3, rolloutStage: 3, headless: false }))
      .rejects.toThrow('HEALTH_CHECK_FAILED');
  });
});
