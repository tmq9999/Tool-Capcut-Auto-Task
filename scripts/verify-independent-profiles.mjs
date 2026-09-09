import { RunUiInteractionScheduler } from '../src/main/services/capcut/uiInteractionScheduler.ts';
import { foregroundPage, humanClick, humanType } from '../src/main/services/capcut/human.ts';
import { withinDeadline } from '../src/main/services/capcut/cancellation.ts';
import { loadOfflineFixture } from '../tools/offlineFixture.ts';

const FIXTURE = '<main><input aria-label="Probe text"><button aria-label="Count">Count</button><output>0</output><input type="file" aria-label="Probe file"></main>';
const FIXTURE_URL = 'http://127.0.0.1/offline-fixture';
const PUBLIC_CAUSE_CODES = new Set([
  'INDEPENDENCE_PROFILE_ID_INVALID',
  'INDEPENDENCE_PROFILE_ID_DUPLICATE',
  'INDEPENDENCE_PROFILE_ID_CHANGED',
  'INDEPENDENCE_EXTERNAL_REQUEST',
  'LAUNCH_FAILED',
  'PROBE_FAILED',
  'PROFILE_STOP_FAILED',
  'WORKER_FAILED'
]);

async function checked(signal, operation) {
  signal.throwIfAborted();
  const value = await operation();
  signal.throwIfAborted();
  return value;
}

/** Uses only generated local fixtures; no CapCut or mailbox operation exists here. */
async function probePages(launched, { ui, signal, index, rounds }) {
  let externalRequests = 0;
  signal.throwIfAborted();
  const pages = [launched.page, await checked(signal, () => launched.context.newPage())];
  for (const page of pages) {
    signal.throwIfAborted();
    page.on('request', request => {
      if (request.url() !== FIXTURE_URL) externalRequests++;
    });
    await checked(signal, () => loadOfflineFixture(page, FIXTURE, signal));
    await checked(signal, () => page.evaluate(() => {
      document.querySelector('button').addEventListener('click', () => {
        const output = document.querySelector('output');
        output.textContent = String(Number(output.textContent) + 1);
      });
    }));
  }
  for (let round = 0; round < rounds; round++) {
    signal.throwIfAborted();
    const page = pages[round % pages.length];
    const input = page.getByRole('textbox', { name: 'Probe text' });
    const options = { signal, ui, stage: 'independence:input' };
    const expected = `p${index}-r${round}`;
    await foregroundPage(page, options, () => input.fill(''));
    await humanType(page, input, expected, undefined, options);
    if (await checked(signal, () => input.inputValue()) !== expected) throw new Error('INDEPENDENCE_TEXT_MISMATCH');
    await humanClick(page, page.getByRole('button', { name: 'Count' }), options);
    const expectedClicks = Math.floor(round / pages.length) + 1;
    if (Number(await checked(signal, () => page.locator('output').innerText())) !== expectedClicks) {
      throw new Error('INDEPENDENCE_CLICK_MISMATCH');
    }
  }
  for (const page of pages) {
    signal.throwIfAborted();
    await ui.foreground('independence:upload', async () => {
      signal.throwIfAborted();
      const file = page.getByLabel('Probe file');
      await checked(signal, () => file.setInputFiles({ name: 'probe.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') }));
      const files = await checked(signal, () => file.evaluate(input => input.files?.length));
      if (files !== 1) throw new Error('INDEPENDENCE_UPLOAD_MISMATCH');
    });
  }
  return { externalRequests };
}

/** Injectable launcher boundary. Caller owns configured secrets and explicit live consent. */
export async function verifyIndependentProfiles({
  threadCount, launcher, signal, env = process.env, rounds = 100, probe = probePages, probeTimeoutMs = 600_000
}) {
  if (env.VERIFY_MULTILOGIN_INDEPENDENCE !== '1') throw new Error('INDEPENDENCE_OPT_IN_REQUIRED');
  if (![3, 10].includes(threadCount)) throw new Error('INDEPENDENCE_COUNT_INVALID');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error('INDEPENDENCE_ROUNDS_INVALID');
  if (!Number.isSafeInteger(probeTimeoutMs) || probeTimeoutMs <= 0) throw new Error('INDEPENDENCE_TIMEOUT_INVALID');
  signal.throwIfAborted();
  let started = 0;
  let stopped = 0;
  let completed = 0;
  let activeInputs = 0;
  let peakConcurrentInputs = 0;
  let externalRequests = 0;
  const runAbort = new AbortController();
  const runSignal = AbortSignal.any([signal, runAbort.signal]);
  const owners = new Map();
  const stopPromises = new Map();
  const failures = [];
  const sanitize = (error, fallback) => {
    const code = typeof error?.code === 'string' && PUBLIC_CAUSE_CODES.has(error.code)
      ? error.code
      : fallback;
    return Object.assign(new Error(code), { code });
  };
  const fail = (error, fallback) => {
    const sanitized = sanitize(error, fallback);
    failures.push(sanitized.code);
    if (!runAbort.signal.aborted) runAbort.abort(sanitized);
    return sanitized;
  };
  const codedError = code => Object.assign(new Error(code), { code });
  const stopOwned = (profileId) => {
    const existing = stopPromises.get(profileId);
    if (existing) return existing;
    const owner = owners.get(profileId);
    if (!owner) return Promise.reject(codedError('INDEPENDENCE_PROFILE_NOT_OWNED'));
    const stopping = withinDeadline(Promise.resolve().then(() => launcher.stop(profileId)), 60_000)
      .then(() => {
        owner.scheduler.confirmProfileStopped(owner.sessionAlias);
        stopped++;
      })
      .catch(error => {
        throw fail(error, 'PROFILE_STOP_FAILED');
      });
    stopPromises.set(profileId, stopping);
    return stopping;
  };
  const outcomes = await Promise.allSettled(Array.from({ length: threadCount }, async (_, index) => {
    const localAbort = new AbortController();
    const sessionSignal = AbortSignal.any([runSignal, localAbort.signal]);
    const sessionAlias = `worker-${index + 1}-session-1`;
    const scheduler = new RunUiInteractionScheduler({ onEvent: event => {
      if (event.lane !== 'foreground') return;
      if (event.type === 'started') {
        activeInputs++;
        peakConcurrentInputs = Math.max(peakConcurrentInputs, activeInputs);
      } else if (event.type === 'finished') activeInputs--;
    } });
    const ui = scheduler.forSession({ sessionAlias, signal: sessionSignal, focusMode: 'target' });
    let profileId;
    let launchAbandoned = false;
    const adopt = id => {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw codedError('INDEPENDENCE_PROFILE_ID_INVALID');
      }
      if (profileId === id) return;
      if (profileId !== undefined) throw codedError('INDEPENDENCE_PROFILE_ID_CHANGED');
      const existingOwner = owners.get(id);
      if (existingOwner && existingOwner.sessionAlias !== sessionAlias) {
        throw codedError('INDEPENDENCE_PROFILE_ID_DUPLICATE');
      }
      profileId = id;
      owners.set(id, { sessionAlias, scheduler });
      started++;
      if (launchAbandoned) void stopOwned(id).catch(() => {});
    };
    try {
      const rawLaunch = Promise.resolve().then(() => launcher.launch({
        headless: false,
        signal: sessionSignal,
        ui,
        onProfileStarted: id => {
          try {
            adopt(id);
          } catch (error) {
            fail(error, 'LAUNCH_FAILED');
            throw error;
          }
        }
      }));
      void rawLaunch.then(
        launched => {
          try {
            adopt(launched.profileId);
            if (launchAbandoned) void stopOwned(launched.profileId).catch(() => {});
          } catch (error) {
            fail(error, 'LAUNCH_FAILED');
          }
        },
        () => {}
      );
      const launched = await withinDeadline(rawLaunch, probeTimeoutMs, sessionSignal);
      adopt(launched.profileId);
      const result = await withinDeadline(
        Promise.resolve().then(() => probe(launched, { ui, signal: sessionSignal, index, rounds })),
        probeTimeoutMs, sessionSignal
      );
      externalRequests += result.externalRequests;
      if (result.externalRequests !== 0) throw new Error('INDEPENDENCE_EXTERNAL_REQUEST');
      completed++;
    } catch (error) {
      launchAbandoned = true;
      const fallback = profileId === undefined ? 'LAUNCH_FAILED' : 'PROBE_FAILED';
      throw fail(error, fallback);
    } finally {
      localAbort.abort();
      if (profileId !== undefined) {
        await stopOwned(profileId);
      } else scheduler.closeSession(sessionAlias);
    }
  }));
  const result = { started, stopped, completed, peakConcurrentInputs, externalRequests };
  if (outcomes.some(outcome => outcome.status === 'rejected') || started !== threadCount || stopped !== threadCount) {
    const causeCodes = [...new Set([
      ...failures,
      ...outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason)
    ].map(error => typeof error === 'string'
      ? error
      : sanitize(error, 'WORKER_FAILED').code))];
    throw Object.assign(new Error('INDEPENDENCE_PROBE_FAILED'), { summary: result, causeCodes });
  }
  if (peakConcurrentInputs < threadCount) throw Object.assign(new Error('INDEPENDENCE_NOT_CONCURRENT'), { summary: result });
  return result;
}
