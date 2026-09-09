import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AutomationRunService,
  type AutomationRunCollaborators,
  type AutomationRunTerminalSnapshot,
  type CapcutTaskRunner
} from '../AutomationRunService';
import { AutomationRunConfigSchema } from '../../../shared/schemas/automation.schema';
import type { AutomationWorkItem, AutomationWorkSourceFactory } from '../AutomationWorkSource';
import type { BrowserLauncher } from '../capcut/launcher';
// The validator is deliberately ESM JavaScript and imports the shared TS schema at runtime.
// @ts-expect-error no declaration file is emitted for the offline rollout script.
import { validateRolloutEvidence } from '../../../../scripts/verify-rollout-evidence.mjs';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('headed rollout service telemetry', () => {
  it('records truthful stage, lifecycle, resources, receipts, and purchase totals', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-rollout-run-'));
    directories.push(userDataDir);
    const items: AutomationWorkItem[] = Array.from({ length: 3 }, (_, index) => ({
      kind: 'new', sourceId: `mail-${index + 1}`, email: `mail${index + 1}@example.com`,
      emailProvider: 'gmail94', purchasedEmailId: `purchased-${index + 1}`, reservationId: `reservation-${index + 1}`
    }));
    const stats = { budget: 3, attempted: 3, confirmed: 3, ambiguous: 0 };
    const workSources: AutomationWorkSourceFactory = {
      create: (_config, _runId, onPurchaseEvent) => {
        for (let count = 1; count <= 3; count += 1) {
          onPurchaseEvent?.({ provider: 'gmail94', outcome: 'attempted', stats: {
            budget: 3, attempted: count, confirmed: count - 1, ambiguous: 0
          } });
          onPurchaseEvent?.({ provider: 'gmail94', outcome: 'confirmed', stats: {
            budget: 3, attempted: count, confirmed: count, ambiguous: 0
          } });
        }
        return {
          kind: 'finite', purchaseStats: () => stats,
          prepare: async () => ({ workerTarget: 3 }), next: async () => items.shift() ?? null,
          commit: () => {}, release: () => {}
        };
      }
    };
    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const requiredAfter = new Date().toISOString();
        await new Promise((resolve) => setTimeout(resolve, 2));
        const observedAt = new Date().toISOString();
        const receipt = {
          runId: input.runId!, sessionAlias: input.sessionAlias!, observedAt, requiredAfter,
          fresh: true, final: true, serverTotal: 12, serverDone: 12, complete: true
        };
        const keys = [
          'capcut_web_newbie_register', 'capcut_web_pwa_install', 'capcut_web_push_authorize',
          'capcut_web_design_studio_picture_creation', 'capcut_web_design_studio_ai_chat',
          'capcut_web_design_studio_upload_img', 'capcut_web_design_studio_canvas_edit',
          'capcut_web_inspiration_generate_done', 'capcut_web_video_studio_creation',
          'capcut_web_video_studio_send_msg', 'capcut_web_video_studio_generate_done',
          'capcut_web_video_studio_export'
        ];
        const rows = keys.map((key) => ({ key, title: key, reward: 10, status: 4 }));
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return { authenticated: true, done: 12, total: 12, credits: 120, creditsTotal: 120,
          missing: [], tasks: rows, unsettledProofs: [], verification: receipt };
      }
    };
    let account = 0;
    const service = new AutomationRunService({
      workSources, emailOtp: { readOtp: async () => '123456' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => ({ id: `account-db-${++account}` }), update: () => ({ success: true }) },
      logBus: { emit: () => {} }, launcher: () => launcher, capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-rollout-3' });
    const config = AutomationRunConfigSchema.parse({
      threadCount: 3, browser: 'multilogin', headless: false, retryCount: 0,
      stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
      module: 'credit', skipWithoutTrial: false,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'facebook' },
      proxy: { mode: 'direct', entries: ['10.0.0.1:80', '10.0.0.2:80', '10.0.0.3:80'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      rolloutStage: 3, mailLimit: 3, approvedMailboxes: 3, stopAfter: 3, maxBillablePurchases: 3
    });

    const started = await service.start(config);
    const summary = await service.waitForCompletion();

    expect(started).toEqual({ runId: 'run-rollout-3', artifactBasename: 'run-rollout-3.jsonl' });
    expect(summary.state).toBe('completed');
    const events = fs.readFileSync(path.join(userDataDir, 'rollout-evidence', started.artifactBasename!), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]).toMatchObject({ type: 'run-start', mode: 'new', stage: 3, maxBillablePurchases: 3 });
    expect(new Set(events.filter((event) => event.type === 'profile-start').map((event) => event.sessionAlias)).size).toBe(3);
    expect(events.filter((event) => event.type === 'profile-stop')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'mailbox-acquired')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'task-checkpoint')).toHaveLength(3);
    expect(events.some((event) => event.type === 'resource-snapshot' && Number(event.activeProfiles) > 0)).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'terminal', mode: 'new', stage: 3, mailboxAcquisitions: 3,
      accepted: 3, completed: 3, purchaseAttempted: 3, purchaseConfirmed: 3, purchaseAmbiguous: 0
    });
    expect(validateRolloutEvidence(events, {
      runId: 'run-rollout-3', expected: 3, stage: 3, mode: 'new'
    })).toMatchObject({ runId: 'run-rollout-3', accounts: 3, sessions: 3 });
  });

  it('records a validator-clean stage-3 resume artifact without mailbox acquisition', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-rollout-resume-'));
    directories.push(userDataDir);
    const items: AutomationWorkItem[] = Array.from({ length: 3 }, (_, index) => ({
      kind: 'existing', sourceId: `existing:db-${index + 1}`, accountId: `db-${index + 1}`,
      email: `existing${index + 1}@example.com`, emailProvider: 'manual', capcutPassword: `SavedPass${index + 1}`
    }));
    const workSources: AutomationWorkSourceFactory = {
      create: () => ({
        kind: 'finite', purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
        prepare: async () => ({ workerTarget: 3 }), next: async () => items.shift() ?? null,
        commit: () => {}, release: () => {}
      })
    };
    let profile = 0;
    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `resume-profile-${++profile}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };
    const keys = [
      'capcut_web_newbie_register', 'capcut_web_pwa_install', 'capcut_web_push_authorize',
      'capcut_web_design_studio_picture_creation', 'capcut_web_design_studio_ai_chat',
      'capcut_web_design_studio_upload_img', 'capcut_web_design_studio_canvas_edit',
      'capcut_web_inspiration_generate_done', 'capcut_web_video_studio_creation',
      'capcut_web_video_studio_send_msg', 'capcut_web_video_studio_generate_done',
      'capcut_web_video_studio_export'
    ];
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        const requiredAfter = new Date().toISOString();
        await new Promise((resolve) => setTimeout(resolve, 2));
        const receipt = {
          runId: input.runId!, sessionAlias: input.sessionAlias!, observedAt: new Date().toISOString(), requiredAfter,
          fresh: true, final: true, serverTotal: 12, serverDone: 12, complete: true
        };
        const rows = keys.map((key) => ({ key, title: key, reward: 10, status: 4 }));
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return { authenticated: true, done: 12, total: 12, credits: 120, creditsTotal: 120,
          missing: [], tasks: rows, unsettledProofs: [], verification: receipt };
      }
    };
    const service = new AutomationRunService({
      workSources, emailOtp: { readOtp: async () => { throw new Error('resume must not read OTP'); } },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('resume must not create accounts'); }, update: () => ({ success: true }) },
      logBus: { emit: () => {} }, launcher: () => launcher, capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-resume-3' });
    const config = AutomationRunConfigSchema.parse({
      threadCount: 3, browser: 'multilogin', headless: false, retryCount: 0,
      stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
      module: 'credit', skipWithoutTrial: false,
      emailSource: { mode: 'existing', accountIds: ['db-1', 'db-2', 'db-3'] },
      proxy: { mode: 'direct', entries: ['10.0.0.1:80', '10.0.0.2:80', '10.0.0.3:80'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      rolloutStage: 3, maxBillablePurchases: 0
    });

    const started = await service.start(config);
    const summary = await service.waitForCompletion();
    const events = fs.readFileSync(path.join(userDataDir, 'rollout-evidence', started.artifactBasename!), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(summary.state).toBe('completed');
    expect(events.filter((event) => event.type === 'mailbox-acquired')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: 'terminal', mode: 'resume', code: 'MANUAL_EXHAUSTED', mailboxAcquisitions: 0
    });
    expect(validateRolloutEvidence(events, {
      runId: 'run-resume-3', expected: 3, stage: 3, mode: 'resume'
    })).toMatchObject({ runId: 'run-resume-3', accounts: 3, sessions: 3 });
  });

  it('fails closed before source preparation when the evidence sink rejects run-start', async () => {
    let sourceCreated = false;
    const telemetry = {
      record: () => { throw new Error('disk path must not leak'); },
      close: async () => {},
      filePath: () => 'unused',
      artifactBasename: () => 'run-write-failure.jsonl'
    };
    const service = new AutomationRunService({
      workSources: { create: () => { sourceCreated = true; throw new Error('must not create'); } },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: { create: () => { throw new Error('unused'); }, update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never }
    }, { userDataDir: 'unused', nextId: () => 'run-write-failure', createTelemetry: () => telemetry });
    const config = AutomationRunConfigSchema.parse({
      threadCount: 3, browser: 'multilogin', headless: false, retryCount: 0,
      stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
      module: 'credit', skipWithoutTrial: false,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'facebook' },
      proxy: { mode: 'direct', entries: ['10.0.0.1:80', '10.0.0.2:80', '10.0.0.3:80'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      rolloutStage: 3, mailLimit: 3, approvedMailboxes: 3, stopAfter: 3, maxBillablePurchases: 3
    });

    await expect(service.start(config)).rejects.toMatchObject({ reason: { code: 'INTERNAL_ERROR' } });
    expect(sourceCreated).toBe(false);
    expect(service.getProgress()).toMatchObject({ state: 'failed', terminalReason: { code: 'INTERNAL_ERROR' } });
  });

  it('cleans every accepted item when mailbox evidence fails during account setup', async () => {
    const items: AutomationWorkItem[] = Array.from({ length: 3 }, (_, index) => ({
      kind: 'new', sourceId: `item-${index + 1}`, email: `item${index + 1}@example.com`,
      emailProvider: 'gmail94', purchasedEmailId: `p-${index + 1}`, reservationId: `r-${index + 1}`
    }));
    let released = 0;
    const service = new AutomationRunService({
      workSources: {
        create: () => ({
          kind: 'finite', purchaseStats: () => ({ budget: 3, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async () => ({ workerTarget: 3 }), next: async () => items.shift() ?? null,
          commit: () => {}, release: () => { released += 1; }
        })
      },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('must not launch'); }, stopProfile: async () => {} },
      accounts: { create: (() => { let id = 0; return () => ({ id: `setup-${++id}` }); })(), update: () => ({ success: true }) },
      logBus: { emit: () => ({}) as never }
    }, {
      userDataDir: 'unused', nextId: () => 'run-mailbox-evidence-fail',
      createTelemetry: () => ({
        record: (event) => { if (event.type === 'mailbox-acquired') throw new Error('evidence failed'); },
        close: async () => {}, filePath: () => 'unused', artifactBasename: () => 'run.jsonl'
      })
    });
    const config = AutomationRunConfigSchema.parse({
      threadCount: 3, browser: 'multilogin', headless: false, retryCount: 0,
      stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
      module: 'credit', skipWithoutTrial: false,
      emailSource: { mode: 'api', provider: 'gmail94' },
      proxy: { mode: 'direct', entries: ['10.0.0.1:80', '10.0.0.2:80', '10.0.0.3:80'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      rolloutStage: 3, mailLimit: 3, approvedMailboxes: 3, stopAfter: 3, maxBillablePurchases: 3
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    expect(released).toBe(3);
    expect(summary.workersActive).toBe(0);
    expect(summary.accountsAccepted).toBe(3);
    expect(summary.accountsFailed).toBe(3);
  });

  it('commits the accepted account failure and drains resources when telemetry stays poisoned', async () => {
    const items: AutomationWorkItem[] = [{
      kind: 'new', sourceId: 'poisoned-item', email: 'poisoned@example.com',
      emailProvider: 'gmail94', purchasedEmailId: 'poisoned-purchase', reservationId: 'poisoned-reservation'
    }];
    const terminalUpdates: string[] = [];
    let released = 0;
    let poisoned = false;
    let terminalSnapshot: AutomationRunTerminalSnapshot | undefined;
    let rejectedClose = 0;
    const service = new AutomationRunService({
      workSources: {
        create: () => ({
          kind: 'finite', purchaseStats: () => ({ budget: 1, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async () => ({ workerTarget: 1 }), next: async () => items.shift() ?? null,
          commit: () => {}, release: () => { released += 1; }
        })
      },
      emailOtp: { readOtp: async () => null },
      proxies: { acquire: async () => { throw new Error('unused'); }, release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('must not launch'); }, stopProfile: async () => {} },
      accounts: {
        create: () => ({ id: 'poisoned-account' }),
        update: (_id, patch) => {
          if (patch.status === 'done' || patch.status === 'error' || patch.status === 'stopped') {
            terminalUpdates.push(patch.status);
          }
          return { success: true };
        }
      },
      logBus: { emit: () => ({}) as never }
    }, {
      userDataDir: 'unused', nextId: () => 'run-poisoned-evidence',
      onTerminalSnapshot: (snapshot) => { terminalSnapshot = snapshot; },
      createTelemetry: () => ({
        record: (event) => {
          if (poisoned) throw new Error('recorder remains poisoned');
          if (event.type === 'mailbox-acquired') {
            poisoned = true;
            throw new Error('recorder became poisoned');
          }
        },
        close: async () => {
          rejectedClose += 1;
          throw new Error('poisoned recorder cannot close');
        },
        filePath: () => 'no-successful-artifact', artifactBasename: () => 'no-successful-artifact.jsonl'
      })
    });
    const config = AutomationRunConfigSchema.parse({
      threadCount: 1, browser: 'multilogin', headless: false, retryCount: 0,
      stepDelayMinMs: 0, stepDelayMaxMs: 0, typeDelayMinMs: 0, typeDelayMaxMs: 0,
      module: 'credit', skipWithoutTrial: false,
      emailSource: { mode: 'api', provider: 'gmail94' },
      proxy: { mode: 'direct', entries: ['10.0.0.1:80'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      rolloutStage: 1, mailLimit: 1, approvedMailboxes: 1, stopAfter: 1, maxBillablePurchases: 1
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    expect(summary).toMatchObject({
      state: 'failed', workersActive: 0, accountsAccepted: 1,
      accountsCompleted: 0, accountsFailed: 1, accountsStopped: 0
    });
    expect(terminalUpdates).toEqual(['error']);
    expect(released).toBe(1);
    expect(rejectedClose).toBe(1);
    expect(terminalSnapshot).toMatchObject({
      activeThreads: 0, activeProfiles: 0, activeProxies: 0, activeMailReservations: 0
    });
  });
});
