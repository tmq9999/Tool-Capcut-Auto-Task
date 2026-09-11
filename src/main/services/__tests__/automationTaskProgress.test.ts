/**
 * =============================================================================
 * TIẾN ĐỘ NHIỆM VỤ — TỪ ENGINE XUỐNG DB
 * =============================================================================
 * Hai thứ được kiểm ở đây:
 *   1. `toTaskProgressRows` rút `outcomes` + `snapshot` của `runAllTasks` thành
 *      các dòng tiến độ, với `status` là số của CHÍNH CapCut.
 *   2. `AutomationRunService` gọi collaborator `taskProgress` sau khi engine trả
 *      kết quả, và lỗi ghi DB KHÔNG được làm vỡ luồng.
 * =============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import {
  AutomationRunService,
  type CapcutAccountResult,
  type CapcutTaskRunner,
  type IAccountSink,
  type IBrowserRuntimeApi,
  type ICapcutTaskProgressSink,
  type IProxyLeaseSource,
  type StartedProfile
} from '../AutomationRunService';
import { toTaskProgressRows } from '../CapcutEngineService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
import type { TaskSnapshotSummary } from '../capcut/runTasks';
import type { TaskOutcome, CapcutVerificationReceipt, UnsettledTaskProof } from '../capcut/types';
import { LogBus, type ILogSink } from '../LogBus';
import { AutomationTerminalError } from '../AutomationTerminalError';
import { TaskEvidenceError } from '../capcut/TaskEvidenceError';
import { createTaskProgressSink } from '../../runtime/providerStack';
import {
  AutomationRunConfigSchema,
  type AutomationRunConfigDTO
} from '../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';
import type {
  AutomationWorkItem,
  AutomationWorkSourceFactory
} from '../AutomationWorkSource';

class CollectingSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void { this.rows.push(...logs); }
}

const stubWorkSources: AutomationWorkSourceFactory = {
  create: (config) => {
    const entries = config.emailSource.mode === 'manual' ? config.emailSource.entries : ['worker@example.com|mail-pass'];
    const items: AutomationWorkItem[] = entries.map((entry, i) => {
      const [email, password] = entry.split('|');
      return {
        kind: 'new',
        sourceId: 'man-' + (i + 1),
        email,
        emailPassword: password,
        emailProvider: 'manual'
      };
    });
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

class StubProxySource implements IProxyLeaseSource {
  async acquire(): Promise<AcquiredProxyLease> {
    throw new Error('test này chạy Direct IP nên không xin proxy');
  }
  async release(): Promise<void> {}
  async releaseAll(): Promise<void> {}
}

class StubBrowserRuntime implements IBrowserRuntimeApi {
  async startProfile(): Promise<StartedProfile> {
    throw new Error('test này đi qua launcher, không dùng startProfile');
  }
  async stopProfile(): Promise<void> {}
}

class StubAccounts implements IAccountSink {
  public updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  public createdCount = 0;
  private counter = 0;

  create(): { id: string } {
    this.counter += 1;
    this.createdCount += 1;
    return { id: 'acc-' + this.counter };
  }

  update(id: string, data: Record<string, unknown>): { success: boolean } {
    this.updates.push({ id, data });
    return { success: true };
  }
}

/**
 * Launcher giả: chỉ cần trả về `page`/`context` để `runThreadWorkload` đi vào
 * nhánh làm nhiệm vụ. Engine giả không chạm tới hai đối tượng này, nên object
 * rỗng là đủ và test không cần Playwright thật.
 */
class StubLauncher implements BrowserLauncher {
  public readonly name = 'xcli' as const;
  public stopped: string[] = [];
  private counter = 0;

  async launch(): Promise<LaunchedProfile> {
    this.counter += 1;
    return {
      page: {} as unknown as Page,
      context: {} as unknown as BrowserContext,
      port: 60000 + this.counter,
      profileId: 'profile-' + this.counter
    };
  }

  async stop(profileId: string): Promise<void> {
    this.stopped.push(profileId);
  }
}

import type { CapcutUiAccountResult } from '../capcut/types';

type RunAccountInput = Parameters<CapcutTaskRunner['runAccount']>[0];

class StubCapcutRunner implements CapcutTaskRunner {
  public calls = 0;
  /** Giữ lại input để kiểm chỗ nối cấu hình Dashboard → engine. */
  public lastInput: RunAccountInput | null = null;
  constructor(private readonly result: CapcutUiAccountResult) {}

  async runAccount(input: RunAccountInput): Promise<CapcutUiAccountResult> {
    this.calls += 1;
    this.lastInput = input;
    if (input.onTaskCheckpoint && this.result.verification && !this.result.skipped && this.result.tasks.length > 0) {
      await input.onTaskCheckpoint({
        rows: this.result.tasks,
        receipt: this.result.verification,
        unsettledProofs: this.result.unsettledProofs
      });
    }
    return this.result;
  }
}

class RecordingProgressSink implements ICapcutTaskProgressSink {
  public calls: Array<{
    accountId: string;
    rows: CapcutAccountResult['tasks'];
    receipt?: CapcutVerificationReceipt;
  }> = [];

  async record(accountId: string, checkpoint: {
    rows: CapcutAccountResult['tasks'];
    receipt: CapcutVerificationReceipt;
  }): Promise<void> {
    this.calls.push({
      accountId,
      rows: checkpoint.rows,
      receipt: checkpoint.receipt
    });
  }

  recordLegacy(accountId: string, rows: CapcutAccountResult['tasks']): void {
    this.calls.push({
      accountId,
      rows
    });
  }
}

class ThrowingProgressSink implements ICapcutTaskProgressSink {
  public calls = 0;
  async record(): Promise<void> {
    this.calls += 1;
    throw new AutomationTerminalError(
      'failed',
      { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' },
      'Không lưu được checkpoint nhiệm vụ.'
    );
  }
}

const TASKS: CapcutAccountResult['tasks'] = [
  {
    key: 'capcut_web_pwa_install',
    title: 'Install the app',
    reward: 30,
    status: 4,
    opId: 'capcut_web_pwa_install_7_2026-09-03',
    provedAt: '2026-09-03T01:00:00.000Z'
  },
  { key: 'capcut_web_video_studio_export', title: 'Export a video', reward: 120, status: 1 }
];

function fullResult(overrides: Partial<CapcutUiAccountResult> = {}): CapcutUiAccountResult {
  const missing = overrides.missing ?? ['capcut_web_video_studio_export'];
  const done = overrides.done ?? (missing.length === 0 ? 2 : 1);
  const total = overrides.total ?? 2;
  return {
    authenticated: true,
    done,
    total,
    credits: 30,
    creditsTotal: 150,
    missing,
    tasks: TASKS,
    verification: {
      runId: 'run-1',
      sessionAlias: 'session-1',
      observedAt: '2026-09-08T00:00:00.000Z',
      requiredAfter: '2026-09-08T00:00:00.000Z',
      fresh: true,
      final: missing.length === 0,
      serverTotal: total,
      serverDone: done,
      complete: done === total && missing.length === 0
    },
    unsettledProofs: [],
    ...overrides
  };
}

function baseConfig(overrides: Partial<AutomationRunConfigDTO> = {}): AutomationRunConfigDTO {
  return AutomationRunConfigSchema.parse({
    threadCount: 1,
    browser: 'multilogin',
    headless: false,
    retryCount: 0,
    stepDelayMinMs: 0,
    stepDelayMaxMs: 0,
    typeDelayMinMs: 0,
    typeDelayMaxMs: 0,
    // Chỉ module `credit` có engine; `trial`/`team` bị `runThreadWorkload` từ chối.
    module: 'credit',
    skipWithoutTrial: false,
    emailSource: { mode: 'manual', entries: ['worker@example.com|mail-pass'] },
    proxy: { mode: 'direct', entries: [] },
    password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
    testDurationMs: 0,
    ...overrides
  });
}

let accounts: StubAccounts;
let launcher: StubLauncher;
let logBus: LogBus;
let sink: CollectingSink;

function createService(
  capcut: CapcutTaskRunner | undefined,
  taskProgress?: ICapcutTaskProgressSink,
  customLauncher?: BrowserLauncher
): AutomationRunService {
  return new AutomationRunService(
    {
      workSources: stubWorkSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies: new StubProxySource(),
      browser: new StubBrowserRuntime(),
      accounts,
      logBus,
      launcher: () => customLauncher ?? launcher,
      capcut,
      taskProgress
    },
    { sleep: async () => {}, nextId: () => 'run-1' }
  );
}

beforeEach(() => {
  accounts = new StubAccounts();
  launcher = new StubLauncher();
  sink = new CollectingSink();
  logBus = new LogBus(sink, { maxBatchSize: 1000 });
});

describe('toTaskProgressRows', () => {
  const outcomes: TaskOutcome[] = [
    {
      key: 'capcut_web_pwa_install',
      title: 'Install the app',
      reward: 30,
      done: true,
      attempts: 1,
      proof: {
        actionKey: 'capcut_web_pwa_install',
        opId: 'capcut_web_pwa_install_7_2026-09-03',
        errNo: 0,
        errTips: '',
        at: Date.UTC(2026, 8, 3, 1, 0, 0)
      }
    },
    { key: 'capcut_web_video_studio_export', title: 'Export a video', reward: 120, done: false, attempts: 2 }
  ];

  const snapshot: TaskSnapshotSummary = {
    observedAt: 100,
    requiredAfter: 50,
    tasks: [
      { key: 'capcut_web_pwa_install', title: 'Install the app', reward: 30, status: 4 },
      { key: 'capcut_web_video_studio_export', title: 'Export a video', reward: 120, status: 1 }
    ],
    fresh: true,
    final: true,
    total: 2,
    done: 1,
    credits: 30,
    creditsTotal: 150,
    missing: ['capcut_web_video_studio_export']
  };

  it('never maps an absent snapshot key to task status 4', () => {
    const outcomes: TaskOutcome[] = [
      { key: 'task-a', title: 'Task A', reward: 10, done: true, attempts: 1 }
    ];
    const summary: TaskSnapshotSummary = {
      observedAt: 100,
      requiredAfter: 50,
      tasks: [{ key: 'task-b', title: 'Task B', reward: 20, status: 1 }],
      total: 1,
      done: 0,
      credits: 0,
      creditsTotal: 20,
      missing: ['task-b'],
      fresh: true,
      final: true
    };
    expect(toTaskProgressRows(outcomes, summary)).toEqual([
      expect.objectContaining({ key: 'task-b', status: 1 })
    ]);
    expect(toTaskProgressRows(outcomes, summary).some((row) => row.key === 'task-a')).toBe(false);
  });

  it('does not infer receipt rows when exact snapshot tasks are absent', () => {
    expect(toTaskProgressRows(outcomes, { ...snapshot, tasks: [] })).toEqual([]);
  });

  it('preserves exact non-complete server statuses', () => {
    const outcomes: TaskOutcome[] = [
      { key: 'task-a', title: 'Task A', reward: 10, done: false, attempts: 1 },
      { key: 'task-b', title: 'Task B', reward: 20, done: false, attempts: 1 },
      { key: 'task-c', title: 'Task C', reward: 30, done: true, attempts: 1 }
    ];
    const summary: TaskSnapshotSummary = {
      observedAt: 100,
      requiredAfter: 50,
      tasks: [
        { key: 'task-a', title: 'Task A', reward: 10, status: 1 },
        { key: 'task-b', title: 'Task B', reward: 20, status: 2 },
        { key: 'task-c', title: 'Task C', reward: 30, status: 4 }
      ],
      total: 3,
      done: 1,
      credits: 30,
      creditsTotal: 60,
      missing: ['task-a', 'task-b'],
      fresh: true,
      final: true
    };
    expect(toTaskProgressRows(outcomes, summary)).toEqual([
      expect.objectContaining({ key: 'task-a', status: 1 }),
      expect.objectContaining({ key: 'task-b', status: 2 }),
      expect.objectContaining({ key: 'task-c', status: 4 })
    ]);
  });

  it('lấy status từ snapshot của CapCut: trong missing là 1, còn lại là 4', () => {
    const rows = toTaskProgressRows(outcomes, snapshot);

    expect(rows.map((row) => [row.key, row.status])).toEqual([
      ['capcut_web_pwa_install', 4],
      ['capcut_web_video_studio_export', 1]
    ]);
  });

  it('mang op_id và mốc thời gian của do_action sang dạng ISO', () => {
    const rows = toTaskProgressRows(outcomes, snapshot);

    expect(rows[0].opId).toBe('capcut_web_pwa_install_7_2026-09-03');
    expect(rows[0].provedAt).toBe('2026-09-03T01:00:00.000Z');
    expect(rows[1].opId).toBeUndefined();
    expect(rows[1].provedAt).toBeUndefined();
  });

  it('bỏ qua cờ done nội bộ của engine khi nó lệch với snapshot', () => {
    // `outcome.done = true` nhưng CapCut vẫn liệt nhiệm vụ vào missing: chỉ
    // CapCut được quyền kết luận, nên phải ra status 1.
    const rows = toTaskProgressRows(outcomes, {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({ ...task, status: 1 })),
      missing: ['capcut_web_pwa_install', 'capcut_web_video_studio_export']
    });

    expect(rows.every((row) => row.status === 1)).toBe(true);
  });

  it('không nhiệm vụ nào thiếu thì mọi dòng là 4', () => {
    const rows = toTaskProgressRows(outcomes, {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({ ...task, status: 4 })),
      missing: []
    });
    expect(rows.every((row) => row.status === 4)).toBe(true);
  });

  /**
   * Đo được 04/09/2026 06:5x: tab chính của CapCut chết giữa lượt
   * ("❌ Tab chính đã bị đóng"), nên `waitForSnapshot` cuối không lấy được
   * `task_list` mới và rơi về snapshot ĐẦU TIÊN — báo cáo in
   * "CapCut ghi nhận: 0/12 nhiệm vụ" trong khi 3 nhiệm vụ đã có
   * `do_action err_no=0`. Ghi status 1 cho chúng là XOÁ tiến độ thật khỏi DB,
   * và lượt sau sẽ làm lại từ đầu.
   *
   * Proof vẫn được lưu để chẩn đoán/retry, nhưng không tự lật trạng thái task
   * khi không còn snapshot xác nhận.
   */
  it('retains proof without marking a missing task done when the snapshot is stale', () => {
    const rows = toTaskProgressRows(outcomes, {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({ ...task, status: 1 })),
      done: 0,
      credits: 0,
      stale: true,
      missing: ['capcut_web_pwa_install', 'capcut_web_video_studio_export']
    });

    const install = rows.find((row) => row.key === 'capcut_web_pwa_install');
    const exportRow = rows.find((row) => row.key === 'capcut_web_video_studio_export');
    expect(install?.status).toBe(1);
    expect(install?.opId).toBe('capcut_web_pwa_install_7_2026-09-03');
    expect(install?.provedAt).toBe('2026-09-03T01:00:00.000Z');
    // Nhiệm vụ KHÔNG có proof vẫn phải là 1 — không suy diễn hộ CapCut.
    expect(exportRow?.status).toBe(1);
  });

  /**
   * Mặt còn lại của cùng một luật: snapshot TƯƠI thì nó thắng. Proof mà CapCut
   * vừa đọc lại vẫn liệt vào `missing` nghĩa là CapCut không tính.
   */
  it('snapshot còn tươi thì proof KHÔNG được lật ngược missing', () => {
    const rows = toTaskProgressRows(outcomes, {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({ ...task, status: 1 })),
      missing: ['capcut_web_pwa_install', 'capcut_web_video_studio_export']
    });

    expect(rows.every((row) => row.status === 1)).toBe(true);
  });

  it('proof có err_no khác 0 thì KHÔNG được coi là xong', () => {
    const failed: TaskOutcome[] = [{
      key: 'capcut_web_pwa_install',
      title: 'Install the app',
      reward: 30,
      done: false,
      attempts: 1,
      proof: {
        actionKey: 'capcut_web_pwa_install',
        opId: 'op-1',
        errNo: 8001003,
        errTips: 'risk control',
        at: Date.UTC(2026, 8, 4, 1, 0, 0)
      }
    }];

    const rows = toTaskProgressRows(failed, {
      ...snapshot,
      tasks: [{ key: 'capcut_web_pwa_install', title: 'Install the app', reward: 30, status: 1 }],
      stale: true,
      missing: ['capcut_web_pwa_install']
    });
    expect(rows[0].status).toBe(1);
  });

  it('trả mảng rỗng khi engine không đọc được nhiệm vụ nào', () => {
    expect(toTaskProgressRows([], { ...snapshot, tasks: [], total: 0, done: 0, missing: [] })).toEqual([]);
  });
});

describe('AutomationRunService ghi tiến độ nhiệm vụ', () => {
  it('persists partial progress but counts a fatal renderer error once', async () => {
    const progress = new RecordingProgressSink();
    const result = { ...fullResult({ missing: [] }), fatalError: 'DOM_READ_TIMEOUT: canvas-area:mouse-move' };
    const service = createService(new StubCapcutRunner(result), progress);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();
    expect(progress.calls[0].rows).toEqual(result.tasks);
    expect(summary).toMatchObject({ accountsFailed: 1, accountsCompleted: 0, workersActive: 0 });
    expect(accounts.updates.some(e => e.data.credit === result.credits)).toBe(true);
  });
  it('gọi record với đúng accountId và đúng rows engine trả về', async () => {
    const progress = new RecordingProgressSink();
    const service = createService(new StubCapcutRunner(fullResult()), progress);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(progress.calls).toHaveLength(1);
    expect(progress.calls[0].accountId).toBe('acc-1');
    expect(progress.calls[0].rows).toEqual(TASKS);
  });

  it('ghi tiến độ cho từng luồng riêng biệt', async () => {
    const progress = new RecordingProgressSink();
    const service = createService(new StubCapcutRunner(fullResult()), progress);

    await service.start(baseConfig({
      threadCount: 2,
      emailSource: { mode: 'manual', entries: ['a@example.com|p', 'b@example.com|p'] }
    }));
    await service.waitForCompletion();

    expect(progress.calls.map((call) => call.accountId).sort()).toEqual(['acc-1', 'acc-2']);
  });

  it('vẫn ghi tiến độ khi lượt chạy còn thiếu nhiệm vụ', async () => {
    const progress = new RecordingProgressSink();
    const service = createService(new StubCapcutRunner(fullResult()), progress);

    await service.start(baseConfig());
    await service.waitForCompletion();

    // Còn thiếu 1 nhiệm vụ mà phần đã xong vẫn phải xuống DB, nếu không lượt sau
    // sẽ làm lại từ đầu.
    expect(progress.calls[0].rows.some((row) => row.status === 4)).toBe(true);
    expect(
      accounts.updates.some((entry) => String(entry.data.automationStep ?? '').includes('Còn thiếu'))
    ).toBe(true);
  });

  /**
   * Đọc DB sau lượt chạy 12/12 ngày 04/09/2026 thấy hàng account ghi
   * `automation_step = 'Đã dừng sau khi kiểm tra kết nối'` — câu của thời engine
   * chưa được cắm vào, khi luồng chỉ giữ browser rồi tắt. `shutdownThread` ghi đè
   * vô điều kiện nên kết quả thật ("Đủ 12/12 nhiệm vụ") bị xoá khỏi UI.
   */
  it('giữ kết quả nhiệm vụ làm bước cuối, không ghi đè bằng câu dừng máy', async () => {
    const service = createService(new StubCapcutRunner(fullResult({ missing: [] })));

    await service.start(baseConfig());
    await service.waitForCompletion();

    const lastStep = String(
      accounts.updates.filter((e) => e.id === 'acc-1').at(-1)?.data.automationStep ?? ''
    );
    expect(lastStep).toContain('nhiệm vụ');
    expect(lastStep).not.toContain('kiểm tra kết nối');
  });

  /**
   * Ưu đãi Pro đọc được rồi thì phải xuống DB: cột Subscription của bản xuất
   * account (AGENTS.md §21) lấy từ đây, và trước 04/09/2026 nó luôn rỗng.
   */
  it('ghi ưu đãi Pro engine đọc được vào hàng account', async () => {
    const runner = new StubCapcutRunner(fullResult({ subscription: 'Pro trial 7 ngày' }));
    const service = createService(runner);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(
      accounts.updates.some((entry) => entry.data.subscription === 'Pro trial 7 ngày')
    ).toBe(true);
  });

  it('không ghi subscription khi engine không đọc được gì', async () => {
    const service = createService(new StubCapcutRunner(fullResult()));

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(
      accounts.updates.every((entry) => !('subscription' in entry.data))
    ).toBe(true);
  });

  it('không gọi record khi account bị bỏ qua (không có dòng tiến độ nào)', async () => {
    const progress = new RecordingProgressSink();
    const runner = new StubCapcutRunner(fullResult({ skipped: true, tasks: [] }));
    const service = createService(runner, progress);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.calls).toBe(1);
    expect(progress.calls).toEqual([]);
  });

  it('chạy bình thường khi chưa nối chỗ ghi tiến độ', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.calls).toBe(1);
    expect(launcher.stopped).toEqual(['profile-1']);
  });

  it('không gọi record khi luồng không có engine nhiệm vụ', async () => {
    const progress = new RecordingProgressSink();
    const service = createService(undefined, progress);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(progress.calls).toEqual([]);
  });

  it('keeps the shared HTTP-only result contract unchanged', async () => {
    const httpOnlyResult: CapcutAccountResult = {
      total: 12,
      done: 12,
      credits: 670,
      creditsTotal: 670,
      missing: [],
      tasks: TASKS
    };
    const progress = new RecordingProgressSink();
    const service = new AutomationRunService({
      workSources: stubWorkSources, proxies: new StubProxySource(), browser: new StubBrowserRuntime(),
      emailOtp: { readOtp: async () => null }, accounts, logBus: new LogBus(new CollectingSink()),
      taskProgress: progress,
      httpOnlyRunner: { preflight: async () => {}, runAccount: async () => httpOnlyResult }
    });
    await service.start(baseConfig({ missionTransport: 'http-only', proxy: { mode: 'direct', entries: ['http://127.0.0.1:9000'] } }));
    const summary = await service.waitForCompletion();
    expect(summary.accountsCompleted).toBe(1);
    expect(progress.calls[0].rows).toEqual(TASKS);
  });
});

describe('AutomationRunService truyền cờ "bỏ qua nếu không có trial"', () => {
  /**
   * `CapcutEngineService` đọc `skipWithoutTrial` từ lâu nhưng không ai truyền nên
   * nó luôn `false` (audit 04/09/2026). Nay đi từ ô trên Dashboard xuống engine.
   */
  it('bật ở Dashboard thì runAccount nhận đúng cờ đó', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(baseConfig({ skipWithoutTrial: true }));
    await service.waitForCompletion();

    expect(runner.lastInput?.skipWithoutTrial).toBe(true);
  });

  it('không bật thì cờ vẫn xuống engine là false, không phải undefined', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(baseConfig({ skipWithoutTrial: false }));
    await service.waitForCompletion();

    expect(runner.lastInput?.skipWithoutTrial).toBe(false);
  });
});

describe('AutomationRunService truyền nhịp Dashboard xuống engine', () => {
  it('đưa cả bốn ô delay vào `pace` của runAccount', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(
      baseConfig({
        stepDelayMinMs: 800,
        stepDelayMaxMs: 2500,
        typeDelayMinMs: 60,
        typeDelayMaxMs: 200
      })
    );
    await service.waitForCompletion();

    // Engine mới là chỗ kẹp lên sàn (`humanType`), nên service truyền nguyên số
    // người dùng nhập — kể cả số nhỏ hơn khoảng đã đo.
    expect(runner.lastInput?.pace).toEqual({
      stepMinMs: 800,
      stepMaxMs: 2500,
      typeMinMs: 60,
      typeMaxMs: 200
    });
  });

  it('vẫn truyền `pace` khi người dùng để 0 — sàn của engine lo phần an toàn', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.lastInput?.pace).toEqual({
      stepMinMs: 0,
      stepMaxMs: 0,
      typeMinMs: 0,
      typeMaxMs: 0
    });
  });
});

describe('AutomationRunService khi ghi tiến độ thất bại', () => {
  it('throws checkpoint persistence failures to the caller', async () => {
    const failingRepo = {
      recordCheckpoint: () => {
        throw new Error('SQLITE_BUSY: database is locked');
      },
      upsertMany: () => {}
    };
    const sink = createTaskProgressSink(failingRepo);

    await expect(
      sink.record('acc-1', {
        rows: TASKS,
        receipt: fullResult().verification!,
        unsettledProofs: []
      })
    ).rejects.toThrow(AutomationTerminalError);

    try {
      await sink.record('acc-1', {
        rows: TASKS,
        receipt: fullResult().verification!,
        unsettledProofs: []
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AutomationTerminalError);
      const termErr = err as AutomationTerminalError;
      expect(termErr.state).toBe('failed');
      expect(termErr.reason.code).toBe('TASK_CHECKPOINT_PERSISTENCE_FAILED');
      expect(termErr.message).toBe('Không lưu được checkpoint nhiệm vụ.');
      expect(termErr.message).not.toContain('SQLITE');
      expect(termErr.message).not.toContain('acc-1');
    }
  });

  it('chuyển run thành failed với terminalReason TASK_CHECKPOINT_PERSISTENCE_FAILED và tắt profile', async () => {
    const service = createService(new StubCapcutRunner(fullResult({ missing: [] })), new ThrowingProgressSink());

    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('TASK_CHECKPOINT_PERSISTENCE_FAILED');
    expect(launcher.stopped).toEqual(['profile-1']);
  });
});

/**
 * Chỉ module `credit` có engine. Hai module còn lại chưa implement, và im lặng
 * chạy luồng credit thay thế là cách hỏng tệ nhất: người dùng tưởng đã làm đúng
 * việc mình chọn. UI đã khoá, đây là chốt thứ hai cho cấu hình cũ trong DB và
 * cho ai gọi IPC trực tiếp.
 */
describe('AutomationRunService từ chối module chưa implement', () => {
  for (const module of ['trial', 'team'] as const) {
    it(`không gọi engine khi module = "${module}"`, async () => {
      const runner = new StubCapcutRunner(fullResult());
      const progress = new RecordingProgressSink();
      const service = createService(runner, progress);

      await expect(service.start(baseConfig({ module }))).rejects.toMatchObject({
        state: 'blocked',
        reason: { code: 'PROVIDER_CONFIG_ERROR' }
      });

      expect(runner.calls).toBe(0);
      expect(progress.calls).toHaveLength(0);
      expect(launcher.stopped).toHaveLength(0);
    });
  }

  it('vẫn chạy engine khi module = "credit"', async () => {
    const runner = new StubCapcutRunner(fullResult());
    const service = createService(runner);

    await service.start(baseConfig({ module: 'credit' }));
    await service.waitForCompletion();

    expect(runner.calls).toBe(1);
  });
});

class RejectingCapcutRunner implements CapcutTaskRunner {
  async runAccount(): Promise<CapcutUiAccountResult> {
    throw new Error('signup failed');
  }
}

describe('AutomationRunService task progress workload failures and incomplete results', () => {
  it('preserves a CapCut workload error after launcher cleanup', async () => {
    const service = createService(new RejectingCapcutRunner());
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(accounts.updates.at(-1)?.data).toMatchObject({
      status: 'error',
      automationStep: 'Lỗi khi làm nhiệm vụ'
    });
    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsCompleted).toBe(0);
    expect(launcher.stopped).toEqual(['profile-1']);
  });

  it('treats a fresh incomplete CapCut result as one failed account', async () => {
    const progress = new RecordingProgressSink();
    const service = createService(new StubCapcutRunner(fullResult()), progress);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(accounts.updates.at(-1)?.data).toMatchObject({
      status: 'error',
      automationStep: 'Còn thiếu 1 nhiệm vụ'
    });
    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsCompleted).toBe(0);
    expect(progress.calls[0].rows.some((row) => row.status === 4)).toBe(true);
  });
});

class SequencedCapcutRunner implements CapcutTaskRunner {
  public calls: RunAccountInput[] = [];
  constructor(private readonly sequence: Array<(input: RunAccountInput) => Promise<CapcutUiAccountResult>>) {}

  async runAccount(input: RunAccountInput): Promise<CapcutUiAccountResult> {
    this.calls.push(input);
    const fn = this.sequence.shift();
    if (!fn) throw new Error('SequencedCapcutRunner ran out of steps');
    return fn(input);
  }
}

class SequencedLauncher implements BrowserLauncher {
  public readonly name = 'xcli' as const;
  public launched: Array<{ profileId: string; page: Page; context: BrowserContext }> = [];
  public stopped: string[] = [];
  public stopHooks: Array<(profileId: string) => Promise<void>> = [];
  public onLaunch?: (profileId: string) => void;
  public failStopProfileId?: string;

  async launch(): Promise<LaunchedProfile> {
    const id = 'profile-' + (this.launched.length + 1);
    const page = { id: 'page-' + id } as unknown as Page;
    const context = { id: 'context-' + id } as unknown as BrowserContext;
    this.launched.push({ profileId: id, page, context });
    this.onLaunch?.(id);
    return {
      page,
      context,
      port: 60000 + this.launched.length,
      profileId: id
    };
  }

  async stop(profileId: string): Promise<void> {
    this.stopped.push(profileId);
    if (this.failStopProfileId === profileId) {
      throw new Error(`Failed to stop ${profileId}`);
    }
    const hook = this.stopHooks.shift();
    if (hook) await hook(profileId);
  }
}

function fullCompleteResult(overrides: Partial<CapcutUiAccountResult> = {}): CapcutUiAccountResult {
  const completeTasks = TASKS.map((t) => ({ ...t, status: 4 as const }));
  return {
    ...fullResult({ missing: [], done: 2, total: 2, tasks: completeTasks }),
    ...overrides
  };
}

describe('Task 8: Recovery state machine and single-recycle resume', () => {
  it('awaits the engine-owned partial checkpoint before launching a replacement session', async () => {
    let checkpointHeld = true;
    let releaseCheckpoint: () => void = () => {};
    const checkpointPromise = new Promise<void>((resolve) => {
      releaseCheckpoint = () => {
        checkpointHeld = false;
        resolve();
      };
    });

    const events: string[] = [];
    const customLauncher = new SequencedLauncher();
    customLauncher.onLaunch = (id) => events.push('launch:' + id);

    const runner = new SequencedCapcutRunner([
      async (input) => {
        events.push('engine:session-1');
        const cp = input.onTaskCheckpoint({
          rows: TASKS,
          receipt: { ...fullResult().verification!, complete: false, final: false },
          unsettledProofs: []
        });
        events.push('checkpoint:started');
        await checkpointPromise;
        await cp;
        events.push('checkpoint:committed');
        return {
          ...fullResult(),
          fatalCode: 'DOM_READ_TIMEOUT',
          fatalError: 'DOM_READ_TIMEOUT: canvas-area:mouse-move'
        };
      },
      async (_input) => {
        events.push('engine:session-2');
        return fullCompleteResult();
      }
    ]);

    const progress = new RecordingProgressSink();
    const originalRecord = progress.record.bind(progress);
    progress.record = async (accId, cp) => {
      expect(customLauncher.launched).toHaveLength(1);
      expect(customLauncher.stopped).toHaveLength(0);
      return originalRecord(accId, cp);
    };

    const service = createService(runner, progress, customLauncher);
    const startPromise = service.start(baseConfig());

    await new Promise((r) => setTimeout(r, 20));
    expect(checkpointHeld).toBe(true);
    releaseCheckpoint();

    await startPromise;
    const summary = await service.waitForCompletion();
    expect(summary.state).toBe('completed');
    expect(events).toContain('checkpoint:committed');
    expect(events.indexOf('checkpoint:committed')).toBeLessThan(events.indexOf('launch:profile-2'));
  });

  it('does not launch replacement when the engine checkpoint rejects', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async (input) => {
        await input.onTaskCheckpoint({
          rows: TASKS,
          receipt: fullResult().verification!,
          unsettledProofs: []
        });
        return {
          ...fullResult(),
          fatalCode: 'DOM_READ_TIMEOUT',
          fatalError: 'DOM_READ_TIMEOUT'
        };
      }
    ]);
    const throwingProgress = new ThrowingProgressSink();
    const service = createService(runner, throwingProgress, customLauncher);

    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('TASK_CHECKPOINT_PERSISTENCE_FAILED');
    expect(customLauncher.launched).toHaveLength(1);
    expect(customLauncher.stopped).toEqual(['profile-1']);
  });

  it('reuses account password and proxy while creating no second account or mailbox', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT'
      }),
      async () => fullCompleteResult()
    ]);
    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('completed');
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0].accountId).toBe(runner.calls[1].accountId);
    expect(runner.calls[0].email).toBe(runner.calls[1].email);
    expect(runner.calls[0].password).toBe(runner.calls[1].password);
    expect(accounts.createdCount).toBe(1);
  });

  it('runs the replacement with existing-only auth and a fresh page/context', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT'
      }),
      async () => fullCompleteResult()
    ]);
    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0].authAttempt ?? 'initial').toBe('initial');
    expect(runner.calls[1].authAttempt).toBe('existing-only');
    expect(runner.calls[0].page).not.toBe(runner.calls[1].page);
    expect(runner.calls[0].context).not.toBe(runner.calls[1].context);
    expect(runner.calls[1].page).toBe(customLauncher.launched[1].page);
    expect(runner.calls[1].context).toBe(customLauncher.launched[1].context);
  });

  it('stops old profile before replacement launch starts', async () => {
    const events: string[] = [];
    const customLauncher = new SequencedLauncher();
    const originalLaunch = customLauncher.launch.bind(customLauncher);
    customLauncher.launch = async () => {
      const res = await originalLaunch();
      events.push('launch:' + res.profileId);
      return res;
    };
    customLauncher.stopHooks.push(async (id) => {
      events.push('stop:' + id);
    });

    const runner = new SequencedCapcutRunner([
      async (input) => {
        events.push('engine:session-1');
        await input.onTaskCheckpoint({ rows: TASKS, receipt: { ...fullResult().verification!, complete: false, final: false }, unsettledProofs: [] });
        events.push('checkpoint:partial');
        return {
          ...fullResult(),
          fatalCode: 'DOM_READ_TIMEOUT',
          fatalError: 'DOM_READ_TIMEOUT',
          unsettledProofs: [{ key: 'task_1', proof: { actionKey: 'task_1', opId: 'op_1', errNo: 0, errTips: '', at: 100 } }]
        };
      },
      async (input) => {
        events.push('engine:session-2');
        if (input.unsettledProofs && input.unsettledProofs.length > 0) {
          events.push('reconcile:unsettled-proofs');
        }
        await input.onTaskCheckpoint({ rows: TASKS, receipt: { ...fullResult({ missing: [] }).verification!, complete: true, final: true }, unsettledProofs: [] });
        events.push('checkpoint:final');
        return fullCompleteResult();
      }
    ]);

    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    events.push('stop:' + customLauncher.stopped[1]);
    expect(summary.state).toBe('completed');
    expect(events).toEqual([
      'launch:profile-1',
      'engine:session-1',
      'checkpoint:partial',
      'stop:profile-1',
      'launch:profile-2',
      'engine:session-2',
      'reconcile:unsettled-proofs',
      'checkpoint:final',
      'stop:profile-2'
    ]);
  });

  it('does not launch a replacement when old profile stop fails', async () => {
    const customLauncher = new SequencedLauncher();
    customLauncher.failStopProfileId = 'profile-1';

    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT'
      }),
      async () => fullCompleteResult()
    ]);

    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('failed');
    expect(summary.terminalReason?.code).toBe('RESOURCE_CLEANUP_FAILED');
    expect(customLauncher.launched).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
  });

  it('allows exactly one recycle then fails after a second DOM timeout', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT: 1'
      }),
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT: 2'
      })
    ]);

    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.accountsFailed).toBe(1);
    expect(summary.accountsCompleted).toBe(0);
    expect(customLauncher.launched).toHaveLength(2);
    expect(runner.calls).toHaveLength(2);
    expect(customLauncher.stopped).toEqual(['profile-1', 'profile-2']);
  });

  it('does not recycle an unclassified mission error', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalError: 'SOME_RANDOM_CRASH'
      })
    ]);

    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.accountsFailed).toBe(1);
    expect(customLauncher.launched).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
    expect(customLauncher.stopped).toEqual(['profile-1']);
  });

  it('does not launch replacement when Stop arrives after old stop', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT'
      }),
      async () => fullCompleteResult()
    ]);

    const service = createService(runner, undefined, customLauncher);
    customLauncher.stopHooks.push(async () => {
      void service.stop();
    });

    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('stopped');
    expect(customLauncher.launched).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
  });

  it('stops both old and replacement profiles exactly once on success', async () => {
    const customLauncher = new SequencedLauncher();
    const runner = new SequencedCapcutRunner([
      async () => ({
        ...fullResult(),
        fatalCode: 'DOM_READ_TIMEOUT',
        fatalError: 'DOM_READ_TIMEOUT'
      }),
      async () => fullCompleteResult()
    ]);

    const service = createService(runner, undefined, customLauncher);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('completed');
    expect(summary.accountsCompleted).toBe(1);
    expect(customLauncher.launched).toHaveLength(2);
    expect(customLauncher.stopped).toEqual(['profile-1', 'profile-2']);
  });

  it('B07 persists unsettled proofs via recordUnsettled when runner throws TaskEvidenceError', async () => {
    const proofs = [{
      key: 'capcut_web_pwa_install',
      proof: {
        actionKey: 'capcut_web_pwa_install',
        opId: 'op-b07',
        errNo: 0 as const,
        errTips: '',
        at: 1700000000000
      }
    }];
    const runner: CapcutTaskRunner = {
      runAccount: async () => {
        throw new TaskEvidenceError('Snapshot failed', proofs);
      }
    };
    let recordedUnsettled: unknown = null;
    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async (_accountId, _runId, p) => {
        recordedUnsettled = p;
      }
    };
    const service = createService(runner, progressSink);
    await service.start(baseConfig());
    const summary = await service.waitForCompletion();
    expect(summary.accountsFailed).toBe(1);
    expect(recordedUnsettled).toEqual(proofs);
  });

  it('V03: rejects onAcceptedProof callback when iterationOwner token is replaced or deleted', async () => {
    let capturedCallback: ((p: UnsettledTaskProof) => Promise<void>) | undefined;
    let runnerRelease!: () => void;
    const runnerPending = new Promise<void>((resolve) => { runnerRelease = resolve; });

    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        capturedCallback = input.onAcceptedProof;
        await runnerPending;
        return fullCompleteResult();
      }
    };

    const recorded: UnsettledTaskProof[] = [];
    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async (_acc, _run, proofs) => {
        recorded.push(...proofs);
      }
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());

    while (!capturedCallback) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const privateService = service as unknown as { iterationOwners: Map<string, unknown> };
    const accountId = Array.from(privateService.iterationOwners.keys())[0] as string;
    expect(accountId).toBeDefined();

    // Replace iterationOwner token with a new token
    privateService.iterationOwners.set(accountId, {});

    const proof = {
      key: 'task-1',
      proof: { actionKey: 'task-1', opId: 'op-1', errNo: 0 as const, errTips: '', at: 1000 }
    };

    await expect(capturedCallback(proof)).rejects.toThrow('STALE_ACK_PROOF_OWNER');
    expect(recorded).toHaveLength(0);

    runnerRelease();
    await service.waitForCompletion();
  });

  it('V03: rejects onAcceptedProof callback after invocation has closed', async () => {
    let capturedCallback: ((p: UnsettledTaskProof) => Promise<void>) | undefined;

    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        capturedCallback = input.onAcceptedProof;
        return fullCompleteResult();
      }
    };

    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async () => {}
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());
    await service.waitForCompletion();

    expect(capturedCallback).toBeDefined();

    const proof = {
      key: 'task-1',
      proof: { actionKey: 'task-1', opId: 'op-1', errNo: 0 as const, errTips: '', at: 1000 }
    };

    await expect(capturedCallback!(proof)).rejects.toThrow('INVOCATION_CLOSED');
  });

  it('V03: deduplicates concurrent onAcceptedProof calls to 1 physical write', async () => {
    let capturedCallback: ((p: UnsettledTaskProof) => Promise<void>) | undefined;
    let runnerRelease!: () => void;
    const runnerPending = new Promise<void>((resolve) => { runnerRelease = resolve; });

    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        capturedCallback = input.onAcceptedProof;
        await runnerPending;
        return fullCompleteResult();
      }
    };

    let writeCount = 0;
    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async () => {
        writeCount++;
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());

    while (!capturedCallback) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const proof = {
      key: 'task-dedup',
      proof: { actionKey: 'task-dedup', opId: 'op-dedup', errNo: 0 as const, errTips: '', at: 2000 }
    };

    await Promise.all([
      capturedCallback(proof),
      capturedCallback(proof)
    ]);

    expect(writeCount).toBe(1);

    runnerRelease();
    await service.waitForCompletion();
  });

  it('V03: throws typed persistence failure when taskProgress.recordUnsettled is missing', async () => {
    let capturedCallback: ((p: UnsettledTaskProof) => Promise<void>) | undefined;
    let runnerRelease!: () => void;
    const runnerPending = new Promise<void>((resolve) => { runnerRelease = resolve; });

    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        capturedCallback = input.onAcceptedProof;
        await runnerPending;
        return fullCompleteResult();
      }
    };

    // Sink without recordUnsettled
    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {}
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());

    while (!capturedCallback) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const proof = {
      key: 'task-no-sink',
      proof: { actionKey: 'task-no-sink', opId: 'op-no-sink', errNo: 0 as const, errTips: '', at: 3000 }
    };

    await expect(capturedCallback(proof)).rejects.toMatchObject({
      name: 'AutomationTerminalError',
      reason: { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' }
    });

    runnerRelease();
    await service.waitForCompletion();
  });

  it('V02: persists unsettled proofs on proof-bearing cancellation even when aborted', async () => {
    const proofs = [
      { key: 't1', proof: { actionKey: 't1', opId: 'op-1', errNo: 0 as const, errTips: '', at: 1000 } },
      { key: 't2', proof: { actionKey: 't2', opId: 'op-2', errNo: 0 as const, errTips: '', at: 1001 } },
      { key: 't3', proof: { actionKey: 't3', opId: 'op-3', errNo: 0 as const, errTips: '', at: 1002 } },
      { key: 't4', proof: { actionKey: 't4', opId: 'op-4', errNo: 0 as const, errTips: '', at: 1003 } }
    ];

    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) return resolve();
          input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new TaskEvidenceError('Cancelled with proofs', proofs);
      }
    };

    const recorded: UnsettledTaskProof[] = [];
    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async (_acc, _run, p) => {
        recorded.push(...p);
      }
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());

    await new Promise((r) => setTimeout(r, 20));
    await service.stop('USER_STOP');
    const summary = await service.waitForCompletion();

    expect(summary.accountsStopped).toBe(1);
    expect(recorded).toHaveLength(4);
    expect(recorded.map((r) => r.key)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('V02: deduplicates fallback TaskEvidenceError against already streamed onAcceptedProof', async () => {
    const proofs = [
      { key: 't1', proof: { actionKey: 't1', opId: 'op-1', errNo: 0 as const, errTips: '', at: 1000 } },
      { key: 't2', proof: { actionKey: 't2', opId: 'op-2', errNo: 0 as const, errTips: '', at: 1001 } },
      { key: 't3', proof: { actionKey: 't3', opId: 'op-3', errNo: 0 as const, errTips: '', at: 1002 } },
      { key: 't4', proof: { actionKey: 't4', opId: 'op-4', errNo: 0 as const, errTips: '', at: 1003 } }
    ];

    let writeCount = 0;
    const runner: CapcutTaskRunner = {
      runAccount: async (input) => {
        for (const p of proofs) {
          await input.onAcceptedProof?.(p);
        }
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) return resolve();
          input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new TaskEvidenceError('Aborted fallback', proofs);
      }
    };

    const progressSink: ICapcutTaskProgressSink = {
      record: async () => {},
      recordUnsettled: async () => {
        writeCount++;
      }
    };

    const service = createService(runner, progressSink);
    await service.start(baseConfig());

    await new Promise((r) => setTimeout(r, 20));
    await service.stop('USER_STOP');
    const summary = await service.waitForCompletion();

    expect(summary.accountsStopped).toBe(1);
    expect(writeCount).toBe(4);
  });
});
