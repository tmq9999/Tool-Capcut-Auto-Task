import { describe, expect, it, vi } from 'vitest';
import { verifyIndependentProfiles } from '../verify-independent-profiles.mjs';

function fixture() {
  const stopped = [];
  const launcher = {
    launch: vi.fn(async ({ onProfileStarted }) => {
      const profileId = `profile-${launcher.launch.mock.calls.length}`;
      onProfileStarted(profileId);
      return { profileId, page: {}, context: {}, port: 1000 };
    }),
    stop: vi.fn(async id => { stopped.push(id); })
  };
  return { launcher, stopped };
}

const enabled = { VERIFY_MULTILOGIN_INDEPENDENCE: '1' };

describe('opt-in independent profile harness', () => {
  it('rejects missing opt-in before a profile starts', async () => {
    const h = fixture();
    await expect(verifyIndependentProfiles({ threadCount: 3, launcher: h.launcher, signal: new AbortController().signal, env: {} }))
      .rejects.toThrow('INDEPENDENCE_OPT_IN_REQUIRED');
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it('rejects unsupported concurrency before a profile starts', async () => {
    const h = fixture();
    await expect(verifyIndependentProfiles({ threadCount: 20, launcher: h.launcher, signal: new AbortController().signal,
      env: { VERIFY_MULTILOGIN_INDEPENDENCE: '1' } })).rejects.toThrow('INDEPENDENCE_COUNT_INVALID');
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it('runs all profile probes before any probe releases and cleans each profile exactly once', async () => {
    const h = fixture();
    const active = new Set();
    const roundsByProfile = new Map();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const run = verifyIndependentProfiles({ threadCount: 3, launcher: h.launcher, signal: new AbortController().signal,
      env: { VERIFY_MULTILOGIN_INDEPENDENCE: '1' },
      rounds: 3,
      probe: async (_launched, options) => {
        for (let round = 0; round < options.rounds; round++) {
          await options.ui.foreground('probe-input', async () => {
            active.add(options.index);
            roundsByProfile.set(options.index, (roundsByProfile.get(options.index) ?? 0) + 1);
            if (round === 0) await hold;
          });
        }
        return { externalRequests: 0 };
      }
    });
    try { await vi.waitFor(() => expect(active.size).toBe(3)); }
    finally { release(); }
    expect(await run).toMatchObject({ started: 3, stopped: 3, completed: 3, peakConcurrentInputs: 3, externalRequests: 0 });
    expect(h.stopped).toHaveLength(3);
    expect(new Set(h.stopped).size).toBe(3);
    expect([...roundsByProfile.values()]).toEqual([3, 3, 3]);
  });

  it('stops profiles adopted before a launch rejection without touching unrelated profiles', async () => {
    const h = fixture();
    h.launcher.launch.mockImplementationOnce(async ({ onProfileStarted }) => {
      onProfileStarted('failed-profile');
      throw new Error('launch failed');
    });
    await expect(verifyIndependentProfiles({ threadCount: 3, launcher: h.launcher, signal: new AbortController().signal,
      env: { VERIFY_MULTILOGIN_INDEPENDENCE: '1' }, probe: async () => ({ externalRequests: 0 }) })).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    expect(h.stopped).toContain('failed-profile');
    expect(h.stopped).toHaveLength(3);
    expect(new Set(h.stopped).size).toBe(3);
  });

  it('bounds a stalled probe, aborts its input signal and still stops its owned profile', async () => {
    const h = fixture();
    let observedSignal;
    await expect(verifyIndependentProfiles({ threadCount: 3, launcher: h.launcher, signal: new AbortController().signal,
      env: { VERIFY_MULTILOGIN_INDEPENDENCE: '1' }, probeTimeoutMs: 10,
      probe: async (_launched, options) => {
        observedSignal = options.signal;
        return new Promise(() => {});
      }
    })).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    expect(observedSignal.aborted).toBe(true);
    expect(h.stopped).toHaveLength(3);
  });

  it('bounds pending launches and aborts every launch signal', async () => {
    const signals = [];
    const launcher = {
      launch: vi.fn(async ({ signal }) => {
        signals.push(signal);
        return await new Promise(() => {});
      }),
      stop: vi.fn(async () => {})
    };

    await expect(verifyIndependentProfiles({
      threadCount: 3, launcher, signal: new AbortController().signal, env: enabled,
      probeTimeoutMs: 10, probe: async () => ({ externalRequests: 0 })
    })).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    expect(signals).toHaveLength(3);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('adopts and stops a profile published after its launch deadline', async () => {
    const callbacks = [];
    const stop = vi.fn(async () => {});
    const launcher = {
      launch: vi.fn(async ({ onProfileStarted }) => new Promise(() => callbacks.push(onProfileStarted))),
      stop
    };

    const run = verifyIndependentProfiles({
      threadCount: 3, launcher, signal: new AbortController().signal, env: enabled,
      probeTimeoutMs: 10, probe: async () => ({ externalRequests: 0 })
    });
    const rejected = expect(run).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    await vi.waitFor(() => expect(callbacks).toHaveLength(3));
    await rejected;
    callbacks.forEach((publish, index) => publish(`late-profile-${index + 1}`));
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(3));
    expect(stop.mock.calls.map(([id]) => id).sort()).toEqual([
      'late-profile-1', 'late-profile-2', 'late-profile-3'
    ]);
  });

  it('aborts peer probes and fails closed when one exact stop fails', async () => {
    const peerSignals = [];
    const h = fixture();
    h.launcher.stop.mockImplementation(async id => {
      if (id === 'profile-1') throw new Error('stop failed');
      h.stopped.push(id);
    });
    await expect(verifyIndependentProfiles({
      threadCount: 3, launcher: h.launcher, signal: new AbortController().signal, env: enabled,
      probe: async (_launched, options) => {
        if (options.index === 0) return { externalRequests: 0 };
        peerSignals.push(options.signal);
        return await new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      }
    })).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    expect(peerSignals).toHaveLength(2);
    expect(peerSignals.every(signal => signal.aborted)).toBe(true);
  });

  it.each([
    ['', 'INDEPENDENCE_PROFILE_ID_INVALID'],
    ['profile-shared', 'INDEPENDENCE_PROFILE_ID_DUPLICATE']
  ])('fails closed for invalid or duplicate profile id %j', async (profileId, expectedCode) => {
    const launcher = {
      launch: vi.fn(async ({ onProfileStarted }) => {
        onProfileStarted(profileId);
        return { profileId, page: {}, context: {}, port: 1000 };
      }),
      stop: vi.fn(async () => {})
    };
    await expect(verifyIndependentProfiles({
      threadCount: 3, launcher, signal: new AbortController().signal, env: enabled,
      probe: async () => ({ externalRequests: 0 })
    })).rejects.toMatchObject({ causeCodes: expect.arrayContaining([expectedCode]) });
  });

  it.each([
    ['launch', 'LAUNCH_FAILED'],
    ['probe', 'PROBE_FAILED'],
    ['stop', 'PROFILE_STOP_FAILED']
  ])('never exposes secret-bearing %s errors through public rejection fields', async (boundary, expectedCode) => {
    const secret = 'https://user:token@example.invalid/profile/private-id';
    const secretError = Object.assign(new Error(`boundary leaked ${secret}`), { code: `SECRET_${secret}` });
    const h = fixture();
    if (boundary === 'launch') h.launcher.launch.mockRejectedValue(secretError);
    if (boundary === 'stop') h.launcher.stop.mockRejectedValue(secretError);
    let rejection;
    try {
      await verifyIndependentProfiles({
        threadCount: 3, launcher: h.launcher, signal: new AbortController().signal, env: enabled,
        probe: async () => {
          if (boundary === 'probe') throw secretError;
          return { externalRequests: 0 };
        }
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toMatchObject({
      message: 'INDEPENDENCE_PROBE_FAILED',
      causeCodes: expect.arrayContaining([expectedCode])
    });
    expect(rejection).not.toHaveProperty('cause');
    const publicRejection = JSON.stringify({
      message: rejection.message,
      summary: rejection.summary,
      causeCodes: rejection.causeCodes,
      cause: rejection.cause
    });
    expect(publicRejection).not.toContain(secret);
    expect(publicRejection).not.toContain('SECRET_');
  });

  it('does not start fixture setup after an abandoned new-page command settles', async () => {
    const controller = new AbortController();
    let releasePage;
    const setupCommands = [];
    const firstPage = { on: () => setupCommands.push('first:on') };
    const secondPage = { on: () => setupCommands.push('second:on') };
    const h = fixture();
    h.launcher.launch.mockImplementation(async ({ onProfileStarted }) => {
      const profileId = `profile-${h.launcher.launch.mock.calls.length}`;
      onProfileStarted(profileId);
      return {
        profileId,
        page: firstPage,
        context: { newPage: () => new Promise(resolve => { releasePage = () => resolve(secondPage); }) },
        port: 1000
      };
    });
    const run = verifyIndependentProfiles({
      threadCount: 3, launcher: h.launcher, signal: controller.signal, env: enabled, rounds: 1
    });
    const rejected = expect(run).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    await vi.waitFor(() => expect(releasePage).toBeTypeOf('function'));
    controller.abort(new Error('test abort'));
    await rejected;
    releasePage();
    await new Promise(resolve => setImmediate(resolve));
    expect(setupCommands).toEqual([]);
  });

  it('does not upload after an abandoned final read settles', async () => {
    const controller = new AbortController();
    let releaseRead;
    const uploads = [];
    const createLocator = (kind, pageIndex) => ({
      fill: async () => {},
      inputValue: async () => `p${pageIndex}-r0`,
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => {},
      innerText: kind === 'output'
        ? () => new Promise(resolve => { releaseRead = () => resolve('1'); })
        : async () => '',
      setInputFiles: async () => { uploads.push(kind); },
      evaluate: async () => 1
    });
    const createPage = (pageIndex) => ({
      on: () => {}, route: async () => {}, goto: async () => {}, evaluate: async () => {},
      getByRole: (role) => createLocator(role, pageIndex),
      locator: () => createLocator('output', pageIndex),
      getByLabel: () => createLocator('file', pageIndex),
      keyboard: { type: async () => {} }
    });
    const h = fixture();
    h.launcher.launch.mockImplementation(async ({ onProfileStarted }) => {
      const pageIndex = h.launcher.launch.mock.calls.length - 1;
      const profileId = `profile-${pageIndex + 1}`;
      onProfileStarted(profileId);
      return { profileId, page: createPage(pageIndex), context: { newPage: async () => createPage(pageIndex) }, port: 1000 };
    });
    const run = verifyIndependentProfiles({
      threadCount: 3, launcher: h.launcher, signal: controller.signal, env: enabled, rounds: 1
    });
    const rejected = expect(run).rejects.toThrow('INDEPENDENCE_PROBE_FAILED');
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'), { timeout: 20_000, interval: 20 });
    controller.abort(new Error('test abort'));
    await rejected;
    releaseRead();
    await new Promise(resolve => setImmediate(resolve));
    expect(uploads).toEqual([]);
  }, 30_000);
});
