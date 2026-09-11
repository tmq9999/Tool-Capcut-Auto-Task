import { describe, expect, it, vi, afterEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../database/migrator';
import { AccountTaskRepository } from '../../../repositories/AccountTaskRepository';
import { createTaskProgressSink } from '../../../runtime/providerStack';
import { executeHttpTasks, LEAF_TASKS, TaskListResponseError } from '../httpTasks';
import { TaskEvidenceError } from '../TaskEvidenceError';
import {
  AutomationRunService,
  type IAccountSink,
  type IProxyLeaseSource,
  type CapcutTaskRunner,
  type ICapcutTaskProgressSink,
  type CapcutAccountResult
} from '../../AutomationRunService';
import { LogBus } from '../../LogBus';
import type { BrowserLauncher, LaunchedProfile } from '../launcher';
import { ProfileStopError } from '../launcher/ProfileStopError';
import type { AutomationWorkSourceFactory, AutomationWorkItem } from '../../AutomationWorkSource';
import { AutomationRunConfigSchema } from '../../../../shared/schemas/automation.schema';
import type { CapcutUiAccountResult, CapcutVerificationReceipt, UnsettledTaskProof } from '../types';
import type { AutomationEvidenceTerminalEvent } from '../../../../shared/schemas/automation-evidence.schema';
import type { RunTelemetry } from '../../capcut/runTelemetry';
import type { AcquiredProxyLease } from '../../ProxyLeaseManager';

describe('R10 / N08: Late run scenario & tail faults verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unit: executes http tasks and captures 9 unsettled proofs on malformed or duplicate task_list responses', async () => {
    async function runAccountWithTaskList(listBody: unknown, listStatus = 200) {
      let clock = 2000;
      vi.spyOn(Date, 'now').mockImplementation(() => clock++);
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/account/info/')) {
          return new Response(JSON.stringify({ data: { user_id_str: '999888777' } }), { status: 200 });
        }
        if (url.includes('/do_action')) {
          return new Response(JSON.stringify({ err_no: 0, err_tips: '' }), { status: 200 });
        }
        if (url.includes('/task_list')) {
          return new Response(JSON.stringify(listBody), { status: listStatus });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const page = {
        evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg),
        goto: async () => {}
      } as unknown as Page;

      const taskResult = await executeHttpTasks({
        page,
        log: () => {},
        signal: new AbortController().signal,
        actionDelayMs: 0,
        sessionStartedAt: 1000
      });

      return { taskResult, fetchMock };
    }

    // Malformed task row
    const malformedList = {
      err_no: 0,
      data: {
        task_list: [
          ...LEAF_TASKS.slice(0, 5).map((key, i) => ({
            task_key: key,
            task_id: i + 1,
            task_status: 4,
            task_reward_view: { reward_amount: 50 },
            task_view: { title: key }
          })),
          null // Malformed row
        ]
      }
    };
    const acc9Run = await runAccountWithTaskList(malformedList);
    expect(acc9Run.taskResult.snapshot).toBeNull();
    expect(acc9Run.taskResult.fatalError).toBeInstanceOf(TaskListResponseError);
    expect((acc9Run.taskResult.fatalError as TaskListResponseError).diagnostic.reason).toBe('TASK_ROW_INVALID');
    expect(acc9Run.taskResult.unsettledProofs).toHaveLength(9);

    // Duplicate task key
    const duplicateKeyList = {
      err_no: 0,
      data: {
        task_list: [
          {
            task_key: 'capcut_web_pwa_install',
            task_id: 101,
            task_status: 4,
            task_reward_view: { reward_amount: 50 },
            task_view: { title: 'PWA' }
          },
          {
            task_key: 'capcut_web_pwa_install', // Duplicate
            task_id: 102,
            task_status: 4,
            task_reward_view: { reward_amount: 50 },
            task_view: { title: 'PWA Duplicate' }
          }
        ]
      }
    };
    const acc10Run = await runAccountWithTaskList(duplicateKeyList);
    expect(acc10Run.taskResult.snapshot).toBeNull();
    expect(acc10Run.taskResult.fatalError).toBeInstanceOf(TaskListResponseError);
    expect((acc10Run.taskResult.fatalError as TaskListResponseError).diagnostic.reason).toBe('TASK_DUPLICATE_KEY');
    expect(acc10Run.taskResult.unsettledProofs).toHaveLength(9);
  });

  class TrackingAccounts implements IAccountSink {
    public created: Array<{ id: string; email?: string }> = [];
    public updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    private counter = 0;

    create(data?: { email?: string }): { id: string } {
      this.counter += 1;
      const id = `db-acc-${this.counter}`;
      this.created.push({ id, email: data?.email });
      return { id };
    }

    update(id: string, data: Record<string, unknown>): { success: boolean } {
      this.updates.push({ id, data });
      return { success: true };
    }
  }

  class TrackingLauncher implements BrowserLauncher {
    public readonly name = 'xcli' as const;
    public launchedProfiles: string[] = [];
    public stoppedProfiles: string[] = [];
    public stopCalls: string[] = [];
    public failStopFor = new Set<string>();
    private counter = 0;

    async launch(options?: { onProfileStarted?: (id: string) => void }): Promise<LaunchedProfile> {
      this.counter += 1;
      const profileId = `profile-${this.counter}`;
      options?.onProfileStarted?.(profileId);
      this.launchedProfiles.push(profileId);
      return {
        page: {} as unknown as Page,
        context: {} as unknown as BrowserContext,
        port: 60000 + this.counter,
        profileId
      };
    }

    async stop(profileId: string): Promise<void> {
      this.stopCalls.push(profileId);
      if (this.failStopFor.has(profileId)) {
        throw new ProfileStopError({
          phase: 'stop-request',
          kind: 'provider-error',
          httpStatus: 500
        }, undefined, `Profile stop failed for ${profileId}`);
      }
      this.stoppedProfiles.push(profileId);
    }
  }

  class TrackingProxySource implements IProxyLeaseSource {
    public acquired = 0;
    public released = 0;
    public activeLeases = new Set<string>();
    async acquire(): Promise<AcquiredProxyLease> {
      this.acquired += 1;
      const leaseId = `lease-${this.acquired}`;
      this.activeLeases.add(leaseId);
      return {
        leaseId,
        keyValue: `key-${this.acquired}`,
        ip: '127.0.0.1',
        host: '127.0.0.1',
        port: 9000,
        protocol: 'http',
        username: 'user',
        password: 'pwd',
        nextChangeSeconds: 60
      };
    }
    async release(lease: AcquiredProxyLease): Promise<void> {
      this.released += 1;
      this.activeLeases.delete(lease.leaseId);
    }
    async releaseAll(): Promise<void> {
      this.released += this.activeLeases.size;
      this.activeLeases.clear();
    }
  }

  class TrackingTaskProgressSink implements ICapcutTaskProgressSink {
    public checkpoints: Array<{ accountId: string; checkpoint: unknown }> = [];
    public unsettled: Array<{ accountId: string; runId: string; proofs: readonly UnsettledTaskProof[] }> = [];

    async record(accountId: string, checkpoint: {
      rows: CapcutAccountResult['tasks'];
      receipt: CapcutVerificationReceipt;
      unsettledProofs: readonly UnsettledTaskProof[];
    }): Promise<void> {
      this.checkpoints.push({ accountId, checkpoint });
    }

    async recordUnsettled(accountId: string, runId: string, proofs: readonly UnsettledTaskProof[]): Promise<void> {
      this.unsettled.push({ accountId, runId, proofs });
    }
  }

  it('runtime: executes actual AutomationRunService for 10 accounts proving tail faults, persistence sink and resource cleanup', async () => {
    const rawAccounts = Array.from({ length: 10 }, (_, i) => ({
      email: `acc-${i + 1}@capcut.test`,
      password: `pwd-${i + 1}`
    }));

    const workSources: AutomationWorkSourceFactory = {
      create: (_config) => {
        const items: AutomationWorkItem[] = rawAccounts.map((acc, i) => ({
          kind: 'new',
          sourceId: `src-${i + 1}`,
          email: acc.email,
          emailPassword: acc.password,
          emailProvider: 'manual'
        }));
        return {
          kind: 'finite',
          purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }
    };

    const accounts = new TrackingAccounts();
    const launcher = new TrackingLauncher();
    const proxies = new TrackingProxySource();
    const taskProgress = new TrackingTaskProgressSink();

    // Helper for accounts #9 and #10 to run executeHttpTasks with per-account fake fetch
    async function runAccountHttp(listBody: unknown, signal: AbortSignal, ordinal: number) {
      const accountUserId = `99988877${ordinal.toString().padStart(2, '0')}`;
      const accountFetch = async (url: string) => {
        if (url.includes('/account/info/')) {
          return new Response(JSON.stringify({ data: { user_id_str: accountUserId } }), { status: 200 });
        }
        if (url.includes('/do_action')) {
          return new Response(JSON.stringify({ err_no: 0, err_tips: '' }), { status: 200 });
        }
        if (url.includes('/task_list')) {
          return new Response(JSON.stringify(listBody), { status: 200 });
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const page = {
        evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => {
          const prev = globalThis.fetch;
          try {
            globalThis.fetch = accountFetch as unknown as typeof fetch;
            return await fn(arg);
          } finally {
            globalThis.fetch = prev;
          }
        },
        goto: async () => {}
      } as unknown as Page;

      return executeHttpTasks({
        page,
        log: () => {},
        signal,
        actionDelayMs: 0,
        sessionStartedAt: 1000
      });
    }

    const capcutRunner: CapcutTaskRunner = {
      runAccount: async (input) => {
        // Parse ordinal from email e.g. "acc-1@capcut.test" -> 1
        const match = input.email.match(/^acc-(\d+)@/);
        const ordinal = match ? parseInt(match[1], 10) : 0;

        // Account #1: Intentional trial skip
        if (ordinal === 1) {
          return {
            authenticated: true,
            skipped: true,
            accountNotEligible: true,
            done: 0,
            total: 0,
            credits: 0,
            creditsTotal: 0,
            missing: [],
            tasks: [],
            unsettledProofs: [],
            verification: {
              runId: input.runId ?? 'scenario-run-1',
              sessionAlias: input.accountId,
              observedAt: '2026-09-11T00:00:00.000Z',
              requiredAfter: '2026-09-11T00:00:00.000Z',
              fresh: true,
              final: true,
              source: 'ineligible-skip',
              user_id_str: '0',
              serverTotal: 0,
              serverDone: 0,
              complete: false
            }
          };
        }

        // Accounts #2–7: 6 Healthy completed accounts
        if (ordinal >= 2 && ordinal <= 7) {
          const result: CapcutUiAccountResult = {
            authenticated: true,
            done: 2,
            total: 2,
            credits: 150,
            creditsTotal: 150,
            missing: [],
            tasks: [
              { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4 },
              { key: 'capcut_web_video_studio_export', title: 'Export video', reward: 120, status: 4 }
            ],
            verification: {
              runId: input.runId ?? 'scenario-run-1',
              sessionAlias: input.accountId,
              observedAt: '2026-09-11T00:00:00.000Z',
              requiredAfter: '2026-09-11T00:00:00.000Z',
              fresh: true,
              final: true,
              serverTotal: 2,
              serverDone: 2,
              complete: true
            },
            unsettledProofs: []
          };
          if (input.onTaskCheckpoint) {
            await input.onTaskCheckpoint({
              rows: result.tasks,
              receipt: result.verification!,
              unsettledProofs: []
            });
          }
          return result;
        }

        // Account #8: Typed auth failure
        if (ordinal === 8) {
          throw new Error('AUTHENTICATION_FAILED: Post-OTP landing on public homepage');
        }

        // Account #9: 9 do_action acks, malformed task_list row
        if (ordinal === 9) {
          const malformedList = {
            err_no: 0,
            data: {
              task_list: [
                ...LEAF_TASKS.slice(0, 5).map((key, i) => ({
                  task_key: key,
                  task_id: i + 1,
                  task_status: 4,
                  task_reward_view: { reward_amount: 50 },
                  task_view: { title: key }
                })),
                null
              ]
            }
          };
          const execRes = await runAccountHttp(malformedList, input.signal ?? new AbortController().signal, ordinal);
          if (!execRes.snapshot) {
            throw new TaskEvidenceError(
              execRes.fatalError?.message ?? 'TASK_ROW_INVALID',
              execRes.unsettledProofs,
              { cause: execRes.fatalError }
            );
          }
          throw new Error('Expected task failure for account #9');
        }

        // Account #10: 9 do_action acks, duplicate task_key in task_list
        if (ordinal === 10) {
          const duplicateKeyList = {
            err_no: 0,
            data: {
              task_list: [
                {
                  task_key: 'capcut_web_pwa_install',
                  task_id: 101,
                  task_status: 4,
                  task_reward_view: { reward_amount: 50 },
                  task_view: { title: 'PWA' }
                },
                {
                  task_key: 'capcut_web_pwa_install', // Duplicate
                  task_id: 102,
                  task_status: 4,
                  task_reward_view: { reward_amount: 50 },
                  task_view: { title: 'PWA Duplicate' }
                }
              ]
            }
          };
          const execRes = await runAccountHttp(duplicateKeyList, input.signal ?? new AbortController().signal, ordinal);
          if (!execRes.snapshot) {
            throw new TaskEvidenceError(
              execRes.fatalError?.message ?? 'TASK_DUPLICATE_KEY',
              execRes.unsettledProofs,
              { cause: execRes.fatalError }
            );
          }
          throw new Error('Expected task failure for account #10');
        }

        throw new Error(`Unexpected account ordinal ${ordinal}`);
      }
    };

    let recordedTerminalEvent: AutomationEvidenceTerminalEvent | null = null;
    const fakeTelemetry = {
      runId: 'scenario-run-1',
      artifactBasename: () => 'telemetry-scenario-run-1',
      record: () => {},
      close: async (event: AutomationEvidenceTerminalEvent) => {
        recordedTerminalEvent = event;
      }
    } as unknown as RunTelemetry;

    const service = new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => '123456' },
        proxies,
        browser: {
          startProfile: async () => { throw new Error('Not used'); },
          stopProfile: async () => {}
        },
        accounts,
        logBus: new LogBus({ insertBatch: () => {} }),
        launcher: () => launcher,
        capcut: capcutRunner,
        taskProgress
      },
      {
        sleep: async () => {},
        nextId: () => 'scenario-run-1',
        createTelemetry: () => fakeTelemetry
      }
    );

    const config = AutomationRunConfigSchema.parse({
      threadCount: 2,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'manual',
        entries: rawAccounts.map((a) => `${a.email}|${a.password}`)
      },
      proxy: { mode: 'direct', entries: [] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      testDurationMs: 0
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    // 1. Assert exact runtime counters
    expect(summary.accountsAccepted).toBe(10);
    expect(summary.accountsCompleted).toBe(6);
    expect(summary.accountsFailed).toBe(3);
    expect(summary.accountsStopped).toBe(0);

    // 2. Assert internal skipped counter and terminal evidence if active
    expect((service as unknown as { skippedAccounts: number }).skippedAccounts).toBe(1);
    const terminalEv = recordedTerminalEvent as AutomationEvidenceTerminalEvent | null;
    if (terminalEv) {
      expect(terminalEv.accepted).toBe(10);
      expect(terminalEv.completed).toBe(6);
      expect(terminalEv.failed).toBe(3);
      expect(terminalEv.skipped).toBe(1);
      expect(terminalEv.stopped).toBe(0);
    }

    // 2. Assert taskProgress sink persistence:
    // Exactly 6 checkpoints recorded for healthy accounts #2–7
    expect(taskProgress.checkpoints).toHaveLength(6);

    // Accounts #9 and #10 stream their 9 accepted proofs each
    const acc9Unsettled = taskProgress.unsettled.filter((u) => u.accountId === 'db-acc-9');
    const acc10Unsettled = taskProgress.unsettled.filter((u) => u.accountId === 'db-acc-10');
    expect(acc9Unsettled.flatMap((u) => u.proofs)).toHaveLength(9);
    expect(acc10Unsettled.flatMap((u) => u.proofs)).toHaveLength(9);

    const totalUnsettled = taskProgress.unsettled.reduce((sum, item) => sum + item.proofs.length, 0);
    expect(totalUnsettled).toBe(18);

    // 3. Resource cleanup: every launched profile was cleanly stopped
    expect(launcher.launchedProfiles.length).toBeGreaterThan(0);
    expect(launcher.launchedProfiles.length).toBe(launcher.stoppedProfiles.length);
    expect(launcher.launchedProfiles.sort()).toEqual(launcher.stoppedProfiles.sort());
  });

  it('P06.1–P06.3 (engine-seam): reproduces the live incident cascade: 3 completed in wave 1, then wave 2: A (9 acks) + hydration timeout + stop fail cascades to safety abort of B (4 acks) and C (trial pending)', async () => {
    const rawAccounts = Array.from({ length: 6 }, (_, i) => ({
      email: `wave-acc-${i + 1}@capcut.test`,
      password: `pwd-${i + 1}`
    }));

    const workSources: AutomationWorkSourceFactory = {
      create: (_config) => {
        const items: AutomationWorkItem[] = rawAccounts.map((acc, i) => ({
          kind: 'new',
          sourceId: `src-${i + 1}`,
          email: acc.email,
          emailPassword: acc.password,
          emailProvider: 'manual'
        }));
        return {
          kind: 'finite',
          purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }
    };

    const accounts = new TrackingAccounts();
    const launcher = new TrackingLauncher();
    const proxies = new TrackingProxySource();
    const taskProgress = new TrackingTaskProgressSink();

    // Profiles for wave 2 fail profile stop
    launcher.failStopFor.add('profile-4');
    launcher.failStopFor.add('profile-5');
    launcher.failStopFor.add('profile-6');

    let resolveBReady!: () => void;
    const bReady = new Promise<void>((resolve) => {
      resolveBReady = resolve;
    });
    let resolveCReady!: () => void;
    const cReady = new Promise<void>((resolve) => {
      resolveCReady = resolve;
    });

    const capcutRunner: CapcutTaskRunner = {
      runAccount: async (input) => {
        const match = input.email.match(/^wave-acc-(\d+)@/);
        const ordinal = match ? parseInt(match[1], 10) : 0;

        // Wave 1: Accounts 1, 2, 3 complete cleanly with 12/12
        if (ordinal >= 1 && ordinal <= 3) {
          const result: CapcutUiAccountResult = {
            authenticated: true,
            done: 12,
            total: 12,
            credits: 670,
            creditsTotal: 670,
            missing: [],
            tasks: LEAF_TASKS.map((k) => ({ key: k, title: k, reward: 50, status: 4 })),
            verification: {
              runId: input.runId ?? 'scenario-run-6',
              sessionAlias: input.accountId,
              observedAt: '2026-09-11T00:00:00.000Z',
              requiredAfter: '2026-09-11T00:00:00.000Z',
              fresh: true,
              final: true,
              serverTotal: 12,
              serverDone: 12,
              complete: true
            },
            unsettledProofs: []
          };
          if (input.onTaskCheckpoint) {
            await input.onTaskCheckpoint({
              rows: result.tasks,
              receipt: result.verification!,
              unsettledProofs: []
            });
          }
          return result;
        }

        // Wave 2:
        // Worker B (Account 5): streams 4 acks, then notifies ready, then awaits abort
        if (ordinal === 5) {
          for (let i = 0; i < 4; i++) {
            const key = LEAF_TASKS[i];
            const proof = {
              key,
              errNo: 0 as const,
              actionKey: key,
              opId: `op-${key}-${ordinal}`,
              errTips: '',
              at: Date.now()
            };
            await input.onAcceptedProof?.({ key, proof });
          }
          resolveBReady();
          await new Promise<void>((_, reject) => {
            input.signal.addEventListener('abort', () => reject(input.signal.reason));
          });
        }

        // Worker C (Account 6): trial pending wait, notifies ready, then awaits abort
        if (ordinal === 6) {
          resolveCReady();
          await new Promise<void>((_, reject) => {
            input.signal.addEventListener('abort', () => reject(input.signal.reason));
          });
        }

        // Worker A (Account 4): streams 9 acks, waits for B & C to be ready, then fails with TaskEvidenceError
        if (ordinal === 4) {
          const unsettledA: UnsettledTaskProof[] = [];
          for (let i = 0; i < 9; i++) {
            const key = LEAF_TASKS[i];
            const proof = {
              key,
              errNo: 0 as const,
              actionKey: key,
              opId: `op-${key}-${ordinal}`,
              errTips: '',
              at: Date.now()
            };
            const item: UnsettledTaskProof = { key, proof };
            unsettledA.push(item);
            await input.onAcceptedProof?.(item);
          }
          await Promise.all([bReady, cReady]);

          throw new TaskEvidenceError(
            'DOM_READ_TIMEOUT: http-task-popup:visible',
            unsettledA,
            {
              diagnostic: {
                phase: 'initial',
                reason: 'TASK_LIST_MISSING',
                httpStatus: 200,
                errNo: 0,
                recoveryStage: 'popup-after-hydration'
              }
            }
          );
        }

        throw new Error(`Unexpected ordinal ${ordinal}`);
      }
    };

    const service = new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => '123456' },
        proxies,
        browser: {
          startProfile: async () => {
            throw new Error('Not used');
          },
          stopProfile: async () => {}
        },
        accounts,
        logBus: new LogBus({ insertBatch: () => {} }),
        launcher: () => launcher,
        capcut: capcutRunner,
        taskProgress
      },
      {
        sleep: async () => {},
        nextId: () => 'scenario-run-p06'
      }
    );

    const config = AutomationRunConfigSchema.parse({
      threadCount: 3,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'manual',
        entries: rawAccounts.map((a) => `${a.email}|${a.password}`)
      },
      proxy: { mode: 'proxykey', keys: ['k1', 'k2', 'k3'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      testDurationMs: 0
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    // Spec P06.2: exact observations
    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
    expect(summary.accountsAccepted).toBe(6);
    expect(summary.accountsCompleted).toBe(3);
    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsStopped).toBe(2);

    // Persisted unsettled proofs
    const acc4Unsettled = taskProgress.unsettled.filter((u) => u.accountId === 'db-acc-4');
    expect(acc4Unsettled.length).toBeGreaterThanOrEqual(1);
    const acc4Keys = new Set(acc4Unsettled.flatMap((u) => u.proofs.map((p) => p.key)));
    expect(acc4Keys.size).toBe(9);

    const acc5Unsettled = taskProgress.unsettled.filter((u) => u.accountId === 'db-acc-5');
    expect(acc5Unsettled.length).toBeGreaterThanOrEqual(1);
    const acc5Keys = new Set(acc5Unsettled.flatMap((u) => u.proofs.map((p) => p.key)));
    expect(acc5Keys.size).toBe(4);

    const acc6Unsettled = taskProgress.unsettled.filter((u) => u.accountId === 'db-acc-6');
    expect(acc6Unsettled).toHaveLength(0);

    // Only 3 checkpoints for the 3 completed accounts
    expect(taskProgress.checkpoints).toHaveLength(3);

    // 3 retained profiles (cleanup failures = 3)
    expect(service.getRunningThreads()).toHaveLength(3);
    expect(proxies.activeLeases.size).toBe(3);

    // Peer updates: marked stopped with system cleanup message
    const peerUpdates = accounts.updates.filter((u) => u.id === 'db-acc-5' || u.id === 'db-acc-6');
    const stoppedPeerSteps = peerUpdates.filter((u) => u.data.status === 'stopped').map((u) => u.data.automationStep);
    for (const step of stoppedPeerSteps) {
      expect(step).toBe('Đã dừng vì lỗi thu hồi browser của phiên chạy');
      expect(step).not.toBe('Đã dừng theo yêu cầu');
    }

    // Subsequent stop call: no extra stop retries or releases
    const stopCallsBefore = launcher.stopCalls.length;
    await service.stop();
    expect(launcher.stopCalls.length).toBe(stopCallsBefore);
    expect(service.getRunningThreads()).toHaveLength(3);
    expect(proxies.activeLeases.size).toBe(3);
  });

  it('P06.3 companion: proves ordinary account failure without stop cleanup failure does NOT abort peer workers', async () => {
    const rawAccounts = Array.from({ length: 6 }, (_, i) => ({
      email: `comp-acc-${i + 1}@capcut.test`,
      password: `pwd-${i + 1}`
    }));

    const workSources: AutomationWorkSourceFactory = {
      create: (_config) => {
        const items: AutomationWorkItem[] = rawAccounts.map((acc, i) => ({
          kind: 'new',
          sourceId: `src-${i + 1}`,
          email: acc.email,
          emailPassword: acc.password,
          emailProvider: 'manual'
        }));
        return {
          kind: 'finite',
          purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }
    };

    const accounts = new TrackingAccounts();
    const launcher = new TrackingLauncher();
    const proxies = new TrackingProxySource();
    const taskProgress = new TrackingTaskProgressSink();

    const capcutRunner: CapcutTaskRunner = {
      runAccount: async (input) => {
        const match = input.email.match(/^comp-acc-(\d+)@/);
        const ordinal = match ? parseInt(match[1], 10) : 0;

        // Account 4 fails with task error, but stop profile will SUCCEED
        if (ordinal === 4) {
          throw new TaskEvidenceError('TASK_LIST_MISSING', [], {
            diagnostic: { phase: 'initial', reason: 'TASK_LIST_MISSING', httpStatus: 200, errNo: 0 }
          });
        }

        // All other accounts complete 12/12 cleanly
        const result: CapcutUiAccountResult = {
          authenticated: true,
          done: 12,
          total: 12,
          credits: 670,
          creditsTotal: 670,
          missing: [],
          tasks: LEAF_TASKS.map((k) => ({ key: k, title: k, reward: 50, status: 4 })),
          verification: {
            runId: input.runId ?? 'scenario-run-comp',
            sessionAlias: input.accountId,
            observedAt: '2026-09-11T00:00:00.000Z',
            requiredAfter: '2026-09-11T00:00:00.000Z',
            fresh: true,
            final: true,
            serverTotal: 12,
            serverDone: 12,
            complete: true
          },
          unsettledProofs: []
        };
        if (input.onTaskCheckpoint) {
          await input.onTaskCheckpoint({
            rows: result.tasks,
            receipt: result.verification!,
            unsettledProofs: []
          });
        }
        return result;
      }
    };

    const service = new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => '123456' },
        proxies,
        browser: {
          startProfile: async () => {
            throw new Error('Not used');
          },
          stopProfile: async () => {}
        },
        accounts,
        logBus: new LogBus({ insertBatch: () => {} }),
        launcher: () => launcher,
        capcut: capcutRunner,
        taskProgress
      },
      {
        sleep: async () => {},
        nextId: () => 'scenario-run-comp'
      }
    );

    const config = AutomationRunConfigSchema.parse({
      threadCount: 3,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'manual',
        entries: rawAccounts.map((a) => `${a.email}|${a.password}`)
      },
      proxy: { mode: 'proxykey', keys: ['k1', 'k2', 'k3'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      testDurationMs: 0
    });

    await service.start(config);
    const summary = await service.waitForCompletion();

    // 1 failed, 5 completed, 0 stopped
    expect(summary.accountsAccepted).toBe(6);
    expect(summary.accountsCompleted).toBe(5);
    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsStopped).toBe(0);

    // All profiles cleanly stopped
    expect(service.getRunningThreads()).toHaveLength(0);
    expect(proxies.activeLeases.size).toBe(0);
    expect(launcher.launchedProfiles.length).toBe(launcher.stoppedProfiles.length);
  });

  it('V08: executes actual executeHttpTasks with real SQLite repository sink and per-page evaluate sandbox', async () => {
    const CANONICAL_12_TASKS = [
      { key: 'capcut_web_newbie_register', title: 'Sign up for CapCut Web' },
      { key: 'capcut_web_pwa_install', title: 'Install CapCut Web Desktop' },
      { key: 'capcut_web_push_authorize', title: 'Enable browser notifications' },
      { key: 'capcut_web_design_studio_picture_creation', title: 'Create images in Design Studio' },
      { key: 'capcut_web_design_studio_ai_chat', title: 'Chat with AI agent' },
      { key: 'capcut_web_design_studio_upload_img', title: 'Upload an image' },
      { key: 'capcut_web_design_studio_canvas_edit', title: 'Edit on canvas' },
      { key: 'capcut_web_inspiration_generate_done', title: 'Try an Inspiration template' },
      { key: 'capcut_web_video_studio_creation', title: 'Create in Video Studio' },
      { key: 'capcut_web_video_studio_send_msg', title: 'Chat with AI agent' },
      { key: 'capcut_web_video_studio_generate_done', title: 'Complete a generation' },
      { key: 'capcut_web_video_studio_export', title: 'Make an export' }
    ] as const;

    const rawAccounts = Array.from({ length: 6 }, (_, i) => ({
      email: `wave-acc-${i + 1}@capcut.test`,
      password: `pwd-${i + 1}`
    }));

    const workSources: AutomationWorkSourceFactory = {
      create: (_config) => {
        const items: AutomationWorkItem[] = rawAccounts.map((acc, i) => ({
          kind: 'new',
          sourceId: `src-${i + 1}`,
          email: acc.email,
          emailPassword: acc.password,
          emailProvider: 'manual'
        }));
        return {
          kind: 'finite',
          purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
          prepare: async (c) => ({ workerTarget: Math.min(c, items.length) }),
          next: async () => items.shift() ?? null,
          commit: () => {},
          release: () => {}
        };
      }
    };

    const accounts = new TrackingAccounts();
    const launcher = new TrackingLauncher();
    const proxies = new TrackingProxySource();

    // Setup real SQLite in-memory database and repository sink
    const db = new Database(':memory:');
    runMigrations(db);
    const repo = new AccountTaskRepository(db);
    const rawSink = createTaskProgressSink(repo);
    let recordUnsettledProofCount = 0;
    const taskProgress: ICapcutTaskProgressSink = {
      record: (accountId, checkpoint) => rawSink.record(accountId, checkpoint),
      recordUnsettled: async (accountId, runId, proofs) => {
        recordUnsettledProofCount += proofs.length;
        return rawSink.recordUnsettled?.(accountId, runId, proofs);
      }
    };

    // Profiles for wave 2 fail profile stop
    launcher.failStopFor.add('profile-4');
    launcher.failStopFor.add('profile-5');
    launcher.failStopFor.add('profile-6');

    let resolveBFourthDurableWrite!: () => void;
    const bFourthDurableWritePromise = new Promise<void>((resolve) => {
      resolveBFourthDurableWrite = resolve;
    });

    let resolveCReady!: () => void;
    const cReadyPromise = new Promise<void>((resolve) => {
      resolveCReady = resolve;
    });

    let aActionAttempts = 0;
    let aActionAcks = 0;
    let aCallsAfterAbort = 0;

    let bAttempts = 0;
    let bAcks = 0;
    let bCallsAfterAbort = 0;

    function evaluateFor(fetchForPage: typeof fetch) {
      return async (fn: (argument: unknown) => unknown, argument?: unknown) => {
        const context = vm.createContext({
          fetch: fetchForPage,
          Response,
          URL,
          URLSearchParams,
          Date,
          JSON,
          Promise,
          Error,
          console,
          argument
        });
        return vm.runInContext('(' + fn.toString() + ')(argument)', context);
      };
    }

    const runId = 'scenario-run-v08';

    const capcutRunner: CapcutTaskRunner = {
      runAccount: async (input) => {
        const match = input.email.match(/^wave-acc-(\d+)@/);
        const ordinal = match ? parseInt(match[1], 10) : 0;

        // Wave 1: Accounts 1, 2, 3 complete cleanly with 12 canonical tasks
        if (ordinal >= 1 && ordinal <= 3) {
          const result: CapcutUiAccountResult = {
            authenticated: true,
            done: 12,
            total: 12,
            credits: 120,
            creditsTotal: 120,
            missing: [],
            tasks: CANONICAL_12_TASKS.map((t) => ({
              key: t.key,
              title: t.title,
              reward: 10,
              status: 4
            })),
            verification: {
              runId: input.runId ?? runId,
              sessionAlias: input.accountId,
              observedAt: '2026-09-11T04:00:00.000Z',
              requiredAfter: '2026-09-11T03:00:00.000Z',
              fresh: true,
              final: true,
              complete: true,
              serverTotal: 12,
              serverDone: 12
            },
            unsettledProofs: []
          };
          if (input.onTaskCheckpoint) {
            await input.onTaskCheckpoint({
              rows: result.tasks,
              receipt: result.verification!,
              unsettledProofs: []
            });
          }
          return result;
        }

        // Wave 2:
        // Worker B (Account 5): runs actual executeHttpTasks, acks 4 tasks, signals 4th write; 5th hangs awaiting abort
        if (ordinal === 5) {
          const bFetch = (async (url: string | URL | Request, _init?: RequestInit) => {
            const urlStr = String(url);
            if (input.signal.aborted) {
              bCallsAfterAbort++;
              throw new Error('Call after abort');
            }
            if (urlStr.includes('/account/info/')) {
              return new Response(JSON.stringify({ data: { user_id_str: '9998887705' } }), { status: 200 });
            }
            if (urlStr.includes('/do_action')) {
              bAttempts++;
              if (bAttempts <= 4) {
                bAcks++;
                return new Response(JSON.stringify({ err_no: 0, err_tips: '' }), { status: 200 });
              }
              // 5th attempt: pending / awaiting abort
              return new Promise<Response>((_, reject) => {
                input.signal.addEventListener('abort', () => reject(input.signal.reason ?? new Error('Aborted')));
              });
            }
            throw new Error(`Unexpected request: ${urlStr}`);
          }) as unknown as typeof fetch;

          const pageB = {
            evaluate: evaluateFor(bFetch)
          } as unknown as Page;

          const taskResult = await executeHttpTasks({
            page: pageB,
            log: () => {},
            signal: input.signal,
            actionDelayMs: 0,
            sessionStartedAt: Date.now(),
            onAcceptedProof: async (event) => {
              if (input.onAcceptedProof) {
                await input.onAcceptedProof(event);
              }
              if (event.key === LEAF_TASKS[3]) {
                resolveBFourthDurableWrite();
              }
            }
          });

          return {
            authenticated: true,
            done: 0,
            total: 12,
            credits: 0,
            creditsTotal: 120,
            missing: [],
            tasks: [],
            verification: null,
            unsettledProofs: taskResult.unsettledProofs
          };
        }

        // Worker C (Account 6): trial waiter, signals ready, awaits abort
        if (ordinal === 6) {
          resolveCReady();
          await new Promise<void>((_, reject) => {
            input.signal.addEventListener('abort', () => reject(input.signal.reason ?? new Error('Aborted')));
          });
          return {
            authenticated: true,
            done: 0,
            total: 12,
            credits: 0,
            creditsTotal: 120,
            missing: [],
            tasks: [],
            verification: null,
            unsettledProofs: []
          };
        }

        // Worker A (Account 4): runs actual executeHttpTasks with 9 acks, missing task_list,
        // goto awaits B's 4th write + C readiness, then popup watchdog times out -> throws real TaskEvidenceError
        if (ordinal === 4) {
          const aFetch = (async (url: string | URL | Request, _init?: RequestInit) => {
            const urlStr = String(url);
            if (input.signal.aborted) {
              aCallsAfterAbort++;
              throw new Error('Call after abort');
            }
            if (urlStr.includes('/account/info/')) {
              return new Response(JSON.stringify({ data: { user_id_str: '9998887704' } }), { status: 200 });
            }
            if (urlStr.includes('/do_action')) {
              aActionAttempts++;
              aActionAcks++;
              return new Response(JSON.stringify({ err_no: 0, err_tips: '' }), { status: 200 });
            }
            if (urlStr.includes('/task_list')) {
              return new Response(JSON.stringify({ err_no: 0, data: {} }), { status: 200 });
            }
            throw new Error(`Unexpected request: ${urlStr}`);
          }) as unknown as typeof fetch;

          let aHydrationGotoCalled = false;
          const pageA = {
            evaluate: evaluateFor(aFetch),
            goto: async () => {
              await Promise.all([bFourthDurableWritePromise, cReadyPromise]);
              aHydrationGotoCalled = true;
            },
            locator: (_selector: string) => ({
              first: () => ({
                isVisible: async () => {
                  if (!aHydrationGotoCalled) {
                    return false;
                  }
                  // In popup-after-hydration: hang to trigger 1000ms boundedDomRead timeout!
                  return new Promise<boolean>((_, reject) => {
                    input.signal.addEventListener('abort', () => reject(input.signal.reason ?? new Error('Aborted')));
                  });
                }
              })
            })
          } as unknown as Page;

          const taskResult = await executeHttpTasks({
            page: pageA,
            log: () => {},
            signal: input.signal,
            actionDelayMs: 0,
            sessionStartedAt: Date.now(),
            onAcceptedProof: input.onAcceptedProof
          });

          return {
            authenticated: true,
            done: 0,
            total: 12,
            credits: 0,
            creditsTotal: 120,
            missing: [],
            tasks: [],
            verification: null,
            unsettledProofs: taskResult.unsettledProofs
          };
        }

        throw new Error(`Unexpected ordinal ${ordinal}`);
      }
    };

    const service = new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => '123456' },
        proxies,
        browser: {
          startProfile: async () => {
            throw new Error('Not used');
          },
          stopProfile: async () => {}
        },
        accounts,
        logBus: new LogBus({ insertBatch: () => {} }),
        launcher: () => launcher,
        capcut: capcutRunner,
        taskProgress
      },
      {
        sleep: async () => {},
        nextId: () => runId
      }
    );

    const config = AutomationRunConfigSchema.parse({
      threadCount: 3,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'manual',
        entries: rawAccounts.map((a) => `${a.email}|${a.password}`)
      },
      proxy: { mode: 'proxykey', keys: ['k1', 'k2', 'k3'] },
      password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
      testDurationMs: 0
    });

    try {
      await service.start(config);
      const summary = await service.waitForCompletion();

      // V08.5: exact observed runtime state
      expect(summary.state).toBe('failed');
      expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
      expect(summary.accountsAccepted).toBe(6);
      expect(summary.accountsCompleted).toBe(3);
      expect(summary.accountsFailed).toBe(1);
      expect(summary.accountsStopped).toBe(2);

      // V08.4: real SQLite unsettled proofs verification
      const aProofs = repo.listUnsettledProofs('db-acc-4', runId);
      expect(aProofs).toHaveLength(9);
      const expectedAKeys = [...LEAF_TASKS].sort();
      for (let i = 0; i < 9; i++) {
        expect(aProofs[i].key).toBe(expectedAKeys[i]);
        expect(aProofs[i].opId).toContain('9998887704');
        expect(Number.isFinite(Date.parse(aProofs[i].provedAt))).toBe(true);
      }

      const bProofs = repo.listUnsettledProofs('db-acc-5', runId);
      expect(bProofs).toHaveLength(4);
      const expectedBKeys = [...LEAF_TASKS.slice(0, 4)].sort();
      for (let i = 0; i < 4; i++) {
        expect(bProofs[i].key).toBe(expectedBKeys[i]);
        expect(bProofs[i].opId).toContain('9998887705');
        expect(Number.isFinite(Date.parse(bProofs[i].provedAt))).toBe(true);
      }

      const cProofs = repo.listUnsettledProofs('db-acc-6', runId);
      expect(cProofs).toHaveLength(0);

      // Check receipts in SQLite
      const healthyReceipts = db
        .prepare('SELECT account_id, server_total, server_done FROM account_task_receipts WHERE run_id = ? ORDER BY account_id ASC')
        .all(runId) as Array<{ account_id: string; server_total: number; server_done: number }>;
      expect(healthyReceipts).toHaveLength(3);
      expect(healthyReceipts.map((r) => r.account_id)).toEqual(['db-acc-1', 'db-acc-2', 'db-acc-3']);
      for (const r of healthyReceipts) {
        expect(r.server_total).toBe(12);
        expect(r.server_done).toBe(12);
      }

      const failedOrStoppedReceipts = db
        .prepare('SELECT * FROM account_task_receipts WHERE account_id IN (?, ?, ?)')
        .all('db-acc-4', 'db-acc-5', 'db-acc-6');
      expect(failedOrStoppedReceipts).toHaveLength(0);

      // 13 unique acknowledged versions in wave 2 -> exactly 13 writes across recordUnsettled
      expect(recordUnsettledProofCount).toBe(13);

      // V08.3: Request and ack counts
      expect(aActionAttempts).toBe(9);
      expect(aActionAcks).toBe(9);
      expect(aCallsAfterAbort).toBe(0);
      expect(bAttempts).toBe(5);
      expect(bAcks).toBe(4);
      expect(bCallsAfterAbort).toBe(0);

      // V08.5: Resource oracle
      expect(service.getRunningThreads()).toHaveLength(3);
      expect(proxies.activeLeases.size).toBe(3);

      const retainedProfiles = service.getRunningThreads().map((t) => t.profileId).sort();
      expect(retainedProfiles).toEqual(['profile-4', 'profile-5', 'profile-6']);

      expect(launcher.stopCalls.filter((id) => id === 'profile-4')).toHaveLength(1);
      expect(launcher.stopCalls.filter((id) => id === 'profile-5')).toHaveLength(1);
      expect(launcher.stopCalls.filter((id) => id === 'profile-6')).toHaveLength(1);

      const peerUpdates = accounts.updates.filter((u) => u.id === 'db-acc-5' || u.id === 'db-acc-6');
      const stoppedPeerSteps = peerUpdates.filter((u) => u.data.status === 'stopped').map((u) => u.data.automationStep);
      expect(stoppedPeerSteps).toHaveLength(2);
      for (const step of stoppedPeerSteps) {
        expect(step).toBe('Đã dừng vì lỗi thu hồi browser của phiên chạy');
        expect(step).not.toBe('Đã dừng theo yêu cầu');
      }

      // Subsequent stop call does not retry stop calls or release resources
      const stopCallsBefore = launcher.stopCalls.length;
      await service.stop();
      expect(launcher.stopCalls.length).toBe(stopCallsBefore);
      expect(service.getRunningThreads()).toHaveLength(3);
      expect(proxies.activeLeases.size).toBe(3);
    } finally {
      // Unblock any gates to prevent unhandled rejections
      resolveBFourthDurableWrite();
      resolveCReady();
      db.close();
    }
  }, 15000);
});
