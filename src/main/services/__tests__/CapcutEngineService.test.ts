/**
 * =============================================================================
 * CAPCUT ENGINE SERVICE — DỊCH `isNewAccount` THÀNH `forceSignup`
 * =============================================================================
 * File này khoá lại đúng một quyết định: engine service phải nói cho
 * `ensureInApp` biết account có mới hay không, thay vì để `looksExisting()` đoán
 * từ `source: 'db'` (luôn ra "đã tồn tại", nên hộp thư vừa thuê cũng bị đẩy vào
 * đường ĐĂNG NHẬP trước — xem `capcutSignupPath.test.ts`).
 *
 * Bốn module của engine bị `vi.mock` vì chúng đều cần một `Page` Playwright thật;
 * cái được kiểm là tham số `runAccount` truyền xuống, không phải hành vi của mock.
 * =============================================================================
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { createDirectUiInteraction } from '../capcut/uiInteractionScheduler';

const ensureInApp = vi.fn();
const checkProTrial = vi.fn();
const isEligible = vi.fn();
const ensureSampleImage = vi.fn();
const runAllTasks = vi.fn();
const setDumpDir = vi.fn();
const capture = vi.hoisted(() => ({ mark: vi.fn(), stop: vi.fn(async () => ({ requests: 0, ioErrors: 0 })) }));
vi.mock('../capcut/httpCapture', () => ({ attachRedactedHttpCapture: vi.fn(() => capture) }));
afterEach(() => vi.unstubAllEnvs());

vi.mock('../capcut/auth', () => ({
  ensureInApp: (...args: unknown[]) => ensureInApp(...args)
}));
vi.mock('../capcut/trial', () => ({
  MIN_TRIAL_DAYS: 7,
  checkProTrial: (...args: unknown[]) => checkProTrial(...args),
  isEligible: (...args: unknown[]) => isEligible(...args)
}));
vi.mock('../capcut/image', () => ({
  ensureSampleImage: (...args: unknown[]) => ensureSampleImage(...args)
}));
vi.mock('../capcut/runTasks', async (importOriginal) => ({
  ...await importOriginal<typeof import('../capcut/runTasks')>(),
  runAllTasks: (...args: unknown[]) => runAllTasks(...args)
}));
vi.mock('../capcut/diag', () => ({
  setDumpDir: (...args: unknown[]) => setDumpDir(...args)
}));

const { CapcutEngineService } = await import('../CapcutEngineService');

type AuthOptions = { forceSignup?: boolean; log: (msg: string) => void };

function runInput(overrides: Record<string, unknown> = {}) {
  const signal = (overrides.signal as AbortSignal | undefined) ?? new AbortController().signal;
  return {
    // Page giả phải có `on`: `runAccount` đăng ký nghe `close`/`crash` của tab.
    page: listeningPage().page,
    context: {} as unknown as BrowserContext,
    email: 'mail1@gmail.com',
    password: 'Str0ngPass',
    accountId: 'acc-1',
    isNewAccount: false,
    signal,
    ui: createDirectUiInteraction(signal),
    log: () => {},
    ...overrides
  } as Parameters<InstanceType<typeof CapcutEngineService>['runAccount']>[0];
}

/** Page giả chỉ ghi lại các sự kiện được đăng ký. */
function listeningPage(): { page: Page; events: string[] } {
  const events: string[] = [];
  const page = {
    isClosed: () => false,
    on: (event: string) => {
      events.push(event);
      return page;
    }
  } as unknown as Page;
  return { page, events };
}

/** Tham số thứ 4 của `ensureInApp` — nơi `forceSignup` phải xuất hiện. */
function lastAuthOptions(): AuthOptions {
  return ensureInApp.mock.calls.at(-1)?.[3] as AuthOptions;
}

function exactSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    observedAt: 201,
    requiredAfter: 200,
    tasks: [{ key: 'pwa', title: 'Install', reward: 70, status: 4 }],
    total: 1,
    done: 1,
    credits: 70,
    creditsTotal: 70,
    missing: [],
    fresh: true,
    final: true,
    ...overrides
  };
}

beforeEach(() => {
  ensureInApp.mockReset().mockResolvedValue({ mode: 'signup', created: true });
  checkProTrial.mockReset().mockResolvedValue({
    status: 'eligible',
    canTrial: true,
    days: 7,
    trialPrice: '0₫',
    listPrice: '222,000₫',
    hasStartButton: true
  });
  isEligible.mockReset().mockReturnValue(true);
  ensureSampleImage.mockReset().mockReturnValue('C:/tmp/assets/sample.png');
  runAllTasks.mockReset().mockResolvedValue({
    outcomes: [],
    snapshot: exactSnapshot(),
    unsettledProofs: []
  });
  setDumpDir.mockReset();
});

describe('CapcutEngineService.runAccount', () => {
  it.each(['success', 'auth-error', 'cancel'])('installs opt-in task diagnostics before auth and disposes on %s', async (mode) => {
    vi.stubEnv('CAPCUT_DIAG_TASK_LIST', '1');
    const context = new EventEmitter();
    const controller = new AbortController();
    const log = vi.fn();
    ensureInApp.mockImplementationOnce(async () => {
      context.emit('request', { url: () => 'https://edit-api-sg.capcut.com/task/v1/task_list?token=private-key' });
      if (mode === 'auth-error') throw new Error('auth failed');
      if (mode === 'cancel') controller.abort(new Error('Stop'));
      return { mode: 'signup', created: true };
    });
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const run = engine.runAccount(runInput({ context, signal: controller.signal, log }));
    if (mode === 'success') await run;
    else await expect(run).rejects.toThrow();
    const diagnostics = log.mock.calls.filter(call => call[1] === 'Task diagnostics');
    expect(diagnostics).toHaveLength(1);
    expect(JSON.parse(diagnostics[0][2])).toMatchObject({ phase: 'request', requestId: 1 });
    expect(JSON.stringify(diagnostics)).not.toContain('private-key');
    expect(context.eventNames()).toEqual([]);
  });

  it.each(['success', 'auth-error', 'cancel', 'skipped'])('awaits capture flush for %s without losing account outcome', async (mode) => {
    vi.stubEnv('CAPCUT_CAPTURE_HTTP', '1');
    const events: string[] = [];
    capture.mark.mockImplementation(s => { events.push(s); });
    capture.stop.mockImplementationOnce(async () => { await Promise.resolve(); events.push('flushed'); return { requests: 0, ioErrors: 0 }; });
    const controller = new AbortController();
    ensureInApp.mockImplementationOnce(async () => {
      events.push('auth');
      if (mode === 'auth-error') throw new Error('auth failure');
      if (mode === 'cancel') controller.abort(new Error('Stop'));
      return { mode: 'signup', created: true };
    });
    if (mode === 'skipped') isEligible.mockReturnValue(false);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const result = engine.runAccount(runInput({ signal: controller.signal, skipWithoutTrial: mode === 'skipped' }));
    if (['auth-error','cancel'].includes(mode)) await expect(result).rejects.toThrow();
    else await result;
    expect(events.indexOf('signup')).toBeLessThan(events.indexOf('auth'));
    expect(events.at(-1)).toBe('flushed');
    if (mode === 'success') expect(runAllTasks.mock.calls[0][0].captureStage).toBeTypeOf('function');
  });
  it('returns observed partial progress with a fatal error instead of discarding it', async () => {
    runAllTasks.mockResolvedValueOnce({
      outcomes: [{ key: 'pwa', title: 'Install', reward: 70, done: true, attempts: 1 }],
      snapshot: exactSnapshot({
        tasks: [
          { key: 'pwa', title: 'Install', reward: 70, status: 4 },
          { key: 'canvas', title: 'Canvas', reward: 40, status: 1 }
        ],
        total: 2,
        done: 1,
        creditsTotal: 110,
        missing: ['canvas'],
        final: false
      }),
      unsettledProofs: [],
      fatalError: new Error('DOM_READ_TIMEOUT: canvas-area:mouse-move')
    });
    const result = await new CapcutEngineService({ userDataDir: 'C:/tmp/userData' }).runAccount(runInput());
    expect(result).toMatchObject({
      credits: 70,
      fatalError: 'DOM_READ_TIMEOUT: canvas-area:mouse-move',
      tasks: [
        { key: 'pwa', title: 'Install', reward: 70, status: 4 },
        { key: 'canvas', title: 'Canvas', reward: 40, status: 1 }
      ]
    });
  });
  it('does not recover another page or start trial after Stop during authentication', async () => {
    const controller = new AbortController();
    ensureInApp.mockImplementationOnce(async () => {
      controller.abort(new Error('stop'));
      return { mode: 'login', created: false };
    });
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    await expect(engine.runAccount(runInput({ signal: controller.signal }))).rejects.toThrow('stop');
    expect(checkProTrial).not.toHaveBeenCalled();
    expect(runAllTasks).not.toHaveBeenCalled();
  });

  it('never starts authentication when Stop was already requested', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    await expect(engine.runAccount(runInput({ signal: controller.signal }))).rejects.toThrow('stop');
    expect(ensureInApp).not.toHaveBeenCalled();
  });
  it('bắt buộc đường ĐĂNG KÝ khi account là mới', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: true }));

    expect(lastAuthOptions().forceSignup).toBe(true);
  });

  it('không bắt buộc đăng ký khi account đã tồn tại', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: false }));

    expect(lastAuthOptions().forceSignup).toBe(false);
  });

  it('vẫn báo account đến từ DB để nhánh fallback đăng nhập không đổi', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ isNewAccount: true }));

    expect(ensureInApp.mock.calls[0][2]).toEqual({
      email: 'mail1@gmail.com',
      password: 'Str0ngPass',
      source: 'db'
    });
  });

  /**
   * Hai lượt chạy 04/09/2026 bị cắt ngắn bởi `❌ Tab chính đã bị đóng` và
   * `Target page, context or browser has been closed`, mà không có dòng nào cho
   * biết AI đóng nó và đóng lúc nào. `page.on('crash')` phân biệt được "renderer
   * sập" với "có ai gọi close()" — hai nguyên nhân cần hai cách sửa khác nhau.
   */
  it('nghe sự kiện đóng và crash của tab chính để lần sau có địa chỉ', async () => {
    const { page, events } = listeningPage();
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({ page }));

    expect(events).toContain('close');
    expect(events).toContain('crash');
  });

  /**
   * Cổng trial đọc được `gói Pro: 222,000₫ → 0₫ cho 7 ngày` và LOG ra, nhưng
   * không trả gì cho người gọi — nên hàng `accounts.subscription` rỗng và cột
   * Subscription khi xuất Excel/CSV (AGENTS.md §21) trống trơn.
   */
  it('trả về ưu đãi Pro đã đọc được để account ghi lại', async () => {
    checkProTrial.mockResolvedValue({ canTrial: true, days: 7, trialPrice: '0₫', listPrice: '222,000₫' });
    isEligible.mockReturnValue(true);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    const result = await engine.runAccount(runInput());

    expect(result.subscription).toBe('Pro trial 7 ngày');
  });

  it('nói rõ khi account không có ưu đãi, thay vì để trống', async () => {
    checkProTrial.mockResolvedValue({ status: 'ineligible', canTrial: false, days: 0, trialPrice: '', listPrice: '', hasStartButton: false });
    isEligible.mockReturnValue(false);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    const result = await engine.runAccount(runInput());

    expect(result.subscription).toBe('Không có ưu đãi');
  });

  it('blocks an unknown trial read without inventing seven days or running tasks', async () => {
    checkProTrial.mockResolvedValue({
      status: 'unknown',
      canTrial: false,
      days: 0,
      trialPrice: '',
      listPrice: '',
      hasStartButton: false,
      error: 'không thấy thẻ gói Pro trong modal'
    });
    isEligible.mockReturnValue(false);
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    const result = await engine.runAccount(runInput({ skipWithoutTrial: false }));

    expect(runAllTasks).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      authenticated: true,
      skipped: true,
      subscription: 'Không xác định ưu đãi',
      fatalError: 'không thấy thẻ gói Pro trong modal',
      verification: null,
      unsettledProofs: []
    });
    expect(result.subscription).not.toBe('Pro trial 7 ngày');
  });

  it('logs authentication and trial-check stage timings', async () => {
    const messages: string[] = [];
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

    await engine.runAccount(runInput({
      log: (_status: string, _step: string, message: string) => {
        messages.push(message);
      }
    }));

    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /^stage=authentication-otp elapsedMs=\d+ outcome=success$/
      ),
      expect.stringMatching(
        /^stage=trial-check elapsedMs=\d+ outcome=success$/
      )
    ]));
  });

  it('initial newly-purchased account preserves signup-first behavior', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const getOtp = vi.fn(async () => '123456');

    await engine.runAccount(runInput({
      authAttempt: 'initial',
      isNewAccount: true,
      getOtp
    }));

    const options = lastAuthOptions() as {
      forceSignup?: boolean;
      allowSignupFallback?: boolean;
      getOtp?: (email: string) => Promise<string>;
    };
    expect(options.forceSignup).toBe(true);
    expect(options.allowSignupFallback).toBe(true);
    expect(options.getOtp).toBeDefined();
  });

  it('engine returns authenticated true for a mission-level fatal result', async () => {
    runAllTasks.mockResolvedValueOnce({
      outcomes: [{ key: 'pwa', title: 'Install', reward: 70, done: true, attempts: 1 }],
      snapshot: exactSnapshot({
        tasks: [
          { key: 'pwa', title: 'Install', reward: 70, status: 4 },
          { key: 'canvas', title: 'Canvas', reward: 40, status: 1 }
        ],
        total: 2,
        done: 1,
        creditsTotal: 110,
        missing: ['canvas'],
        final: false
      }),
      unsettledProofs: [],
      fatalError: new Error('DOM_READ_TIMEOUT: canvas-area:mouse-move')
    });
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const result = await engine.runAccount(runInput());
    expect(result.authenticated).toBe(true);
    expect(result.verification).toBeDefined();
    expect(result.verification?.complete).toBe(false);
    expect(result.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'pwa' })]));
  });

  it('engine exposes DOM_READ_TIMEOUT as a typed fatalCode', async () => {
    const { DomReadTimeoutError } = await import('../capcut/cancellation');
    runAllTasks.mockResolvedValueOnce({
      outcomes: [{ key: 'pwa', title: 'Install', reward: 70, done: true, attempts: 1 }],
      snapshot: exactSnapshot({
        tasks: [
          { key: 'pwa', title: 'Install', reward: 70, status: 4 },
          { key: 'canvas', title: 'Canvas', reward: 40, status: 1 }
        ],
        total: 2,
        done: 1,
        creditsTotal: 110,
        missing: ['canvas'],
        final: false
      }),
      unsettledProofs: [],
      fatalError: new DomReadTimeoutError('canvas-area:mouse-move')
    });
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const result = await engine.runAccount(runInput());
    expect(result.authenticated).toBe(true);
    expect(result.fatalCode).toBe('DOM_READ_TIMEOUT');
  });

  it('discovery and trial-skip UI returns are explicitly unverified', async () => {
    vi.stubEnv('CAPCUT_HTTP_DISCOVERY_ONLY', '1');
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const discoveryResult = await engine.runAccount(runInput());
    expect(discoveryResult.authenticated).toBe(true);
    expect(discoveryResult.verification).toBeNull();

    vi.unstubAllEnvs();
    isEligible.mockReturnValue(false);
    const skipResult = await engine.runAccount(runInput({ skipWithoutTrial: true }));
    expect(skipResult.authenticated).toBe(true);
    expect(skipResult.skipped).toBe(true);
    expect(skipResult.verification).toBeNull();
  });

  it('forwards unsettledProofs to runAllTasks', async () => {
    const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });
    const unsettledProofs = [{ key: 'task_1', proof: { actionKey: 'task_1', opId: 'op_1', errNo: 0, errTips: '', at: 100 } }];
    await engine.runAccount(runInput({ unsettledProofs }));
    expect(runAllTasks).toHaveBeenCalledWith(expect.objectContaining({
      unsettledProofs
    }));
  });

  it('delivers omitted-key proof beside exact checkpoint rows without inventing a receipt row', async () => {
    const proof = { actionKey: 'old-task', opId: 'op-old', errNo: 0 as const, errTips: '', at: 150 };
    const checkpointSnapshot = exactSnapshot({
      tasks: [{ key: 'server-task', title: 'Server task', reward: 20, status: 1 }],
      total: 1,
      done: 0,
      credits: 0,
      creditsTotal: 20,
      missing: ['server-task'],
      final: false
    });
    runAllTasks.mockImplementationOnce(async (input: {
      onCheckpoint(checkpoint: unknown): Promise<void>;
    }) => {
      await input.onCheckpoint({
        outcomes: [],
        unsettledProofs: [{ key: 'old-task', proof }],
        snapshot: checkpointSnapshot
      });
      return { outcomes: [], snapshot: checkpointSnapshot, unsettledProofs: [{ key: 'old-task', proof }] };
    });
    const onTaskCheckpoint = vi.fn(async () => {});

    await new CapcutEngineService({ userDataDir: 'C:/tmp/userData' }).runAccount(runInput({ onTaskCheckpoint }));

    expect(onTaskCheckpoint).toHaveBeenCalledWith({
      rows: [{ key: 'server-task', title: 'Server task', reward: 20, status: 1 }],
      receipt: expect.objectContaining({ final: false, complete: false }),
      unsettledProofs: [{ key: 'old-task', proof }]
    });
  });

  it.each([
    ['fresh', { fresh: false, final: true }],
    ['final', { fresh: true, final: false }]
  ])('copies a false %s receipt flag without inferring completion', async (_field, flags) => {
    runAllTasks.mockResolvedValueOnce({
      outcomes: [],
      snapshot: {
        observedAt: 201,
        requiredAfter: 200,
        tasks: [{ key: 'pwa', title: 'Install', reward: 70, status: 4 }],
        total: 1,
        done: 1,
        credits: 70,
        creditsTotal: 70,
        missing: [],
        ...flags
      },
      unsettledProofs: []
    });

    const result = await new CapcutEngineService({ userDataDir: 'C:/tmp/userData' }).runAccount(runInput());

    expect(result.verification).toMatchObject({ ...flags, complete: false });
  });

  it('does not manufacture receipt metadata for a legacy-shaped UI snapshot', async () => {
    runAllTasks.mockResolvedValueOnce({
      outcomes: [],
      snapshot: {
        tasks: [],
        total: 0,
        done: 0,
        credits: 0,
        creditsTotal: 0,
        missing: []
      },
      unsettledProofs: []
    });

    await expect(new CapcutEngineService({ userDataDir: 'C:/tmp/userData' }).runAccount(runInput()))
      .rejects.toThrow('UI_VERIFICATION_METADATA_REQUIRED');
  });

  it.each([
    ['non-done row', { tasks: [{ key: 'pwa', title: 'Install', reward: 70, status: 1 }] }],
    ['duplicate rows', { total: 2, done: 2, tasks: [
      { key: 'pwa', title: 'Install', reward: 70, status: 4 },
      { key: 'pwa', title: 'Install', reward: 70, status: 4 }
    ] }],
    ['equal timestamps', { observedAt: 200, requiredAfter: 200 }],
    ['older timestamp', { observedAt: 199, requiredAfter: 200 }]
  ])('does not certify contradictory %s as complete', async (_name, patch) => {
    runAllTasks.mockResolvedValueOnce({ outcomes: [], unsettledProofs: [], snapshot: exactSnapshot(patch) });
    const result = await new CapcutEngineService({ userDataDir: 'C:/tmp/userData' }).runAccount(runInput());
    expect(result.verification?.complete).toBe(false);
  });
});
