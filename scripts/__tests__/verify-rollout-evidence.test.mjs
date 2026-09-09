import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseEvidenceOptions,
  summarizeUiConcurrency,
  validateRolloutEvidence,
  validateRolloutEvidenceFile
} from '../verify-rollout-evidence.mjs';
import { LiveEvidenceError, LiveOptionError } from '../live-capcut-options.mjs';

const RUN_ID = 'run-evidence-a';
const AT = '2026-09-08T00:00:00.000Z';
const OBSERVED_AT = '2026-09-08T00:00:02.000Z';
const REQUIRED_AFTER = '2026-09-08T00:00:01.000Z';
const TASK_KEYS = [
  'capcut_web_newbie_register',
  'capcut_web_pwa_install',
  'capcut_web_push_authorize',
  'capcut_web_design_studio_picture_creation',
  'capcut_web_design_studio_ai_chat',
  'capcut_web_design_studio_upload_img',
  'capcut_web_design_studio_canvas_edit',
  'capcut_web_inspiration_generate_done',
  'capcut_web_video_studio_creation',
  'capcut_web_video_studio_send_msg',
  'capcut_web_video_studio_generate_done',
  'capcut_web_video_studio_export'
];
const TASKS = TASK_KEYS.map((key) => ({ key, status: 4 }));
const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function base(type, extra = {}) {
  return { schemaVersion: 1, runId: RUN_ID, at: AT, type, ...extra };
}

function resource(activeWorkers, activeProfiles, activeProxies, activeMailReservations) {
  return base('resource-snapshot', {
    activeWorkers,
    activeProfiles,
    activeProxies,
    activeMailReservations
  });
}

function runStart(mode, stage, expected, budget) {
  return base('run-start', {
    mode,
    headed: true,
    stage,
    workerTarget: expected,
    maxBillablePurchases: budget
  });
}

function profileStart(worker, session, account) {
  return base('profile-start', {
    workerAlias: `worker-${worker}`,
    sessionAlias: `worker-${worker}-session-${session}`,
    ...(account ? { accountAlias: `account-${account}` } : {})
  });
}

function profileStop(worker, session, account) {
  return base('profile-stop', {
    workerAlias: `worker-${worker}`,
    sessionAlias: `worker-${worker}-session-${session}`,
    ...(account ? { accountAlias: `account-${account}` } : {}),
    outcome: 'confirmed'
  });
}

function receipt(worker, session, account) {
  return base('task-checkpoint', {
    workerAlias: `worker-${worker}`,
    sessionAlias: `worker-${worker}-session-${session}`,
    accountAlias: `account-${account}`,
    fresh: true,
    final: true,
    observedAt: OBSERVED_AT,
    requiredAfter: REQUIRED_AFTER,
    serverTotal: 12,
    serverDone: 12,
    tasks: TASKS
  });
}

function accountTerminal(worker, account) {
  return base('account-terminal', {
    workerAlias: `worker-${worker}`,
    accountAlias: `account-${account}`,
    outcome: 'completed'
  });
}

function terminal(mode, stage, expected, mailboxAcquisitions, purchase = {}) {
  return base('terminal', {
    mode,
    stage,
    state: 'completed',
    code: mode === 'new'
      ? 'MAIL_LIMIT_REACHED'
      : mode === 'resume'
        ? 'MANUAL_EXHAUSTED'
        : 'HEALTH_CHECK_COMPLETED',
    accepted: mode === 'health' ? 0 : expected,
    completed: mode === 'health' ? 0 : expected,
    failed: 0,
    stopped: 0,
    skipped: 0,
    cleanupFailures: 0,
    mailboxAcquisitions,
    purchaseAttempted: purchase.attempted ?? 0,
    purchaseConfirmed: purchase.confirmed ?? 0,
    purchaseAmbiguous: purchase.ambiguous ?? 0
  });
}

function stampEvents(events) {
  return events.map((event, index, all) => {
    const atMs = Date.parse(AT) + index * 1_000;
    const stamped = { ...event, at: new Date(atMs).toISOString() };
    if (stamped.type === 'task-checkpoint') {
      const profile = all.find((candidate) =>
        candidate.type === 'profile-start' &&
        candidate.sessionAlias === stamped.sessionAlias
      );
      const profileIndex = all.indexOf(profile);
      stamped.requiredAfter = new Date(Date.parse(AT) + profileIndex * 1_000).toISOString();
      stamped.observedAt = new Date(atMs - 500).toISOString();
    }
    return stamped;
  });
}

function validNewEvents() {
  return stampEvents([
    runStart('new', 1, 1, 1),
    resource(1, 1, 1, 1),
    profileStart(1, 1, 1),
    base('mailbox-acquired', { workerAlias: 'worker-1', accountAlias: 'account-1' }),
    base('purchase', {
      provider: 'gmail94', outcome: 'attempted', attempted: 1,
      confirmed: 0, ambiguous: 0, budget: 1
    }),
    base('purchase', {
      provider: 'gmail94', outcome: 'confirmed', attempted: 1,
      confirmed: 1, ambiguous: 0, budget: 1
    }),
    receipt(1, 1, 1),
    accountTerminal(1, 1),
    profileStop(1, 1, 1),
    resource(0, 0, 0, 0),
    terminal('new', 1, 1, 1, { attempted: 1, confirmed: 1 })
  ]);
}

function validResumeEvents() {
  const events = [runStart('resume', 3, 3, 0), resource(3, 3, 3, 0)];
  for (let index = 1; index <= 3; index += 1) {
    events.push(profileStart(index, 1, index));
    events.push(receipt(index, 1, index));
    events.push(accountTerminal(index, index));
    events.push(profileStop(index, 1, index));
  }
  events.push(resource(0, 0, 0, 0));
  events.push(terminal('resume', 3, 3, 0));
  return stampEvents(events);
}

function validHealthEvents() {
  const events = [runStart('health', 3, 3, 0), resource(3, 3, 0, 0)];
  for (let index = 1; index <= 3; index += 1) {
    events.push(profileStart(index, 1));
    events.push(profileStop(index, 1));
  }
  events.push(base('health-summary', {
    attempted: 3,
    healthy: 3,
    stopped: 3,
    cleanupFailures: 0
  }));
  events.push(resource(0, 0, 0, 0));
  events.push(terminal('health', 3, 3, 0));
  return stampEvents(events);
}

function validate(events, mode = 'new', expected = 1, stage = expected) {
  return validateRolloutEvidence(events, { runId: RUN_ID, mode, expected, stage });
}

function timed(type, milliseconds, extra = {}) {
  return {
    ...base(type, extra),
    at: new Date(Date.parse(AT) + milliseconds).toISOString()
  };
}

function ui(type, worker, lane, milliseconds, extra = {}) {
  return timed(type, milliseconds, {
    workerAlias: `worker-${worker}`,
    sessionAlias: `worker-${worker}-session-1`,
    lane,
    label: lane === 'editor' ? 'design-studio' : 'ui-action',
    ...extra
  });
}

function independentResumeEvents({ serial = false, rejected = false } = {}) {
  const start = timed('run-start', 0, {
    ...runStart('resume', 3, 3, 0),
    uiScope: 'session-target'
  });
  const editor = serial
    ? [
        ui('ui-queued', 1, 'editor', 1_000),
        ui('ui-started', 1, 'editor', 1_100, { waitMs: 100 }),
        ui('ui-finished', 1, 'editor', 2_100, { holdMs: 1_000, outcome: 'resolved' }),
        ui('ui-queued', 2, 'editor', 2_200),
        ui('ui-started', 2, 'editor', 2_300, { waitMs: 100 }),
        ui('ui-finished', 2, 'editor', 3_300, { holdMs: 1_000, outcome: 'resolved' }),
        ui('ui-queued', 3, 'editor', 3_400),
        ui('ui-started', 3, 'editor', 3_500, { waitMs: 100 }),
        ui('ui-finished', 3, 'editor', 4_500, { holdMs: 1_000, outcome: 'resolved' })
      ]
    : [
        ui('ui-queued', 1, 'editor', 1_000),
        ui('ui-queued', 2, 'editor', 1_010),
        ui('ui-queued', 3, 'editor', 1_020),
        ui('ui-started', 1, 'editor', 1_100, { waitMs: 100 }),
        ui('ui-started', 2, 'editor', 1_110, { waitMs: 100 }),
        ui('ui-started', 3, 'editor', 1_120, { waitMs: 100 }),
        ui('ui-queued', 1, 'foreground', 1_200),
        ui('ui-started', 1, 'foreground', 1_300, { waitMs: 100 }),
        ui('ui-finished', 1, 'foreground', 1_400, { holdMs: 100, outcome: 'resolved' }),
        ui('ui-finished', 1, 'editor', 2_000, {
          holdMs: 900,
          outcome: rejected ? 'rejected' : 'resolved'
        }),
        ui('ui-finished', 2, 'editor', 2_010, { holdMs: 900, outcome: 'resolved' }),
        ui('ui-finished', 3, 'editor', 2_020, { holdMs: 900, outcome: 'resolved' })
      ];
  const closeAt = serial ? 5_000 : 3_000;
  return [
    start,
    timed('resource-snapshot', 100, resource(3, 3, 3, 0)),
    ...[1, 2, 3].map((worker) => timed('profile-start', 500, profileStart(worker, 1, worker))),
    ...editor,
    ...[1, 2, 3].map((worker) => timed('task-checkpoint', closeAt, {
      ...receipt(worker, 1, worker),
      requiredAfter: new Date(Date.parse(AT) + 100).toISOString(),
      observedAt: new Date(Date.parse(AT) + closeAt - 100).toISOString()
    })),
    ...[1, 2, 3].map((worker) => timed('account-terminal', closeAt + 100, accountTerminal(worker, worker))),
    ...[1, 2, 3].map((worker) => timed('profile-stop', closeAt + 200, profileStop(worker, 1, worker))),
    timed('resource-snapshot', closeAt + 300, resource(0, 0, 0, 0)),
    timed('terminal', closeAt + 400, terminal('resume', 3, 3, 0))
  ];
}

function delayClosingEvents(events, delayMs) {
  for (const event of events) {
    if (['task-checkpoint', 'account-terminal', 'profile-stop', 'terminal'].includes(event.type) ||
      (event.type === 'resource-snapshot' && event.activeWorkers === 0)) {
      event.at = new Date(Date.parse(event.at) + delayMs).toISOString();
      if (event.type === 'task-checkpoint') {
        event.observedAt = new Date(Date.parse(event.observedAt) + delayMs).toISOString();
      }
    }
  }
}

describe('rollout evidence option boundary', () => {
  it('accepts only an exact safe run ID and absolute directory', () => {
    const userDataDir = path.resolve(process.cwd(), '..', 'rollout-evidence-test');
    expect(parseEvidenceOptions([
      `--run-id=${RUN_ID}`,
      `--user-data-dir=${userDataDir}`,
      '--expected=3',
      '--stage=3',
      '--mode=resume'
    ])).toEqual({ runId: RUN_ID, userDataDir, expected: 3, stage: 3, mode: 'resume' });

    for (const runId of ['../run-other', 'run-a/../run-b', 'run-a.jsonl']) {
      expect(() => parseEvidenceOptions([
        `--run-id=${runId}`,
        `--user-data-dir=${userDataDir}`,
        '--expected=3',
        '--stage=3',
        '--mode=resume'
      ])).toThrow(LiveOptionError);
    }
  });

  it('parses the opt-in independence flag without requiring it for legacy validation', () => {
    const userDataDir = path.resolve(process.cwd(), '..', 'rollout-evidence-test');
    const baseArgs = [
      `--run-id=${RUN_ID}`,
      `--user-data-dir=${userDataDir}`,
      '--expected=3',
      '--stage=3',
      '--mode=resume'
    ];

    expect(parseEvidenceOptions(baseArgs)).not.toHaveProperty('requireIndependent');
    expect(parseEvidenceOptions([...baseArgs, '--require-independent'])).toEqual({
      runId: RUN_ID,
      userDataDir,
      expected: 3,
      stage: 3,
      mode: 'resume',
      requireIndependent: true
    });
    expect(() => parseEvidenceOptions([
      ...baseArgs,
      '--require-independent',
      '--require-independent'
    ])).toThrow(LiveOptionError);
  });

  it('rejects independent health validation as an unsupported combination', () => {
    const userDataDir = path.resolve(process.cwd(), '..', 'rollout-evidence-test');
    expect(() => parseEvidenceOptions([
      `--run-id=${RUN_ID}`,
      `--user-data-dir=${userDataDir}`,
      '--expected=3',
      '--stage=3',
      '--mode=health',
      '--require-independent'
    ])).toThrow('INDEPENDENT_HEALTH_UNSUPPORTED');

    expect(() => validateRolloutEvidence(validHealthEvents(), {
      runId: RUN_ID,
      mode: 'health',
      expected: 3,
      stage: 3,
      requireIndependent: true
    })).toThrow('INDEPENDENT_HEALTH_UNSUPPORTED');
  });
});

describe('independent headed evidence gate', () => {
  it('keeps legacy functional validation compatible with incomplete legacy UI errors', () => {
    const events = validResumeEvents();
    events.splice(4, 0,
      ui('ui-queued', 1, 'editor', 2_100),
      ui('ui-started', 1, 'editor', 2_200, { waitMs: 100 })
    );
    const restamped = stampEvents(events);

    expect(validateRolloutEvidence(restamped, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
    })).toMatchObject({ accounts: 3, sessions: 3 });
  });

  it('rejects a valid but serial 3/3 artifact only when independence is required', () => {
    const events = independentResumeEvents({ serial: true });

    expect(validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
    })).toMatchObject({ accounts: 3, sessions: 3 });
    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toThrow(LiveEvidenceError);
  });

  it('accepts overlapping editor work from three distinct sessions', () => {
    expect(validateRolloutEvidence(independentResumeEvents(), {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toMatchObject({
      independence: {
        wallMs: 920,
        peakEditorSessions: 3,
        peakInputSessions: 1,
        inputWaitMedianMs: 100,
        inputWaitP95Ms: 100
      }
    });
  });

  it('accepts FIFO queueing behind an active operation in the same session lane', () => {
    const events = independentResumeEvents();
    events.push(
      ui('ui-queued', 1, 'editor', 1_500),
      ui('ui-started', 1, 'editor', 2_100, { waitMs: 600 }),
      ui('ui-finished', 1, 'editor', 2_200, { holdMs: 100, outcome: 'resolved' })
    );
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    expect(validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toMatchObject({
      independence: {
        peakEditorSessions: 3,
        perSession: {
          'worker-1-session-1': { editorWaitMs: 700, inputWaitMs: 100 }
        }
      }
    });
  });

  it('rejects a second start while the same session lane is still active', () => {
    const events = independentResumeEvents();
    events.push(
      ui('ui-queued', 1, 'editor', 1_400),
      ui('ui-started', 1, 'editor', 1_500, { waitMs: 100 }),
      ui('ui-finished', 1, 'editor', 1_600, { holdMs: 100, outcome: 'resolved' })
    );
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toThrow(LiveEvidenceError);
  });

  it('requires one editor interval at stage 1 without rewriting the stage', () => {
    const events = validNewEvents();
    events[0].uiScope = 'session-target';
    events.splice(3, 0,
      ui('ui-queued', 1, 'editor', 0),
      ui('ui-started', 1, 'editor', 0, { waitMs: 0 }),
      ui('ui-finished', 1, 'editor', 0, { holdMs: 0, outcome: 'resolved' })
    );
    const stamped = stampEvents(events);
    const queued = stamped.find((event) => event.type === 'ui-queued');
    const started = stamped.find((event) => event.type === 'ui-started');
    const finished = stamped.find((event) => event.type === 'ui-finished');
    started.waitMs = Date.parse(started.at) - Date.parse(queued.at);
    finished.holdMs = Date.parse(finished.at) - Date.parse(started.at);

    expect(validateRolloutEvidence(stamped, {
      runId: RUN_ID, mode: 'new', expected: 1, stage: 1, requireIndependent: true
    })).toMatchObject({
      stage: 1,
      expected: 1,
      independence: { peakEditorSessions: 1 }
    });
  });

  it('requires the actual session-target policy marker', () => {
    const events = independentResumeEvents();
    delete events[0].uiScope;

    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toThrow(LiveEvidenceError);
  });

  it('does not count zero-duration editor events as overlapping work', () => {
    const events = independentResumeEvents();
    for (const finish of events.filter((event) =>
      event.type === 'ui-finished' && event.lane === 'editor'
    )) {
      const start = events.find((event) =>
        event.type === 'ui-started' &&
        event.sessionAlias === finish.sessionAlias &&
        event.lane === finish.lane
      );
      finish.at = start.at;
      finish.holdMs = 0;
    }
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toThrow(LiveEvidenceError);
  });

  it('rejects non-finite profile timing when the summarizer is called directly', () => {
    const events = independentResumeEvents();
    events.find((event) => event.type === 'profile-start').at = 'not-a-date';

    expect(() => summarizeUiConcurrency(events)).toThrow(LiveEvidenceError);
  });

  it('counts an ordinary rejected finish as a closed duration', () => {
    const events = independentResumeEvents({ rejected: true });
    const summary = summarizeUiConcurrency(events);

    expect(summary).toMatchObject({
      wallMs: 920,
      peakEditorSessions: 3,
      perSession: {
        'worker-1-session-1': { editorWaitMs: 100, inputWaitMs: 100 }
      }
    });
    expect(validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toMatchObject({ independence: summary });
  });

  it('reports the arithmetic median and nearest-rank p95 for input waits', () => {
    const events = independentResumeEvents();
    events.push(
      ui('ui-queued', 2, 'foreground', 1_210),
      ui('ui-started', 2, 'foreground', 1_410, { waitMs: 200 }),
      ui('ui-finished', 2, 'foreground', 1_510, { holdMs: 100, outcome: 'resolved' })
    );
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    expect(summarizeUiConcurrency(events)).toMatchObject({
      inputWaitMedianMs: 150,
      inputWaitP95Ms: 200
    });
  });

  it.each([
    ['missing queue', (events) => events.splice(events.findIndex((event) =>
      event.type === 'ui-queued' && event.sessionAlias === 'worker-3-session-1'
    ), 1)],
    ['missing finish', (events) => events.splice(events.findIndex((event) =>
      event.type === 'ui-finished' && event.sessionAlias === 'worker-3-session-1'
    ), 1)],
    ['duplicate start', (events) => events.splice(events.findIndex((event) =>
      event.type === 'ui-started' && event.sessionAlias === 'worker-2-session-1'
    ) + 1, 0, ui('ui-started', 2, 'editor', 1_115, { waitMs: 105 }))],
    ['unknown session', (events) => events.filter((event) => event.type.startsWith('ui-')).forEach((event) => {
      if (event.sessionAlias === 'worker-3-session-1') {
        event.workerAlias = 'worker-4';
        event.sessionAlias = 'worker-4-session-1';
      }
    })],
    ['worker alias mismatch', (events) => {
      const event = events.find((candidate) => candidate.type === 'ui-started');
      event.workerAlias = 'worker-2';
    }],
    ['duplicate finish', (events) => {
      const index = events.findIndex((event) =>
        event.type === 'ui-finished' && event.sessionAlias === 'worker-2-session-1'
      );
      events.splice(index + 1, 0, { ...events[index] });
    }],
    ['same-session same-lane overlap', (events) => {
      const index = events.findIndex((event) =>
        event.type === 'ui-started' && event.sessionAlias === 'worker-1-session-1'
      );
      events.splice(index + 1, 0, ui('ui-queued', 1, 'editor', 1_105));
    }],
    ['same-session input overlap', (events) => {
      const index = events.findIndex((event) =>
        event.type === 'ui-started' && event.sessionAlias === 'worker-1-session-1' &&
        event.lane === 'foreground'
      );
      events.splice(index + 1, 0, ui('ui-queued', 1, 'foreground', 1_350));
    }],
    ['UI event before profile start', (events) => {
      events.push(
        ui('ui-queued', 1, 'editor', 200),
        ui('ui-started', 1, 'editor', 300, { waitMs: 100 }),
        ui('ui-finished', 1, 'editor', 400, { holdMs: 100, outcome: 'resolved' })
      );
      events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    }],
    ['UI event after profile close', (events) => {
      const index = events.findIndex((event) =>
        event.type === 'profile-stop' && event.sessionAlias === 'worker-1-session-1'
      );
      events.splice(index + 3, 0,
        ui('ui-queued', 1, 'editor', 3_250),
        ui('ui-started', 1, 'editor', 3_260, { waitMs: 10 }),
        ui('ui-finished', 1, 'editor', 3_270, { holdMs: 10, outcome: 'resolved' })
      );
    }]
  ])('fails closed on %s', (_name, mutate) => {
    const events = independentResumeEvents();
    mutate(events);

    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
    })).toThrow(LiveEvidenceError);
  });

  it('fails closed on malformed interval timing', () => {
    for (const mutate of [
      (events) => {
        const event = events.find((candidate) => candidate.type === 'ui-started');
        event.waitMs += 1;
      },
      (events) => {
        const event = events.find((candidate) => candidate.type === 'ui-finished');
        event.holdMs += 1;
      }
    ]) {
      const events = independentResumeEvents();
      mutate(events);
      expect(() => validateRolloutEvidence(events, {
        runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
      })).toThrow(LiveEvidenceError);
    }
  });

  it('enforces cumulative editor wait and input-wait p95 thresholds', () => {
    const editorWait = independentResumeEvents();
    delayClosingEvents(editorWait, 2_000);
    editorWait.push(
      ui('ui-queued', 1, 'editor', 2_100),
      ui('ui-started', 1, 'editor', 4_050, { waitMs: 1_950 }),
      ui('ui-finished', 1, 'editor', 4_150, { holdMs: 100, outcome: 'resolved' })
    );
    editorWait.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    const inputWait = independentResumeEvents();
    delayClosingEvents(inputWait, 1_000);
    inputWait.push(
      ui('ui-queued', 2, 'foreground', 1_200),
      ui('ui-started', 2, 'foreground', 3_201, { waitMs: 2_001 }),
      ui('ui-finished', 2, 'foreground', 3_301, { holdMs: 100, outcome: 'resolved' })
    );
    inputWait.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    for (const events of [editorWait, inputWait]) {
      expect(() => validateRolloutEvidence(events, {
        runId: RUN_ID, mode: 'resume', expected: 3, stage: 3, requireIndependent: true
      })).toThrow(LiveEvidenceError);
    }
  });
});

describe('rollout evidence cross-event validator', () => {
  it('accepts complete new, resume, and health artifacts', () => {
    expect(validate(validNewEvents())).toMatchObject({ mode: 'new', expected: 1 });
    expect(validateRolloutEvidence(validResumeEvents(), {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
    })).toMatchObject({ mode: 'resume', expected: 3 });
    expect(validateRolloutEvidence(validHealthEvents(), {
      runId: RUN_ID, mode: 'health', expected: 3, stage: 3
    })).toMatchObject({ mode: 'health', expected: 3 });
  });

  it('accepts a no-action resume watermark before profile publication but rejects stale observation', () => {
    const at = (seconds) => `2026-09-08T00:00:${String(seconds).padStart(2, '0')}.000Z`;
    const events = [
      { ...runStart('resume', 3, 3, 0), at: at(0) },
      { ...resource(3, 3, 3, 0), at: '2026-09-08T00:00:00.500Z' },
      ...[1, 2, 3].map((index) => ({ ...profileStart(index, 1, index), at: at(5) })),
      ...[1, 2, 3].map((index) => ({
        ...receipt(index, 1, index), requiredAfter: at(1), observedAt: at(6), at: at(7)
      })),
      ...[1, 2, 3].map((index) => ({ ...accountTerminal(index, index), at: '2026-09-08T00:00:07.500Z' })),
      ...[1, 2, 3].map((index) => ({ ...profileStop(index, 1, index), at: at(8) })),
      { ...resource(0, 0, 0, 0), at: '2026-09-08T00:00:08.500Z' },
      { ...terminal('resume', 3, 3, 0), at: at(9) }
    ];

    expect(validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
    })).toMatchObject({ mode: 'resume', accounts: 3, sessions: 3 });

    for (const observedAt of [at(4), at(1)]) {
      const stale = structuredClone(events);
      stale.filter((event) => event.type === 'task-checkpoint').forEach((event) => {
        event.observedAt = observedAt;
      });
      expect(() => validateRolloutEvidence(stale, {
        runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
      })).toThrow(LiveEvidenceError);
    }
  });

  it.each([
    ['stale receipt', (events) => { events[6].fresh = false; }],
    ['non-final receipt', (events) => { events[6].final = false; }],
    ['eleven tasks', (events) => { events[6].tasks = TASKS.slice(0, 11); events[6].serverTotal = 11; events[6].serverDone = 11; }],
    ['duplicate task key', (events) => { events[6].tasks[11] = { ...events[6].tasks[0] }; }],
    ['non-four task status', (events) => { events[6].tasks[0] = { ...events[6].tasks[0], status: 1 }; }],
    ['cleanup failure', (events) => { events.at(-1).cleanupFailures = 1; }],
    ['purchase over cap', (events) => { events[4].attempted = 2; }],
    ['run mismatch', (events) => { events[0].runId = 'run-other'; }],
    ['stage mismatch', (events) => { events[0].stage = 3; }],
    ['resource over cap', (events) => { events[1].activeProfiles = 2; }],
    ['nonzero final resources', (events) => { events.at(-2).activeWorkers = 1; }],
    ['missing profile stop', (events) => { events.splice(8, 1); }],
    ['duplicate profile stop', (events) => { events.splice(9, 0, { ...events[8] }); }],
    ['profile stop worker mismatch', (events) => { events[8].workerAlias = 'worker-2'; }],
    ['profile stop account mismatch', (events) => { events[8].accountAlias = 'account-2'; }],
    ['receipt worker mismatch', (events) => { events[6].workerAlias = 'worker-2'; }],
    ['receipt session mismatch', (events) => { events[6].sessionAlias = 'worker-1-session-2'; }],
    ['mailbox worker mismatch', (events) => { events[3].workerAlias = 'worker-2'; }],
    ['account terminal worker mismatch', (events) => { events[7].workerAlias = 'worker-2'; }],
    ['unsafe quarantine', (events) => { events.splice(-2, 0, base('ui-quarantined', { label: 'ui-action', code: 'DOM_READ_TIMEOUT' })); }],
    ['late action', (events) => { events.splice(-2, 0, base('ui-late-settled', { label: 'ui-action', outcome: 'resolved' })); }],
    ['persistence failure', (events) => { events.splice(-2, 0, base('persistence-failure', { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' })); }],
    ['mailbox count mismatch', (events) => { events.splice(3, 1); }],
    ['account terminal mismatch', (events) => { events[7].accountAlias = 'account-2'; }],
    ['terminal purchase mismatch', (events) => { events.at(-1).purchaseConfirmed = 0; }],
    ['fault terminal code', (events) => { events.at(-1).code = 'INTERNAL_ERROR'; }],
    ['duplicate terminal', (events) => { events.push({ ...events.at(-1) }); }],
    ['event after terminal', (events) => { events.push(resource(0, 0, 0, 0)); }],
    ['event before run start', (events) => { events.unshift(resource(0, 0, 0, 0)); }],
    ['unknown field', (events) => { events[0].secret = 'must-not-parse'; }]
  ])('rejects %s', (_name, mutate) => {
    const events = structuredClone(validNewEvents());
    mutate(events);
    expect(() => validate(events)).toThrow(LiveEvidenceError);
  });

  it('counts recovered sessions separately while counting each account once', () => {
    const events = validNewEvents();
    events.splice(8, 0, profileStart(1, 2, 1), profileStop(1, 2, 1));
    expect(validate(stampEvents(events))).toMatchObject({ accounts: 1, sessions: 2 });
  });

  it('rejects a prior-year receipt even when its internal freshness booleans agree', () => {
    const events = validNewEvents();
    events[6].requiredAfter = '2025-09-08T00:00:01.000Z';
    events[6].observedAt = '2025-09-08T00:00:02.000Z';
    expect(() => validate(events)).toThrow(LiveEvidenceError);
  });

  it('rejects checkpoint timestamps after the checkpoint event or terminal', () => {
    for (const mutate of [
      (events) => { events[6].observedAt = '2026-09-08T00:00:20.000Z'; },
      (events) => { events[6].at = '2026-09-08T00:00:20.000Z'; }
    ]) {
      const events = validNewEvents();
      mutate(events);
      expect(() => validate(events)).toThrow(LiveEvidenceError);
    }
  });

  it('rejects profile stop before start and checkpoint outside its session lifecycle', () => {
    for (const mutate of [
      (events) => { [events[2], events[8]] = [events[8], events[2]]; },
      (events) => { [events[6], events[8]] = [events[8], events[6]]; }
    ]) {
      const events = validNewEvents();
      mutate(events);
      expect(() => validate(events)).toThrow(LiveEvidenceError);
    }
  });

  it('rejects a session alias whose worker prefix disagrees with workerAlias', () => {
    const events = validNewEvents();
    events[2].workerAlias = 'worker-2';
    events[8].workerAlias = 'worker-2';
    expect(() => validate(events)).toThrow(LiveEvidenceError);
  });

  it('rejects a recovered profile whose account-to-worker mapping changes', () => {
    const events = validNewEvents();
    events.splice(8, 0, profileStart(2, 1, 1), profileStop(2, 1, 1));
    expect(() => validate(stampEvents(events))).toThrow(LiveEvidenceError);
  });

  it('rejects health evidence containing account, mail, proxy, purchase, or task activity', () => {
    const mutations = [
      (events) => events.splice(-2, 0, accountTerminal(1, 1)),
      (events) => events.splice(-2, 0, base('mailbox-acquired', { workerAlias: 'worker-1', accountAlias: 'account-1' })),
      (events) => { events[1].activeProxies = 1; },
      (events) => events.splice(-2, 0, receipt(1, 1, 1)),
      (events) => { events[0].maxBillablePurchases = 1; }
    ];
    for (const mutate of mutations) {
      const events = structuredClone(validHealthEvents());
      mutate(events);
      expect(() => validateRolloutEvidence(events, {
        runId: RUN_ID, mode: 'health', expected: 3, stage: 3
      })).toThrow(LiveEvidenceError);
    }
  });

  it('rejects accountAlias on every health event type', () => {
    const events = validHealthEvents();
    events[1].accountAlias = 'account-1';
    expect(() => validateRolloutEvidence(events, {
      runId: RUN_ID, mode: 'health', expected: 3, stage: 3
    })).toThrow(LiveEvidenceError);
  });

  it('rejects resume evidence containing mailbox or purchase activity', () => {
    for (const event of [
      base('mailbox-acquired', { workerAlias: 'worker-1', accountAlias: 'account-1' }),
      base('purchase', {
        provider: 'gmail94', outcome: 'attempted', attempted: 1,
        confirmed: 0, ambiguous: 0, budget: 1
      })
    ]) {
      const events = validResumeEvents();
      events.splice(-2, 0, event);
      expect(() => validateRolloutEvidence(events, {
        runId: RUN_ID, mode: 'resume', expected: 3, stage: 3
      })).toThrow(LiveEvidenceError);
    }
  });
});

describe('exact artifact reader', () => {
  it('reads only the requested run artifact and ignores a convenience manifest', async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'rollout-evidence-'));
    tempDirs.push(userDataDir);
    const evidenceDir = path.join(userDataDir, 'rollout-evidence');
    await mkdir(evidenceDir);
    await writeFile(
      path.join(evidenceDir, RUN_ID + '.jsonl'),
      validNewEvents().map((event) => JSON.stringify(event)).join('\n') + '\n'
    );
    await writeFile(
      path.join(evidenceDir, 'last-run.json'),
      JSON.stringify({ runId: 'run-other', artifact: 'run-other.jsonl' })
    );

    await expect(validateRolloutEvidenceFile({
      runId: RUN_ID,
      userDataDir,
      expected: 1,
      stage: 1,
      mode: 'new'
    })).resolves.toMatchObject({ runId: RUN_ID });
  });

  it('rejects malformed JSONL and a missing exact artifact with evidence exit code', async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'rollout-evidence-'));
    tempDirs.push(userDataDir);
    const evidenceDir = path.join(userDataDir, 'rollout-evidence');
    await mkdir(evidenceDir);
    await writeFile(path.join(evidenceDir, RUN_ID + '.jsonl'), '{not-json}\n');

    await expect(validateRolloutEvidenceFile({
      runId: RUN_ID, userDataDir, expected: 1, stage: 1, mode: 'new'
    })).rejects.toBeInstanceOf(LiveEvidenceError);
    await expect(validateRolloutEvidenceFile({
      runId: 'run-missing', userDataDir, expected: 1, stage: 1, mode: 'new'
    })).rejects.toMatchObject({ exitCode: 4 });
  });
});
