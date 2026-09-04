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
  type IEmailSourceApi,
  type ICapcutTaskProgressSink,
  type IProxyLeaseSource,
  type StartedProfile
} from '../AutomationRunService';
import { toTaskProgressRows } from '../CapcutEngineService';
import type { BrowserLauncher, LaunchedProfile } from '../capcut/launcher';
import type { TaskSnapshotSummary } from '../capcut/runTasks';
import type { TaskOutcome } from '../capcut/types';
import { LogBus, type ILogSink } from '../LogBus';
import {
  AutomationRunConfigSchema,
  type AutomationRunConfigDTO
} from '../../../shared/schemas/automation.schema';
import type { AcquiredProxyLease } from '../ProxyLeaseManager';
import type { EmailPurchaseResult } from '../EmailPurchaseService';

class CollectingSink implements ILogSink {
  public rows: unknown[] = [];
  insertBatch(logs: unknown[]): void { this.rows.push(...logs); }
}

class StubEmailSource implements IEmailSourceApi {
  async purchase(): Promise<EmailPurchaseResult> {
    return { purchased: [], failures: [] };
  }
  markConsumed(): void {}
}

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
  private counter = 0;

  create(): { id: string } {
    this.counter += 1;
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

type RunAccountInput = Parameters<CapcutTaskRunner['runAccount']>[0];

class StubCapcutRunner implements CapcutTaskRunner {
  public calls = 0;
  /** Giữ lại input để kiểm chỗ nối cấu hình Dashboard → engine. */
  public lastInput: RunAccountInput | null = null;
  constructor(private readonly result: CapcutAccountResult) {}

  async runAccount(input: RunAccountInput): Promise<CapcutAccountResult> {
    this.calls += 1;
    this.lastInput = input;
    return this.result;
  }
}

class RecordingProgressSink implements ICapcutTaskProgressSink {
  public calls: Array<{ accountId: string; rows: CapcutAccountResult['tasks'] }> = [];
  record(accountId: string, rows: CapcutAccountResult['tasks']): void {
    this.calls.push({ accountId, rows });
  }
}

class ThrowingProgressSink implements ICapcutTaskProgressSink {
  public calls = 0;
  record(): void {
    this.calls += 1;
    throw new Error('database is locked');
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

function fullResult(overrides: Partial<CapcutAccountResult> = {}): CapcutAccountResult {
  return {
    done: 1,
    total: 2,
    credits: 30,
    creditsTotal: 150,
    missing: ['capcut_web_video_studio_export'],
    tasks: TASKS,
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
  taskProgress?: ICapcutTaskProgressSink
): AutomationRunService {
  return new AutomationRunService(
    {
      emails: new StubEmailSource(),
      proxies: new StubProxySource(),
      browser: new StubBrowserRuntime(),
      accounts,
      logBus,
      launcher: () => launcher,
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
    total: 2,
    done: 1,
    credits: 30,
    creditsTotal: 150,
    missing: ['capcut_web_video_studio_export']
  };

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
      missing: ['capcut_web_pwa_install', 'capcut_web_video_studio_export']
    });

    expect(rows.every((row) => row.status === 1)).toBe(true);
  });

  it('không nhiệm vụ nào thiếu thì mọi dòng là 4', () => {
    const rows = toTaskProgressRows(outcomes, { ...snapshot, missing: [] });
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
   * `do_action err_no=0` là đúng bằng chứng mà AGENTS.md §30 công nhận; khi tab
   * đã chết thì không còn cách nào đọc lại `task_status` nữa.
   */
  it('nhiệm vụ có do_action err_no=0 vẫn là 4 dù snapshot cuối bị cũ', () => {
    const rows = toTaskProgressRows(outcomes, {
      ...snapshot,
      done: 0,
      credits: 0,
      stale: true,
      missing: ['capcut_web_pwa_install', 'capcut_web_video_studio_export']
    });

    const install = rows.find((row) => row.key === 'capcut_web_pwa_install');
    const exportRow = rows.find((row) => row.key === 'capcut_web_video_studio_export');
    expect(install?.status).toBe(4);
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
      stale: true,
      missing: ['capcut_web_pwa_install']
    });
    expect(rows[0].status).toBe(1);
  });

  it('trả mảng rỗng khi engine không đọc được nhiệm vụ nào', () => {
    expect(toTaskProgressRows([], { ...snapshot, total: 0, done: 0, missing: [] })).toEqual([]);
  });
});

describe('AutomationRunService ghi tiến độ nhiệm vụ', () => {
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
  it('vẫn kết thúc luồng và tắt profile', async () => {
    const service = createService(new StubCapcutRunner(fullResult()), new ThrowingProgressSink());

    await service.start(baseConfig());
    const summary = await service.waitForCompletion();

    expect(summary.state).toBe('stopped');
    expect(summary.threadsStarted).toBe(1);
    expect(launcher.stopped).toEqual(['profile-1']);
  });

  it('vẫn cập nhật kết quả nhiệm vụ lên account', async () => {
    const service = createService(new StubCapcutRunner(fullResult()), new ThrowingProgressSink());

    await service.start(baseConfig());
    await service.waitForCompletion();

    // Lỗi ghi DB không được biến thành trạng thái error của account.
    expect(accounts.updates.some((entry) => entry.data.status === 'error')).toBe(false);
    expect(accounts.updates.some((entry) => entry.data.credit === 30)).toBe(true);
  });

  it('chỉ ghi một dòng WARNING, không phải ERROR', async () => {
    const failing = new ThrowingProgressSink();
    const service = createService(new StubCapcutRunner(fullResult()), failing);

    await service.start(baseConfig());
    await service.waitForCompletion();
    logBus.flush();

    const rows = sink.rows as Array<{ status: string; message: string; accountId?: string }>;
    const warning = rows.find((row) => row.message.includes('Không lưu được tiến độ nhiệm vụ'));

    expect(failing.calls).toBe(1);
    expect(warning?.status).toBe('WARNING');
    expect(warning?.message).toContain('database is locked');
    expect(warning?.accountId).toBe('acc-1');
    expect(rows.some((row) => row.status === 'ERROR')).toBe(false);
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

      await service.start(baseConfig({ module }));
      await service.waitForCompletion();
      logBus.flush();

      const rows = sink.rows as Array<{ status: string; message: string }>;
      const refusal = rows.find((row) => row.message.includes('chưa được implement'));

      expect(runner.calls).toBe(0);
      expect(progress.calls).toHaveLength(0);
      expect(refusal?.status).toBe('WARNING');
      expect(refusal?.message).toContain(module);
      // Browser vẫn được mở rồi tắt: phần proxy/profile/mailbox vẫn được chứng minh.
      expect(launcher.stopped).toHaveLength(1);
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
