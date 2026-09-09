import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AutomationEvidenceEventSchema } from '../src/shared/schemas/automation-evidence.schema.ts';
import {
  EXIT_CODES,
  LiveEvidenceError,
  LiveOptionError,
  resolveExitCode
} from './live-capcut-options.mjs';

const SAFE_RUN_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|run-[a-zA-Z0-9][a-zA-Z0-9-]{0,127})$/i;
const MODES = new Set(['new', 'resume', 'health']);
const STAGES = new Set([1, 3, 5, 10]);

function fail(code) {
  throw new LiveEvidenceError(code);
}

function optionValue(arg, name) {
  return arg.slice(name.length + 3);
}

/** Parse the validator's exact, non-secret command-line contract. */
export function parseEvidenceOptions(argv) {
  const values = new Map();
  const known = ['run-id', 'user-data-dir', 'expected', 'stage', 'mode'];
  let requireIndependent = false;
  for (const arg of argv) {
    if (arg === '--require-independent') {
      if (requireIndependent) throw new LiveOptionError('Duplicate validator option.');
      requireIndependent = true;
      continue;
    }
    const name = known.find((candidate) => arg.startsWith(`--${candidate}=`));
    if (!name) throw new LiveOptionError('Unknown validator option.');
    if (values.has(name)) throw new LiveOptionError('Duplicate validator option.');
    values.set(name, optionValue(arg, name));
  }
  if (known.some((name) => !values.has(name))) {
    throw new LiveOptionError('Missing validator option.');
  }

  const runId = values.get('run-id');
  const userDataDir = values.get('user-data-dir');
  const expected = Number(values.get('expected'));
  const stage = Number(values.get('stage'));
  const mode = values.get('mode');
  if (!SAFE_RUN_ID.test(runId)) throw new LiveOptionError('Invalid run ID.');
  if (!path.isAbsolute(userDataDir)) throw new LiveOptionError('Invalid user-data directory.');
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new LiveOptionError('Expected count must be a positive integer.');
  }
  if (!STAGES.has(stage) || expected !== stage) {
    throw new LiveOptionError('Stage must be an approved count matching expected.');
  }
  if (!MODES.has(mode)) throw new LiveOptionError('Invalid evidence mode.');
  if (mode === 'health' && requireIndependent) {
    throw new LiveOptionError('INDEPENDENT_HEALTH_UNSUPPORTED');
  }
  if (mode === 'health' && stage !== 3 && stage !== 10) {
    throw new LiveOptionError('Health evidence requires stage 3 or 10.');
  }
  if (mode === 'resume' && stage !== 3) {
    throw new LiveOptionError('Resume evidence requires stage 3.');
  }
  return {
    runId,
    userDataDir,
    expected,
    stage,
    mode,
    ...(requireIndependent ? { requireIndependent: true } : {})
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function peakDistinctSessions(intervals) {
  const boundaries = intervals.filter((interval) => interval.endMs > interval.startMs).flatMap((interval) => [
    { at: interval.startMs, delta: 1, sessionAlias: interval.sessionAlias },
    { at: interval.endMs, delta: -1, sessionAlias: interval.sessionAlias }
  ]).sort((left, right) => left.at - right.at || left.delta - right.delta);
  const active = new Set();
  let peak = 0;
  for (const boundary of boundaries) {
    if (boundary.delta < 0) active.delete(boundary.sessionAlias);
    else active.add(boundary.sessionAlias);
    peak = Math.max(peak, active.size);
  }
  return peak;
}

function intervalWallMs(intervals) {
  const ordered = [...intervals].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs
  );
  let wallMs = 0;
  let activeStart = null;
  let activeEnd = null;
  for (const interval of ordered) {
    if (activeStart === null) {
      activeStart = interval.startMs;
      activeEnd = interval.endMs;
    } else if (interval.startMs <= activeEnd) {
      activeEnd = Math.max(activeEnd, interval.endMs);
    } else {
      wallMs += activeEnd - activeStart;
      activeStart = interval.startMs;
      activeEnd = interval.endMs;
    }
  }
  if (activeStart !== null) wallMs += activeEnd - activeStart;
  return wallMs;
}

/** Validate UI queue/start/finish lifecycles and summarize actual intervals. */
export function summarizeUiConcurrency(events) {
  if (!Array.isArray(events)) fail('INVALID_UI_EVIDENCE');
  const profiles = new Map();
  const perSession = {};
  for (const event of events) {
    if (event.type === 'profile-start') {
      if (profiles.has(event.sessionAlias)) fail('INVALID_PROFILE_LIFECYCLE');
      const startMs = Date.parse(event.at);
      if (!Number.isFinite(startMs)) fail('INVALID_PROFILE_LIFECYCLE');
      profiles.set(event.sessionAlias, {
        workerAlias: event.workerAlias,
        startMs,
        stopMs: null
      });
      perSession[event.sessionAlias] = { editorWaitMs: 0, inputWaitMs: 0 };
    } else if (event.type === 'profile-stop') {
      const profile = profiles.get(event.sessionAlias);
      const stopMs = Date.parse(event.at);
      if (
        !profile || profile.stopMs !== null || profile.workerAlias !== event.workerAlias ||
        !Number.isFinite(stopMs) || stopMs < profile.startMs
      ) {
        fail('INVALID_PROFILE_LIFECYCLE');
      }
      profile.stopMs = stopMs;
    }
  }

  const lifecycles = new Map();
  const intervals = [];
  const inputWaits = [];
  for (const event of events) {
    if (!['ui-queued', 'ui-started', 'ui-finished'].includes(event.type)) continue;
    const atMs = Date.parse(event.at);
    const profile = profiles.get(event.sessionAlias);
    if (
      !profile || profile.stopMs === null || profile.workerAlias !== event.workerAlias ||
      !Number.isFinite(atMs) || atMs < profile.startMs || atMs > profile.stopMs
    ) {
      fail('INVALID_UI_SESSION');
    }
    const key = event.sessionAlias + '\u0000' + event.lane;
    let lifecycle = lifecycles.get(key);
    if (!lifecycle) {
      lifecycle = { active: null, queued: [] };
      lifecycles.set(key, lifecycle);
    }
    if (event.type === 'ui-queued') {
      lifecycle.queued.push({ label: event.label, queuedAtMs: atMs });
      continue;
    }
    if (event.type === 'ui-started') {
      const queued = lifecycle.queued.shift();
      if (
        lifecycle.active || !queued || queued.label !== event.label ||
        !Number.isFinite(event.waitMs) || atMs < queued.queuedAtMs ||
        event.waitMs !== atMs - queued.queuedAtMs
      ) {
        fail('INVALID_UI_START');
      }
      lifecycle.active = { label: queued.label, startedAtMs: atMs };
      const session = perSession[event.sessionAlias] ??= { editorWaitMs: 0, inputWaitMs: 0 };
      if (event.lane === 'editor') session.editorWaitMs += event.waitMs;
      else {
        session.inputWaitMs += event.waitMs;
        inputWaits.push(event.waitMs);
      }
      continue;
    }
    const active = lifecycle.active;
    if (
      !active || active.label !== event.label || !Number.isFinite(event.holdMs) ||
      atMs < active.startedAtMs || event.holdMs !== atMs - active.startedAtMs
    ) {
      fail('INVALID_UI_FINISH');
    }
    intervals.push({
      sessionAlias: event.sessionAlias,
      lane: event.lane,
      startMs: active.startedAtMs,
      endMs: atMs
    });
    lifecycle.active = null;
  }
  if ([...lifecycles.values()].some((lifecycle) =>
    lifecycle.active !== null || lifecycle.queued.length > 0
  )) {
    fail('UNCLOSED_UI_LIFECYCLE');
  }

  const editorIntervals = intervals.filter((interval) => interval.lane === 'editor');
  const inputIntervals = intervals.filter((interval) => interval.lane === 'foreground');
  return {
    wallMs: intervalWallMs(intervals),
    peakEditorSessions: peakDistinctSessions(editorIntervals),
    peakInputSessions: peakDistinctSessions(inputIntervals),
    perSession,
    inputWaitMedianMs: median(inputWaits),
    inputWaitP95Ms: percentile(inputWaits, 0.95)
  };
}

function exactlyOne(events, type) {
  const matches = events.filter((event) => event.type === type);
  if (matches.length !== 1) fail(`EXPECTED_ONE_${type.toUpperCase()}`);
  return matches[0];
}

function assertTerminalCounters(terminal, expected, health) {
  const accepted = health ? 0 : expected;
  const completed = health ? 0 : expected;
  if (
    terminal.state !== 'completed' ||
    terminal.accepted !== accepted ||
    terminal.completed !== completed ||
    terminal.failed !== 0 ||
    terminal.stopped !== 0 ||
    terminal.skipped !== 0 ||
    terminal.cleanupFailures !== 0
  ) {
    fail('INVALID_TERMINAL_COUNTERS');
  }
}

function assertResources(events, options) {
  const snapshots = events.filter((event) => event.type === 'resource-snapshot');
  if (snapshots.length < 2) fail('MISSING_RESOURCE_SNAPSHOTS');
  const fields = [
    'activeWorkers',
    'activeProfiles',
    'activeProxies',
    'activeMailReservations'
  ];
  for (const snapshot of snapshots) {
    if (fields.some((field) => snapshot[field] > options.expected)) {
      fail('RESOURCE_CAP_EXCEEDED');
    }
  }
  const final = snapshots.at(-1);
  if (fields.some((field) => final[field] !== 0)) fail('RESOURCE_NOT_RELEASED');

  const peak = Object.fromEntries(fields.map((field) => [
    field,
    Math.max(...snapshots.map((snapshot) => snapshot[field]))
  ]));
  if (peak.activeWorkers === 0 || peak.activeProfiles === 0) {
    fail('RESOURCE_PEAK_NOT_OBSERVED');
  }
  if (options.mode !== 'health' && peak.activeProxies === 0) {
    fail('PROXY_PEAK_NOT_OBSERVED');
  }
  if (options.mode === 'new' && peak.activeMailReservations === 0) {
    fail('MAIL_PEAK_NOT_OBSERVED');
  }
  if (
    (options.mode === 'health' && (peak.activeProxies !== 0 || peak.activeMailReservations !== 0)) ||
    (options.mode === 'resume' && peak.activeMailReservations !== 0)
  ) {
    fail('FORBIDDEN_RESOURCE_ACTIVITY');
  }
  return peak;
}

function assertProfileLifecycle(events, options) {
  const starts = events.filter((event) => event.type === 'profile-start');
  const stops = events.filter((event) => event.type === 'profile-stop');
  const startAliases = starts.map((event) => event.sessionAlias);
  const stopAliases = stops.map((event) => event.sessionAlias);
  if (
    starts.length < options.expected ||
    new Set(startAliases).size !== starts.length ||
    new Set(stopAliases).size !== stops.length ||
    stops.some((event) => event.outcome !== 'confirmed')
  ) {
    fail('INVALID_PROFILE_LIFECYCLE');
  }
  if (
    startAliases.length !== stopAliases.length ||
    startAliases.some((alias) => !stopAliases.includes(alias))
  ) {
    fail('PROFILE_LIFECYCLE_MISMATCH');
  }
  const startBySession = new Map(starts.map((event) => [event.sessionAlias, event]));
  for (const stop of stops) {
    const start = startBySession.get(stop.sessionAlias);
    if (
      !start ||
      start.workerAlias !== stop.workerAlias ||
      start.accountAlias !== stop.accountAlias
    ) {
      fail('PROFILE_ALIAS_MISMATCH');
    }
    if (events.indexOf(start) >= events.indexOf(stop)) fail('PROFILE_EVENT_ORDER');
  }
  for (const start of starts) {
    if (!start.sessionAlias.startsWith(start.workerAlias + '-session-')) {
      fail('SESSION_WORKER_MISMATCH');
    }
  }
  if (options.mode === 'health') {
    if (
      starts.length !== options.expected ||
      starts.some((event) => event.accountAlias !== undefined) ||
      stops.some((event) => event.accountAlias !== undefined)
    ) {
      fail('HEALTH_PROFILE_ALIAS_MISMATCH');
    }
  } else if (
    starts.some((event) => event.accountAlias === undefined) ||
    stops.some((event) => event.accountAlias === undefined) ||
    starts.some((event) => {
      const workers = new Set(
        starts
          .filter((candidate) => candidate.accountAlias === event.accountAlias)
          .map((candidate) => candidate.workerAlias)
      );
      return workers.size !== 1;
    })
  ) {
    fail('MISSING_ACCOUNT_ALIAS');
  }
  return starts;
}

function assertPurchases(events, start, terminal, options) {
  const purchases = events.filter((event) => event.type === 'purchase');
  let attempted = 0;
  let confirmed = 0;
  let ambiguous = 0;
  let provider = null;
  for (const event of purchases) {
    if (event.budget !== start.maxBillablePurchases) fail('PURCHASE_BUDGET_MISMATCH');
    if (provider !== null && provider !== event.provider) fail('PURCHASE_PROVIDER_MISMATCH');
    provider = event.provider;
    const next = {
      attempted: event.attempted,
      confirmed: event.confirmed,
      ambiguous: event.ambiguous
    };
    const validDelta = event.outcome === 'attempted'
      ? next.attempted === attempted + 1 && next.confirmed === confirmed && next.ambiguous === ambiguous
      : event.outcome === 'confirmed'
        ? next.attempted === attempted && next.confirmed === confirmed + 1 && next.ambiguous === ambiguous
        : next.attempted === attempted && next.confirmed === confirmed && next.ambiguous === ambiguous + 1;
    if (!validDelta) fail('NON_MONOTONIC_PURCHASE_HISTORY');
    ({ attempted, confirmed, ambiguous } = next);
  }
  if (
    terminal.purchaseAttempted !== attempted ||
    terminal.purchaseConfirmed !== confirmed ||
    terminal.purchaseAmbiguous !== ambiguous
  ) {
    fail('TERMINAL_PURCHASE_MISMATCH');
  }
  if (options.mode !== 'new') {
    if (start.maxBillablePurchases !== 0 || purchases.length !== 0 || attempted !== 0) {
      fail('FORBIDDEN_PURCHASE_ACTIVITY');
    }
  } else if (
    start.maxBillablePurchases !== options.expected ||
    attempted > start.maxBillablePurchases ||
    confirmed > start.maxBillablePurchases ||
    ambiguous !== 0
  ) {
    fail('INVALID_NEW_PURCHASE_TOTALS');
  }
  return { attempted, confirmed, ambiguous };
}

function assertAccountEvidence(events, start, terminal, options, profileStarts) {
  const accountTerminals = events.filter((event) => event.type === 'account-terminal');
  const checkpoints = events.filter((event) => event.type === 'task-checkpoint');
  const mailboxes = events.filter((event) => event.type === 'mailbox-acquired');
  if (options.mode === 'health') {
    if (
      accountTerminals.length !== 0 || checkpoints.length !== 0 || mailboxes.length !== 0 ||
      terminal.mailboxAcquisitions !== 0
    ) {
      fail('HEALTH_ACCOUNT_ACTIVITY');
    }
    const summary = exactlyOne(events, 'health-summary');
    if (
      summary.attempted !== options.expected ||
      summary.healthy !== options.expected ||
      summary.stopped !== options.expected ||
      summary.cleanupFailures !== 0
    ) {
      fail('INVALID_HEALTH_SUMMARY');
    }
    return { accounts: 0, taskKeys: [] };
  }

  if (events.some((event) => event.type === 'health-summary')) fail('UNEXPECTED_HEALTH_SUMMARY');
  const terminalAliases = accountTerminals.map((event) => event.accountAlias);
  if (
    accountTerminals.length !== options.expected ||
    new Set(terminalAliases).size !== options.expected ||
    accountTerminals.some((event) => event.outcome !== 'completed')
  ) {
    fail('INVALID_ACCOUNT_TERMINALS');
  }
  const workerByAccount = new Map(accountTerminals.map((event) => [
    event.accountAlias,
    event.workerAlias
  ]));
  const profileBySession = new Map(profileStarts.map((event) => [
    event.sessionAlias,
    event
  ]));
  if (checkpoints.some((event) => !event.fresh)) fail('STALE_TASK_CHECKPOINT');
  const finals = checkpoints.filter((event) => event.final);
  if (finals.length !== options.expected) fail('INVALID_FINAL_RECEIPT_COUNT');
  const receiptAliases = finals.map((event) => event.accountAlias);
  if (
    new Set(receiptAliases).size !== options.expected ||
    receiptAliases.some((alias) => !terminalAliases.includes(alias)) ||
    finals.some((event) => workerByAccount.get(event.accountAlias) !== event.workerAlias) ||
    finals.some((event) => {
      const profile = profileBySession.get(event.sessionAlias);
      return !profile ||
        profile.workerAlias !== event.workerAlias ||
        profile.accountAlias !== event.accountAlias ||
        events.indexOf(profile) >= events.indexOf(event) ||
        events.findIndex((candidate) =>
          candidate.type === 'profile-stop' &&
          candidate.sessionAlias === event.sessionAlias
        ) <= events.indexOf(event);
    })
  ) {
    fail('RECEIPT_ALIAS_MISMATCH');
  }
  for (const receipt of finals) {
    const profile = profileBySession.get(receipt.sessionAlias);
    const keys = receipt.tasks.map((task) => task.key);
    if (
      receipt.serverTotal !== 12 ||
      receipt.serverDone !== 12 ||
      receipt.tasks.length !== 12 ||
      new Set(keys).size !== 12 ||
      receipt.tasks.some((task) => task.status !== 4) ||
      Date.parse(receipt.observedAt) <= Date.parse(receipt.requiredAfter) ||
      Date.parse(receipt.requiredAfter) < Date.parse(start.at) ||
      Date.parse(receipt.observedAt) < Date.parse(profile.at) ||
      Date.parse(receipt.observedAt) > Date.parse(receipt.at) ||
      Date.parse(receipt.at) > Date.parse(terminal.at)
    ) {
      fail('INVALID_FINAL_RECEIPT');
    }
  }

  const mailboxAliases = mailboxes.map((event) => event.accountAlias);
  if (options.mode === 'resume') {
    if (mailboxes.length !== 0 || terminal.mailboxAcquisitions !== 0) {
      fail('RESUME_MAILBOX_ACTIVITY');
    }
  } else if (
    mailboxes.length !== options.expected ||
    terminal.mailboxAcquisitions !== options.expected ||
    new Set(mailboxAliases).size !== options.expected ||
    mailboxAliases.some((alias) => !terminalAliases.includes(alias)) ||
    mailboxes.some((event) => workerByAccount.get(event.accountAlias) !== event.workerAlias)
  ) {
    fail('NEW_MAILBOX_MISMATCH');
  }
  return { accounts: terminalAliases.length, taskKeys: finals[0]?.tasks.map((task) => task.key) ?? [] };
}

/** Validate already-parsed lines with the shared strict schema and run rules. */
export function validateRolloutEvidence(rawEvents, options) {
  if (options.mode === 'health' && options.requireIndependent) {
    fail('INDEPENDENT_HEALTH_UNSUPPORTED');
  }
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) fail('EMPTY_EVIDENCE');
  const events = rawEvents.map((event) => {
    const parsed = AutomationEvidenceEventSchema.safeParse(event);
    if (!parsed.success) fail('INVALID_EVIDENCE_LINE');
    return parsed.data;
  });
  if (events.some((event) => event.runId !== options.runId)) fail('RUN_ID_MISMATCH');

  const start = exactlyOne(events, 'run-start');
  const terminal = exactlyOne(events, 'terminal');
  if (events[0].type !== 'run-start' || events.at(-1).type !== 'terminal') {
    fail('INVALID_EVENT_ORDER');
  }
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].at) < Date.parse(events[index - 1].at)) {
      fail('NON_MONOTONIC_EVENT_TIME');
    }
  }
  const expectedTerminalCode = {
    new: 'MAIL_LIMIT_REACHED',
    resume: 'MANUAL_EXHAUSTED',
    health: 'HEALTH_CHECK_COMPLETED'
  }[options.mode];
  if (
    start.mode !== options.mode || terminal.mode !== options.mode ||
    start.stage !== options.stage || terminal.stage !== options.stage ||
    start.workerTarget !== options.expected || terminal.code !== expectedTerminalCode
  ) {
    fail('RUN_CONTEXT_MISMATCH');
  }
  if (events.some((event) => [
    'ui-quarantined', 'ui-late-settled', 'scheduler-shutdown', 'persistence-failure'
  ].includes(event.type))) {
    fail('UNSAFE_EVENT');
  }
  if (options.mode === 'health' && events.some((event) => event.accountAlias !== undefined)) {
    fail('HEALTH_ACCOUNT_ALIAS');
  }
  assertTerminalCounters(terminal, options.expected, options.mode === 'health');
  const peak = assertResources(events, options);
  const starts = assertProfileLifecycle(events, options);
  const purchase = assertPurchases(events, start, terminal, options);
  const account = assertAccountEvidence(events, start, terminal, options, starts);
  const result = {
    runId: options.runId,
    mode: options.mode,
    stage: options.stage,
    expected: options.expected,
    accounts: account.accounts,
    sessions: starts.length,
    taskKeys: account.taskKeys,
    peak,
    purchase
  };
  if (options.requireIndependent) {
    if (start.uiScope !== 'session-target') fail('INDEPENDENT_UI_SCOPE_REQUIRED');
    const independence = summarizeUiConcurrency(events);
    const requiredEditorPeak = options.stage >= 3 ? 3 : 1;
    if (independence.peakEditorSessions < requiredEditorPeak) {
      fail('INSUFFICIENT_EDITOR_CONCURRENCY');
    }
    if (
      Object.values(independence.perSession).some((session) => session.editorWaitMs > 2_000) ||
      independence.inputWaitP95Ms > 2_000
    ) {
      fail('UI_WAIT_THRESHOLD_EXCEEDED');
    }
    result.independence = independence;
  }
  return result;
}

/** Read exactly rollout-evidence/{runId}.jsonl; never consult last-run.json. */
export async function validateRolloutEvidenceFile(options) {
  if (!SAFE_RUN_ID.test(options.runId) || !path.isAbsolute(options.userDataDir)) {
    fail('INVALID_EVIDENCE_LOCATION');
  }
  const evidenceDir = path.resolve(options.userDataDir, 'rollout-evidence');
  const artifact = path.resolve(evidenceDir, options.runId + '.jsonl');
  if (path.dirname(artifact) !== evidenceDir) fail('INVALID_EVIDENCE_LOCATION');
  let raw;
  try {
    raw = await readFile(artifact, 'utf8');
  } catch {
    fail('EVIDENCE_NOT_FOUND');
  }
  const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  const lines = content.split('\n');
  if (!content || lines.some((line) => line.trim().length === 0)) fail('INVALID_JSONL');
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      fail('INVALID_JSONL');
    }
  }
  return validateRolloutEvidence(events, options);
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const options = parseEvidenceOptions(process.argv.slice(2));
    const result = await validateRolloutEvidenceFile(options);
    process.stdout.write('ROLLOUT_EVIDENCE=' + JSON.stringify({
      runId: result.runId,
      mode: result.mode,
      stage: result.stage,
      expected: result.expected,
      accounts: result.accounts,
      sessions: result.sessions,
      taskKeys: result.taskKeys,
      ...(result.independence ? { independence: result.independence } : {})
    }) + '\n');
    process.exitCode = EXIT_CODES.SUCCESS;
  } catch (error) {
    process.stderr.write('ROLLOUT_EVIDENCE_ERROR\n');
    process.exitCode = error instanceof LiveOptionError
      ? EXIT_CODES.OPTION_ERROR
      : resolveExitCode(error) || EXIT_CODES.EVIDENCE_FAILURE;
  }
}
