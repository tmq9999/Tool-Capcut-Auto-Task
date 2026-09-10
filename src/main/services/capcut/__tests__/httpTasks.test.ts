import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Page } from 'playwright-core';
import type { AccountUiInteraction } from '../types';
import { executeHttpTasks, resolveNumericUserId, LEAF_TASKS } from '../httpTasks';

describe('executeHttpTasks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const taskRows = (status = 4) =>
    LEAF_TASKS.map((key, i) => ({
      task_key: key,
      task_id: i + 1,
      task_status: status,
      task_reward_view: { reward_amount: 50 },
      task_view: { title: key }
    }));

  function callbackPage(actionBody: unknown, listBody: unknown, listStatus = 200, onList = () => {}) {
    let clock = 2000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock++);
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/account/info/')) {
        return new Response(JSON.stringify({ data: { user_id_str: '123456789' } }), { status: 200 });
      }
      if (url.includes('/do_action')) {
        return new Response(JSON.stringify(actionBody), { status: 200 });
      }
      if (url.includes('/task_list')) {
        onList();
        return new Response(JSON.stringify(listBody), { status: listStatus });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const page = { evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg) } as unknown as Page;
    return { page, fetchMock };
  }

  it('resolves numeric user ID correctly', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/account/info/')) {
        return new Response(JSON.stringify({ data: { user_id_str: '7683467167371510805' } }), { status: 200 });
      }
      throw new Error(`Unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const page = { evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg) } as unknown as Page;

    const userId = await resolveNumericUserId(page);
    expect(userId).toBe('7683467167371510805');
  });

  it('CT-01 preserves the nine-action happy path', async () => {
    const { page, fetchMock } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } });
    const result = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(result.snapshot).toMatchObject({ done: 9, total: 9, final: true });
    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(11);
    expect(calls[0][0]).toContain('/account/info/');
    expect(calls.at(-1)![0]).toContain('/task_list');
    expect(calls.slice(1, 10).map(([, init]) => JSON.parse(String(init!.body)).action_key)).toEqual([...LEAF_TASKS]);
    expect(calls.slice(1, 10).every(([, init]) => init!.credentials === 'include')).toBe(true);
  });

  it('CT-01 missing err_no never creates accepted action proof', async () => {
    const { page } = callbackPage({}, { err_no: 0, data: { task_list: taskRows() } });
    const result = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(result.outcomes.every((x) => !x.proof)).toBe(true);
  });

  it('CT-01 rejects plausible rows from an HTTP error', async () => {
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } }, 503);
    const result = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(result.snapshot).toBeNull();
    expect(result.fatalError?.message).toBe('TASK_LIST_RESPONSE_INVALID');
  });

  it.each([
    ['HTTP 400', 400, { err_no: 0, data: { task_list: taskRows() } }],
    ['HTTP 500', 500, { err_no: 0, data: { task_list: taskRows() } }],
    ['missing err_no in task_list', 200, { data: { task_list: taskRows() } }],
    ['null err_no in task_list', 200, { err_no: null, data: { task_list: taskRows() } }],
    ['string err_no in task_list', 200, { err_no: '0', data: { task_list: taskRows() } }],
    ['duplicate task keys in task_list', 200, { err_no: 0, data: { task_list: [taskRows()[0], taskRows()[0]] } }]
  ])('CT-01 rejects invalid task_list: %s', async (_name, status, body) => {
    const { page } = callbackPage({ err_no: 0 }, body, status);
    const result = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(result.snapshot).toBeNull();
    expect(result.fatalError?.message).toBe('TASK_LIST_RESPONSE_INVALID');
  });

  it('CT-02 empty list is not final', async () => {
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: [] } });
    const r = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(r.snapshot).toMatchObject({ total: 0, final: false });
  });

  it('CT-02 retains accepted but unsettled actions', async () => {
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows(1) } });
    const r = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(r.unsettledProofs?.map((x) => x.key).sort()).toEqual([...LEAF_TASKS].sort());
  });

  it('CT-02 parent rows do not invent mutation attempts', async () => {
    const parent = { task_key: 'parent-fixture', task_id: 100, task_status: 4 };
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: [...taskRows(), parent] } });
    const r = await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(r.outcomes.find((x) => x.key === 'parent-fixture')).toMatchObject({ attempts: 0 });
    expect(r.outcomes.find((x) => x.key === 'parent-fixture')?.proof).toBeUndefined();
  });

  it('CT-03 never starts final checkpoint after Stop', async () => {
    const controller = new AbortController();
    const stop = new Error('STOP');
    const onCheckpoint = vi.fn(async () => {});
    const { page } = callbackPage(
      { err_no: 0 },
      { err_no: 0, data: { task_list: taskRows() } },
      200,
      () => controller.abort(stop)
    );
    await expect(
      executeHttpTasks({
        page,
        log: () => {},
        signal: controller.signal,
        actionDelayMs: 0,
        onCheckpoint
      })
    ).rejects.toBe(stop);
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it('claims pending status 2 tasks automatically using callbackPage', async () => {
    let listCount = 0;
    const claimedKeys: string[] = [];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/account/info/')) {
        return new Response(JSON.stringify({ data: { user_id_str: '123456789' } }), { status: 200 });
      }
      if (url.includes('/do_action')) {
        return new Response(JSON.stringify({ err_no: 0 }), { status: 200 });
      }
      if (url.includes('/task_list')) {
        listCount++;
        const status = listCount === 1 ? 2 : 4;
        return new Response(
          JSON.stringify({
            err_no: 0,
            data: {
              task_list: [
                {
                  task_key: 'capcut_web_pwa_install',
                  task_id: 1,
                  task_status: status,
                  task_reward_view: { reward_amount: 70 },
                  task_view: { title: 'Install PWA' }
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes('/grant_reward')) {
        const body = JSON.parse(String(init?.body || '{}'));
        claimedKeys.push(body.task_key);
        return new Response(JSON.stringify({ err_no: 0 }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const page = { evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg) } as unknown as Page;

    const result = await executeHttpTasks({
      page,
      log: () => {},
      actionDelayMs: 0,
      signal: new AbortController().signal
    });

    expect(claimedKeys).toContain('capcut_web_pwa_install');
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.done).toBe(1);
    expect(result.snapshot!.credits).toBe(70);
  });

  it('CT-04 routes auxiliary UI popup clicks through foregroundPage', async () => {
    const ui = {
      foreground: vi.fn(async (_stage: string, op: () => Promise<unknown>) => op()),
      focusMode: 'target'
    } as unknown as AccountUiInteraction;

    let clicked = false;
    const page = {
      evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => {
        const fetchMock = async (url: string) => {
          if (url.includes('/account/info/')) return new Response(JSON.stringify({ data: { user_id_str: '123' } }));
          if (url.includes('/do_action')) return new Response(JSON.stringify({ err_no: 0 }));
          if (url.includes('/task_list')) return new Response(JSON.stringify({ err_no: 0, data: { task_list: taskRows() } }));
          throw new Error('Unexpected');
        };
        vi.stubGlobal('fetch', fetchMock);
        return fn(arg);
      },
      locator: vi.fn(() => ({
        first: () => ({
          isVisible: async () => true,
          click: async () => { clicked = true; }
        })
      }))
    } as unknown as Page;

    await executeHttpTasks({
      page,
      log: () => {},
      signal: new AbortController().signal,
      actionDelayMs: 0,
      ui
    });

    expect(ui.foreground).toHaveBeenCalledWith('http-task-popup', expect.any(Function));
    expect(clicked).toBe(true);
  });

  it('B08 equal timestamp is not fresh and does not clear pending proof', async () => {
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } });
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    const result = await executeHttpTasks({
      page,
      signal: new AbortController().signal,
      log: () => {},
      actionDelayMs: 0,
      sessionStartedAt: 1000
    });
    expect(result.snapshot).toMatchObject({ fresh: false, final: false });
    expect(result.unsettledProofs).toHaveLength(9);
  });

  it.each([undefined, null, 'bad', {}])('B10 malformed list container is invalid: %j', async (list) => {
    const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: list } });
    const r = await executeHttpTasks({
      page,
      signal: new AbortController().signal,
      log: () => {},
      actionDelayMs: 0
    });
    expect(r.snapshot).toBeNull();
    expect(r.fatalError?.message).toBe('TASK_LIST_RESPONSE_INVALID');
  });

  it('B11 failed current mutation does not claim old proof as new', async () => {
    const key = LEAF_TASKS[0];
    const proof = { actionKey: key, opId: 'old-op', at: 1000, errNo: 0 as const, errTips: '' };
    const { page } = callbackPage({ err_no: 1 }, { err_no: 0, data: { task_list: taskRows(1) } });
    const r = await executeHttpTasks({
      page,
      signal: new AbortController().signal,
      log: () => {},
      actionDelayMs: 0,
      unsettledProofs: [{ key, proof }]
    });
    expect(r.outcomes.find((x) => x.key === key)?.proof).toBeUndefined();
    expect(r.unsettledProofs).toContainEqual({ key, proof });
  });

  it('B09 Stop interrupts an auxiliary visibility read', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => { enter = r; });
    const pending = new Promise<boolean>((r) => { release = () => r(false); });
    const controller = new AbortController(), stop = new Error('STOP');
    const evaluate = vi.fn();
    const locator = { first() { return this; }, isVisible: () => { enter(); return pending; } };
    const run = executeHttpTasks({
      page: { locator: () => locator, evaluate } as unknown as Page,
      signal: controller.signal,
      log: () => {},
      actionDelayMs: 0
    });
    await entered;
    controller.abort(stop);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        run.then(() => 'resolved', (error) => error),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve('still-pending'), 100); })
      ]);
      expect(outcome).toBe(stop);
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      release();
      await run.catch(() => {});
    }
  });
});
