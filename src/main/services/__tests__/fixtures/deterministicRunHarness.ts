import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IProxyLeaseSource,
  type CapcutTaskRunner,
  type AutomationRunSummary
} from '../../AutomationRunService';
import type { BrowserLauncher, LaunchedProfile } from '../../capcut/launcher';
import { LogBus, type ILogSink } from '../../LogBus';
import { AutomationRunConfigSchema, type AutomationRunConfigDTO } from '../../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../../ProxyLeaseManager';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  AutomationWorkSourceFactory
} from '../../AutomationWorkSource';
import type { CapcutUiAccountResult } from '../../capcut/types';

export function xorshift32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

export interface ResourcePeaks {
  workers: number;
  profiles: number;
  proxies: number;
  mailReservations: number;
}

export interface ResourceCounters {
  accepted: number;
  completed: number;
  failed: number;
  stopped: number;
  cleanupFailures: number;
}

export interface FinalState {
  activeThreads: number;
  schedulerForegroundWaiting: number;
  schedulerEditorWaiting: number;
}

export interface DeterministicHarnessResult {
  peaks: ResourcePeaks;
  counters: ResourceCounters;
  final: FinalState;
  events: string[];
  summary: AutomationRunSummary;
  service: AutomationRunService;
}

class QuietSink implements ILogSink {
  insertBatch(): void {}
}

export interface DeterministicRunOptions {
  count: number;
  seed?: number;
  itemCount?: number;
  faults?: {
    mailAcquireError?: Error;
    proxyAcquireError?: Error;
    attachRejectionAfterProfileId?: boolean;
    healthMouseTimeout?: boolean;
    missionMouseTimeout?: boolean;
    checkpointPersistenceError?: Error;
    oldStopError?: Error;
    replacementLaunchError?: Error;
    replacementLoginError?: Error;
    proxyReleaseError?: Error;
    mailReleaseError?: Error;
  };
}

export async function runDeterministicSimulation(
  options: DeterministicRunOptions
): Promise<DeterministicHarnessResult> {
  const { count, seed = 42, itemCount = count, faults = {} } = options;
  const rng = xorshift32(seed);

  const peaks: ResourcePeaks = {
    workers: 0,
    profiles: 0,
    proxies: 0,
    mailReservations: 0
  };

  let activeWorkers = 0;
  let activeProfiles = 0;
  let activeProxies = 0;
  let activeMailReservations = 0;

  const events: string[] = [];

  const yieldTurns = async (maxTurns = 3): Promise<void> => {
    const turns = Math.floor(rng() * (maxTurns + 1));
    for (let i = 0; i < turns; i++) {
      await Promise.resolve();
    }
  };

  // 1. Work source tracking
  const items: AutomationWorkItem[] = Array.from({ length: itemCount }, (_, i) => ({
    kind: 'new',
    sourceId: `item-${i + 1}`,
    email: `worker-${i + 1}@example.com`,
    emailProvider: 'manual',
    emailPassword: `pass-${i + 1}`,
    purchasedEmailId: `pe-${i + 1}`
  }));

  const workSources: AutomationWorkSourceFactory = {
    create: (): AutomationWorkSource => {
      return {
        kind: 'finite',
        prepare: async () => {
          await yieldTurns(2);
          if (faults.mailAcquireError) throw faults.mailAcquireError;
          return { workerTarget: count };
        },
        next: async () => {
          await yieldTurns(3);
          const item = items.shift();
          if (item) {
            activeMailReservations++;
            peaks.mailReservations = Math.max(peaks.mailReservations, activeMailReservations);
            events.push(`mail:reserve:${item.sourceId}`);
          }
          return item ?? null;
        },
        commit: (item) => {
          activeMailReservations = Math.max(0, activeMailReservations - 1);
          events.push(`mail:commit:${item.sourceId}`);
          if (faults.mailReleaseError) throw faults.mailReleaseError;
        },
        release: (item) => {
          activeMailReservations = Math.max(0, activeMailReservations - 1);
          events.push(`mail:release:${item.sourceId}`);
          if (faults.mailReleaseError) throw faults.mailReleaseError;
        }
      };
    }
  };

  // 2. Proxy source tracking
  let proxyCounter = 0;
  const proxies: IProxyLeaseSource = {
    configure: () => {},
    availableSlots: async () => count,
    acquire: async (): Promise<AcquiredProxyLease> => {
      await yieldTurns(3);
      if (faults.proxyAcquireError) throw faults.proxyAcquireError;
      proxyCounter++;
      activeProxies++;
      peaks.proxies = Math.max(peaks.proxies, activeProxies);
      events.push(`proxy:acquire:lease-${proxyCounter}`);
      return {
        leaseId: `lease-${proxyCounter}`,
        keyValue: `K${proxyCounter}`,
        ip: `10.0.0.${proxyCounter}`,
        host: `10.0.0.${proxyCounter}`,
        port: 20000 + proxyCounter,
        protocol: 'http',
        username: `user-${proxyCounter}`,
        password: `pass-${proxyCounter}`,
        nextChangeSeconds: 60
      };
    },
    release: async (lease) => {
      await yieldTurns(2);
      activeProxies = Math.max(0, activeProxies - 1);
      events.push(`proxy:release:${lease.leaseId}`);
      if (faults.proxyReleaseError) throw faults.proxyReleaseError;
    },
    releaseAll: async () => {
      activeProxies = 0;
    }
  };

  // 3. Account Sink tracking
  let accountCounter = 0;
  const accounts: IAccountSink = {
    create: (_input) => {
      accountCounter++;
      activeWorkers++;
      peaks.workers = Math.max(peaks.workers, activeWorkers);
      events.push(`account:create:acc-${accountCounter}`);
      return { id: `acc-${accountCounter}` };
    },
    update: (id, data) => {
      events.push(`account:update:${id}:${String(data.status ?? '')}`);
      if (data.status === 'done' || data.status === 'error' || data.status === 'stopped') {
        activeWorkers = Math.max(0, activeWorkers - 1);
      }
      return { success: true };
    }
  };

  // 4. Browser launcher tracking
  let profileCounter = 0;
  const launcher: BrowserLauncher = {
    name: 'api-v3',
    launch: async (input) => {
      await yieldTurns(3);
      profileCounter++;
      const profileId = `profile-${profileCounter}`;
      activeProfiles++;
      peaks.profiles = Math.max(peaks.profiles, activeProfiles);
      events.push(`profile:launch:${profileId}`);

      input.onProfileStarted?.(profileId);

      if (faults.attachRejectionAfterProfileId) {
        throw new Error('Attach rejected after profile ID published');
      }

      const mockPage = {} as unknown as LaunchedProfile['page'];
      const mockContext = {} as unknown as LaunchedProfile['context'];

      return {
        profileId,
        port: 9222,
        page: mockPage,
        context: mockContext
      };
    },
    stop: async (profileId) => {
      await yieldTurns(2);
      if (faults.oldStopError) throw faults.oldStopError;
      activeProfiles = Math.max(0, activeProfiles - 1);
      events.push(`profile:stop:${profileId}`);
    }
  };

  const browser: IBrowserRuntimeApi = {
    startProfile: async () => ({ profileId: 'dummy', port: 9222, browserType: 'mimic' }),
    stopProfile: async () => {}
  };

  // 5. CapCut runner tracking
  const capcut: CapcutTaskRunner = {
    runAccount: async (input) => {
      events.push(`capcut:start:${input.accountId}`);

      await yieldTurns(2);

      if (input.ui) {
        // Foreground interaction
        await input.ui.foreground('test-foreground', async () => {
          events.push(`ui:foreground:start:${input.accountId}`);
          await yieldTurns(3);
          events.push(`ui:foreground:end:${input.accountId}`);
        });

        // Editor interaction
        await input.ui.editor('test-editor', async () => {
          events.push(`ui:editor:start:${input.accountId}`);
          await yieldTurns(2);
          events.push(`ui:editor:end:${input.accountId}`);
        });
      }

      // Checkpoint
      events.push(`checkpoint:${input.accountId}`);
      await input.onTaskCheckpoint?.({
        rows: [{ key: 'capcut_web_pwa_install_7_2026-09-03', title: 'Install', reward: 10, status: 4 }],
        receipt: {
          runId: input.runId ?? 'run-1',
          sessionAlias: input.sessionAlias ?? 'session-1',
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        }
      });

      events.push(`capcut:end:${input.accountId}`);
      const result: CapcutUiAccountResult = {
        authenticated: true,
        done: 1,
        total: 1,
        credits: 10,
        creditsTotal: 10,
        missing: [],
        tasks: [{ key: 'capcut_web_pwa_install_7_2026-09-03', title: 'Install', status: 4, reward: 10 }],
        unsettledProofs: [],
        verification: {
          runId: input.runId ?? 'run-1',
          sessionAlias: input.sessionAlias ?? 'session-1',
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        }
      };
      return result;
    }
  };

  let idCounter = 0;
  const service = new AutomationRunService(
    {
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies,
      browser,
      accounts,
      logBus: new LogBus(new QuietSink()),
      launcher: () => launcher,
      capcut
    },
    {
      sleep: async () => {
        await yieldTurns(1);
      },
      nextId: () => `det-run-${++idCounter}`
    }
  );

  const config: AutomationRunConfigDTO = AutomationRunConfigSchema.parse({
    threadCount: count,
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
      entries: Array.from({ length: itemCount }, (_, i) => `u${i + 1}@example.com|p${i + 1}`)
    },
    proxy: { mode: 'proxykey' },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false }
  });

  await service.start(config);
  await service.waitUntilRunning();
  const summary = await service.waitForCompletion();

  // Also sample internal activeThreads size if any were recorded
  // @ts-expect-error accessing private property for test verification
  const serviceActiveThreads = service.activeThreads as Map<string, unknown>;
  // @ts-expect-error accessing private property for test verification
  const scheduler = service.uiScheduler as { snapshot?: () => { foreground?: { queued: number }; editor?: { queued: number } } } | null;
  // @ts-expect-error accessing private property for test verification
  const cleanupFailures = (service.cleanupFailures as number) ?? 0;

  const final: FinalState = {
    activeThreads: serviceActiveThreads?.size ?? 0,
    schedulerForegroundWaiting: scheduler?.snapshot?.()?.foreground?.queued ?? 0,
    schedulerEditorWaiting: scheduler?.snapshot?.()?.editor?.queued ?? 0
  };

  const counters: ResourceCounters = {
    accepted: summary.accountsAccepted,
    completed: summary.accountsCompleted,
    failed: summary.accountsFailed,
    stopped: summary.accountsStopped,
    cleanupFailures
  };

  return {
    peaks,
    counters,
    final,
    events,
    summary,
    service
  };
}
