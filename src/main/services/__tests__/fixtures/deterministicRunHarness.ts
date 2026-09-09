import {
  AutomationRunService,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type IProxyLeaseSource,
  type CapcutTaskRunner,
  type AutomationRunSummary,
  type AutomationRunTerminalSnapshot
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
import { DomReadTimeoutError } from '../../capcut/cancellation';

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
  foreground: number;
  editor: number;
  perSessionForeground: Record<string, number>;
  perSessionEditor: Record<string, number>;
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
  schedulerCount: number;
  schedulerForegroundWaiting: number;
  schedulerEditorWaiting: number;
  schedulerEditorActive: number;
  schedulerForegroundOwner?: string;
  quarantinedSessionAliases: string[];
  activeProfiles: number;
  activeProxies: number;
  activeMailReservations: number;
}

export interface DeterministicHarnessResult {
  peaks: ResourcePeaks;
  counters: ResourceCounters;
  final: FinalState;
  events: string[];
  summary: AutomationRunSummary;
  service: AutomationRunService;
  faultReached: Record<string, number>;
}

class QuietSink implements ILogSink {
  insertBatch(): void {}
}

export interface DeterministicRunOptions {
  count: number;
  seed?: number;
  itemCount?: number;
  sourceKind?: 'finite' | 'continuous';
  stopAfterCompleted?: number;
  cancellationMode?: 'global' | 'thread';
  onEditorStarted?: (sessionAlias: string) => Promise<void>;
  onForegroundStarted?: (sessionAlias: string) => Promise<void>;
  onAccountCompleted?: (accountId: string, sessionAlias: string) => void;
  faults?: {
    mailAcquireError?: Error;
    launchRejectBeforeProfile?: boolean;
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
  const {
    count,
    seed = 42,
    itemCount = count,
    sourceKind = 'finite',
    stopAfterCompleted,
    faults = {},
    cancellationMode
  } = options;
  const rng = xorshift32(seed);

  const peaks: ResourcePeaks = {
    workers: 0,
    profiles: 0,
    proxies: 0,
    mailReservations: 0,
    foreground: 0,
    editor: 0,
    perSessionForeground: {},
    perSessionEditor: {}
  };

  let activeWorkers = 0;
  let activeProfiles = 0;
  let activeProxies = 0;
  let activeMailReservations = 0;

  const events: string[] = [];
  const faultReached: Record<string, number> = {};
  const reach = (name: string): void => { faultReached[name] = (faultReached[name] ?? 0) + 1; };
  let foregroundActive = 0;
  let editorActive = 0;
  const foregroundBySession = new Map<string, number>();
  const editorBySession = new Map<string, number>();

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
        kind: sourceKind,
      purchaseStats: () => ({ budget: 0, attempted: 0, confirmed: 0, ambiguous: 0 }),
        prepare: async () => {
          await yieldTurns(2);
          if (faults.mailAcquireError) { reach('mailAcquireError'); throw faults.mailAcquireError; }
          return { workerTarget: count };
        },
        next: async (_workerId, signal) => {
          await yieldTurns(3);
          const item = items.shift();
          if (item) {
            activeMailReservations++;
            peaks.mailReservations = Math.max(peaks.mailReservations, activeMailReservations);
            events.push(`mail:reserve:${item.sourceId}`);
          }
          if (item) return item;
          if (sourceKind === 'finite') return null;
          return await new Promise<AutomationWorkItem>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Aborted')), { once: true });
          });
        },
        commit: (item) => {
          activeMailReservations = Math.max(0, activeMailReservations - 1);
          events.push(`mail:commit:${item.sourceId}`);
          if (faults.mailReleaseError) { reach('mailReleaseError'); throw faults.mailReleaseError; }
        },
        release: (item) => {
          activeMailReservations = Math.max(0, activeMailReservations - 1);
          events.push(`mail:release:${item.sourceId}`);
          if (faults.mailReleaseError) { reach('mailReleaseError'); throw faults.mailReleaseError; }
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
      if (faults.proxyAcquireError) { reach('proxyAcquireError'); throw faults.proxyAcquireError; }
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
      if (faults.proxyReleaseError) { reach('proxyReleaseError'); throw faults.proxyReleaseError; }
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
  const launchesByProxy = new Map<string, number>();
  const launcher: BrowserLauncher = {
    name: 'api-v3',
    launch: async (input) => {
      await yieldTurns(3);
      if (faults.launchRejectBeforeProfile) {
        reach('launchRejectBeforeProfile');
        throw new Error('Launch rejected before profile publication');
      }
      profileCounter++;
      const profileId = `profile-${profileCounter}`;
      activeProfiles++;
      peaks.profiles = Math.max(peaks.profiles, activeProfiles);
      events.push(`profile:launch:${profileId}`);
      const proxyKey = input.proxy?.host ?? 'direct';
      const proxyLaunchCount = (launchesByProxy.get(proxyKey) ?? 0) + 1;
      launchesByProxy.set(proxyKey, proxyLaunchCount);

      input.onProfileStarted?.(profileId);

      if (faults.healthMouseTimeout) {
        reach('healthMouseTimeout');
        await input.ui?.foreground('renderer-health:mouse', async () => {
          throw new DomReadTimeoutError('renderer-health:mouse');
        });
      }

      if (faults.attachRejectionAfterProfileId) {
        reach('attachRejectionAfterProfileId');
        throw new Error('Attach rejected after profile ID published');
      }
      if (faults.replacementLaunchError && proxyLaunchCount > 1) {
        reach('replacementLaunchError');
        throw faults.replacementLaunchError;
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
      if (faults.oldStopError) { reach('oldStopError'); throw faults.oldStopError; }
      activeProfiles = Math.max(0, activeProfiles - 1);
      events.push(`profile:stop:${profileId}`);
    }
  };

  const browser: IBrowserRuntimeApi = {
    startProfile: async () => ({ profileId: 'dummy', port: 9222, browserType: 'mimic' }),
    stopProfile: async () => {}
  };

  // 5. CapCut runner tracking
  let completedAccounts = 0;
  let releaseCompletionTarget: () => void = () => {};
  const completionTarget = new Promise<void>((resolve) => { releaseCompletionTarget = resolve; });
  const capcut: CapcutTaskRunner = {
    runAccount: async (input) => {
      events.push(`capcut:start:${input.accountId}`);

      if (cancellationMode === 'global' || (cancellationMode === 'thread' && input.accountId === 'acc-1')) {
        await new Promise<never>((_, reject) => {
          if (input.signal.aborted) {
            reject(input.signal.reason);
            return;
          }
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
        });
      }

      await yieldTurns(2);

      if (faults.replacementLoginError && input.authAttempt === 'existing-only') {
        reach('replacementLoginError');
        throw faults.replacementLoginError;
      }

      if (faults.missionMouseTimeout && input.authAttempt !== 'existing-only') {
        reach('missionMouseTimeout');
        try {
          await input.ui.foreground('mission:mouse', async () => {
            throw new DomReadTimeoutError('mission:mouse');
          });
        } catch {
          return {
            authenticated: true, done: 0, total: 1, credits: 0, creditsTotal: 10,
            missing: ['capcut_web_newbie_register'], tasks: [], unsettledProofs: [],
            verification: null, fatalCode: 'DOM_READ_TIMEOUT', fatalError: 'DOM_READ_TIMEOUT'
          };
        }
      }

      if (input.ui) {
        // Foreground interaction
        await input.ui.foreground('test-foreground', async () => {
          const sessionAlias = input.sessionAlias ?? 'session-1';
          foregroundActive += 1;
          foregroundBySession.set(sessionAlias, (foregroundBySession.get(sessionAlias) ?? 0) + 1);
          peaks.foreground = Math.max(peaks.foreground, foregroundActive);
          peaks.perSessionForeground[sessionAlias] = Math.max(
            peaks.perSessionForeground[sessionAlias] ?? 0,
            foregroundBySession.get(sessionAlias) ?? 0
          );
          events.push(`ui:foreground:start:${input.accountId}`);
          try {
            await options.onForegroundStarted?.(sessionAlias);
            await yieldTurns(3);
            events.push(`ui:foreground:end:${input.accountId}`);
          } finally {
            foregroundBySession.set(sessionAlias, Math.max(0, (foregroundBySession.get(sessionAlias) ?? 1) - 1));
            foregroundActive -= 1;
          }
        });

        // Editor interaction
        await input.ui.editor('test-editor', async () => {
          const sessionAlias = input.sessionAlias ?? 'session-1';
          editorActive += 1;
          editorBySession.set(sessionAlias, (editorBySession.get(sessionAlias) ?? 0) + 1);
          peaks.editor = Math.max(peaks.editor, editorActive);
          peaks.perSessionEditor[sessionAlias] = Math.max(
            peaks.perSessionEditor[sessionAlias] ?? 0,
            editorBySession.get(sessionAlias) ?? 0
          );
          events.push(`ui:editor:start:${input.accountId}`);
          try {
            await options.onEditorStarted?.(sessionAlias);
            await yieldTurns(2);
            events.push(`ui:editor:end:${input.accountId}`);
          } finally {
            editorBySession.set(sessionAlias, Math.max(0, (editorBySession.get(sessionAlias) ?? 1) - 1));
            editorActive -= 1;
          }
        });
      }

      // Checkpoint
      events.push(`checkpoint:${input.accountId}`);
      await input.onTaskCheckpoint?.({
        rows: [{ key: 'capcut_web_pwa_install', title: 'Install', reward: 10, status: 4 }],
        unsettledProofs: [],
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
      options.onAccountCompleted?.(input.accountId, input.sessionAlias ?? 'session-1');
      completedAccounts += 1;
      if (stopAfterCompleted !== undefined && completedAccounts >= stopAfterCompleted) {
        releaseCompletionTarget();
      }
      const result: CapcutUiAccountResult = {
        authenticated: true,
        done: 1,
        total: 1,
        credits: 10,
        creditsTotal: 10,
        missing: [],
        tasks: [{ key: 'capcut_web_pwa_install', title: 'Install', status: 4, reward: 10 }],
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
  let terminalSnapshot: AutomationRunTerminalSnapshot | undefined;
  const service = new AutomationRunService(
    {
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies,
      browser,
      accounts,
      logBus: new LogBus(new QuietSink()),
      launcher: () => launcher,
      capcut,
      ...(faults.checkpointPersistenceError ? {
        taskProgress: {
          record: async () => {
            reach('checkpointPersistenceError');
            throw faults.checkpointPersistenceError;
          }
        }
      } : {})
    },
    {
      sleep: async () => {
        await yieldTurns(1);
      },
      nextId: () => `det-run-${++idCounter}`,
      onTerminalSnapshot: (snapshot) => {
        terminalSnapshot = snapshot;
      }
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
  if (cancellationMode === 'global') {
    await service.stop();
  } else if (cancellationMode === 'thread') {
    const target = service.getRunningThreads().find((thread) => thread.accountId === 'acc-1')
      ?? service.getRunningThreads()[0];
    if (!target) throw new Error('Deterministic thread cancellation had no running target');
    await service.stopThread(target.accountId);
  } else if (stopAfterCompleted !== undefined) {
    await completionTarget;
    await service.stop();
  }
  const summary = await service.waitForCompletion();

  if (!terminalSnapshot) throw new Error('Deterministic run did not publish a terminal lifecycle snapshot');
  const schedulerSnapshots = terminalSnapshot.schedulers.map((entry) => entry.snapshot);

  const final: FinalState = {
    activeThreads: terminalSnapshot.activeThreads,
    schedulerCount: schedulerSnapshots.length,
    schedulerForegroundWaiting: schedulerSnapshots.reduce((sum, snapshot) => sum + snapshot.foregroundWaiting, 0),
    schedulerEditorWaiting: schedulerSnapshots.reduce((sum, snapshot) => sum + snapshot.editorWaiting, 0),
    schedulerEditorActive: schedulerSnapshots.reduce((sum, snapshot) => sum + snapshot.editorActive, 0),
    schedulerForegroundOwner: schedulerSnapshots.find((snapshot) => snapshot.foregroundOwner)?.foregroundOwner,
    quarantinedSessionAliases: schedulerSnapshots.flatMap((snapshot) => snapshot.quarantinedSessionAliases),
    activeProfiles: terminalSnapshot.activeProfiles,
    activeProxies: terminalSnapshot.activeProxies,
    activeMailReservations: terminalSnapshot.activeMailReservations
  };

  const counters: ResourceCounters = {
    accepted: summary.accountsAccepted,
    completed: summary.accountsCompleted,
    failed: summary.accountsFailed,
    stopped: summary.accountsStopped,
    cleanupFailures: typeof summary.terminalReason?.details?.cleanupFailures === 'number'
      ? summary.terminalReason.details.cleanupFailures
      : 0
  };

  return {
    peaks,
    counters,
    final,
    events,
    summary,
    service,
    faultReached
  };
}
