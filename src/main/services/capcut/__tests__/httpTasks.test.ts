import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Page } from 'playwright-core';
import type { AccountUiInteraction } from '../types';
import { executeHttpTasks, resolveNumericUserId, LEAF_TASKS, validateTaskRowsDetailed } from '../httpTasks';
import { TaskEvidenceError } from '../TaskEvidenceError';
import { AutomationTerminalError } from '../../AutomationTerminalError';

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

  function callbackPage(
    actionBody: unknown,
    listBody: unknown,
    listStatusOrSecondBody: number | unknown = 200,
    onList = () => {}
  ) {
    let clock = 2000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock++);
    let listCallCount = 0;
    const isSecondBody = typeof listStatusOrSecondBody === 'object' && listStatusOrSecondBody !== null;
    const listBodies = isSecondBody
      ? [listBody, listStatusOrSecondBody]
      : Array.isArray(listBody) && listBody.length > 0 && typeof listBody[0] === 'object' && listBody[0] !== null && ('err_no' in listBody[0] || 'data' in listBody[0])
        ? (listBody as unknown[])
        : null;
    const actualStatus = typeof listStatusOrSecondBody === 'number' ? listStatusOrSecondBody : 200;

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/account/info/')) {
        return new Response(JSON.stringify({ data: { user_id_str: '123456789' } }), { status: 200 });
      }
      if (url.includes('/do_action')) {
        return new Response(JSON.stringify(actionBody), { status: 200 });
      }
      if (url.includes('/task_list')) {
        onList();
        const callIdx = listCallCount++;
        const body = listBodies ? listBodies[Math.min(callIdx, listBodies.length - 1)] : listBody;
        return new Response(JSON.stringify(body), { status: actualStatus });
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

  it.each([
    ['missing array', { err_no: 0, data: {} }, 'TASK_LIST_MISSING', 200],
    ['invalid id', {
      err_no: 0, data: { task_list: [
        { task_key: LEAF_TASKS[0], task_id: '1', task_status: 4 }
      ] }
    }, 'TASK_ROW_INVALID', 200],
    ['HTTP 503', { err_no: 0, data: { task_list: taskRows() } }, 'HTTP_STATUS', 503],
    ['nonzero err_no', { err_no: 1001, message: 'fail', data: {} }, 'ERR_NO_NONZERO', 200],
    ['string err_no', { err_no: '0', data: { task_list: taskRows() } }, 'ERR_NO_INVALID', 200],
    ['duplicate keys', { err_no: 0, data: { task_list: [taskRows()[0], taskRows()[0]] } }, 'TASK_DUPLICATE_KEY', 200],
    ['duplicate ids', {
      err_no: 0, data: { task_list: [
        { ...taskRows()[0], task_key: 'key-1' },
        { ...taskRows()[0], task_key: 'key-2' }
      ] }
    }, 'TASK_DUPLICATE_ID', 200]
  ])('preserves the concrete rejection reason: %s', async (_name, body, reason, status = 200) => {
    const { page, fetchMock } = callbackPage({ err_no: 0 }, body, status);
    const logs: string[] = [];
    const result = await executeHttpTasks({
      page, log: message => logs.push(message),
      signal: new AbortController().signal, actionDelayMs: 0
    });
    expect(result.fatalError).toMatchObject({ diagnostic: { phase: 'initial', reason } });
    expect(result.unsettledProofs).toHaveLength(9);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/do_action'))).toHaveLength(9);
    expect(logs.some(line => line.includes(String(reason)))).toBe(true);
  });

  it('records after-hydration phase when retry also fails', async () => {
    let listCount = 0;
    const { page } = callbackPage({ err_no: 0 }, null, 200, () => {});
    // Override fetchMock for task_list to return empty on first call, invalid on second
    const origFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/task_list')) {
        listCount++;
        if (listCount === 1) {
          return new Response(JSON.stringify({ err_no: 0, data: { task_list: [] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ err_no: 0, data: { task_list: [{ task_key: LEAF_TASKS[0], task_id: 'bad', task_status: 4 }] } }), { status: 200 });
      }
      return origFetch(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Provide goto on page so it triggers hydration
    (page as { goto?: unknown }).goto = vi.fn().mockResolvedValue(null);

    const logs: string[] = [];
    const result = await executeHttpTasks({
      page,
      log: message => logs.push(message),
      signal: new AbortController().signal,
      actionDelayMs: 0
    });

    expect(result.fatalError).toMatchObject({
      diagnostic: { phase: 'after-hydration', reason: 'TASK_ROW_INVALID' }
    });
    expect(result.unsettledProofs).toHaveLength(9);
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

  it.each(['list', 'claim-count'] as const)('R05 carries accepted proof on %s timeout', async failure => {
    vi.useFakeTimers();
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const { page, fetchMock } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows(2) } });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/account/info/')) return new Response(JSON.stringify({ data: { user_id_str: '123456789' } }));
      if (url.includes('/do_action') || url.includes('/grant_reward')) return new Response('{"err_no":0}');
      if (url.includes('/task_list')) {
        if (failure === 'list') {
          entered();
          return new Promise<Response>(resolve => {
            release = () => resolve(new Response(JSON.stringify({ err_no: 0, data: { task_list: taskRows() } })));
          });
        }
        return new Response(JSON.stringify({ err_no: 0, data: { task_list: taskRows(2) } }));
      }
      throw new Error('Unexpected fixture URL');
    });
    if (failure === 'claim-count') Object.assign(page, { locator: () => ({
      first: () => ({ isVisible: async () => false }),
      filter: () => ({ count: () => { entered(); return new Promise<number>(resolve => { release = () => resolve(0); }); } })
    }) });
    const checkpoint = vi.fn(async () => {});
    const run = executeHttpTasks({
      page,
      signal: new AbortController().signal,
      log: () => {},
      actionDelayMs: 0,
      onCheckpoint: checkpoint
    });
    const settled = run.then(() => null, error => error);
    try {
      await reached;
      await vi.advanceTimersByTimeAsync(failure === 'list' ? 30001 : 1001);
      const error = await settled;
      expect(error).toBeInstanceOf(TaskEvidenceError);
      expect(error.unsettledProofs.map((x: { key: string }) => x.key)).toEqual([...LEAF_TASKS]);
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('/do_action'))).toHaveLength(9);
      expect(checkpoint).not.toHaveBeenCalled();
    } finally {
      release?.();
      await settled;
      vi.useRealTimers();
    }
  });

  describe('N05: downstream fields validation and outer failure diagnostics', () => {
    it('rejects non-string task title before checkpoint', async () => {
      const rows = taskRows();
      const malformed = {
        ...rows[0],
        task_view: { title: { unexpected: 'object' } }
      };
      expect(validateTaskRowsDetailed([malformed])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'title' }
      });
      const { page } = callbackPage(
        { err_no: 0 },
        { err_no: 0, data: { task_list: [malformed] } }
      );
      const checkpoint = vi.fn(async () => {});
      const result = await executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        log: () => {},
        onCheckpoint: checkpoint
      });
      expect(result.snapshot).toBeNull();
      expect(result.unsettledProofs).toHaveLength(9);
      expect(checkpoint).not.toHaveBeenCalled();
    });

    it('validates task view object, button_text string, array task_view, and array task_reward_view', () => {
      const rows = taskRows();
      expect(validateTaskRowsDetailed([{ ...rows[0], task_view: ['not', 'object'] }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'task_view' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_view: { button_text: 123 } }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'button_text' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_reward_view: [100] }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'task_reward_view' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_id: Number.MAX_SAFE_INTEGER + 10 }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'task_id' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_reward_view: { reward_amount: Infinity } }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_ROW_INVALID', rowIndex: 0, field: 'reward_amount' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_reward_view: { reward_amount: Number.MAX_VALUE } }, { ...rows[1], task_reward_view: { reward_amount: Number.MAX_VALUE } }])).toMatchObject({
        valid: false,
        detail: { reason: 'TASK_TOTAL_INVALID' }
      });
      expect(validateTaskRowsDetailed([{ ...rows[0], task_view: { title: 'Valid Title', button_text: 'Claim' } }])).toMatchObject({
        valid: true
      });
    });

    it('attaches diagnostic and preserves cause and proofs on outer evaluate rejection', async () => {
      const cause = new Error('CONTEXT_DESTROYED_FIXTURE');
      const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } });
      let calls = 0;
      const evaluate = async (fn: (arg: unknown) => unknown, arg?: unknown): Promise<unknown> => {
        if (++calls === 11) throw cause;
        return fn(arg);
      };
      Object.assign(page, { evaluate });
      const operation = executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        log: () => {}
      });
      await expect(operation).rejects.toMatchObject({
        name: 'TaskEvidenceError',
        cause,
        diagnostic: { phase: 'initial', reason: 'EVALUATION_FAILED', httpStatus: null }
      });
    });

    it('does not leak raw errMsg or error in hydration logs', async () => {
      const sentinel = 'SECRET_SENTINEL_LEAK_TOKEN';
      const logs: string[] = [];
      const { page } = callbackPage(
        { err_no: 0 },
        { err_no: 10001, message: sentinel, data: {} }
      );
      Object.assign(page, { goto: async () => {} });
      await executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        log: (msg) => logs.push(msg)
      });
      expect(logs.some((l) => l.includes(sentinel))).toBe(false);
    });

    it('P02.1: streams valid proof through onAcceptedProof before logging success', async () => {
      const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } });
      const order: string[] = [];
      const proofs: string[] = [];

      await executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        onAcceptedProof: async (p) => {
          proofs.push(p.key);
          order.push(`proof:${p.key}`);
        },
        log: (msg) => {
          if (msg.includes('hoàn thành (err_no=0)')) {
            order.push('log:success');
          }
        }
      });

      expect(proofs).toHaveLength(9);
      expect(order[0]).toBe('proof:capcut_web_pwa_install');
      expect(order[1]).toBe('log:success');
    });

    it('P02.8: does not wrap AutomationTerminalError from persistence sink in TaskEvidenceError', async () => {
      const { page } = callbackPage({ err_no: 0 }, { err_no: 0, data: { task_list: taskRows() } });
      const sinkError = new AutomationTerminalError(
        'failed',
        { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED', details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' } },
        'SQLite disk I/O error'
      );

      const op = executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        onAcceptedProof: async () => {
          throw sinkError;
        },
        log: () => {}
      });

      await expect(op).rejects.toThrow(sinkError);
      await expect(op).rejects.not.toBeInstanceOf(TaskEvidenceError);
    });

    it('P05.1: keeps nine proofs and initial failure when hydration popup read times out', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let releaseRead!: (value: boolean) => void;
      let handled: Promise<unknown> | undefined;
      try {
        const { page, fetchMock } = callbackPage({ err_no: 0 }, { err_no: 0, data: {} });
        let hydrated = false;
        const goto = vi.fn(async () => {
          hydrated = true;
          return null;
        });
        const click = vi.fn(async () => {});
        const isVisible = vi.fn(() =>
          !hydrated
            ? Promise.resolve(false)
            : new Promise<boolean>((resolve) => {
                releaseRead = resolve;
              })
        );
        Object.assign(page, {
          goto,
          locator: () => ({
            first() {
              return this;
            },
            isVisible,
            click
          })
        });
        handled = executeHttpTasks({
          page,
          signal: controller.signal,
          log: () => {},
          actionDelayMs: 0
        }).then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        await vi.advanceTimersByTimeAsync(2000);
        expect(goto).toHaveBeenCalledOnce();
        expect(releaseRead).toBeTypeOf('function');
        await vi.advanceTimersByTimeAsync(1001);
        const { error } = (await handled) as { error: TaskEvidenceError };
        expect(error.unsettledProofs).toHaveLength(9);
        expect(error.diagnostic).toMatchObject({
          phase: 'initial',
          reason: 'TASK_LIST_MISSING',
          httpStatus: 200,
          errNo: 0
        });
        expect(error.message).toContain('http-task-popup:visible');
        expect(fetchMock.mock.calls.filter(([url]) => url.includes('/do_action'))).toHaveLength(9);
        expect(fetchMock.mock.calls.filter(([url]) => url.includes('/task_list'))).toHaveLength(1);
        expect(click).not.toHaveBeenCalled();
      } finally {
        controller.abort(new Error('TEST_CLEANUP'));
        releaseRead?.(false);
        await handled;
        vi.useRealTimers();
      }
    });

    it('P05.4: recovers when initial missing list hydrates successfully and settles valid list on second read', async () => {
      const { page, fetchMock } = callbackPage(
        { err_no: 0 },
        { err_no: 0, data: {} },
        { err_no: 0, data: { task_list: taskRows() } }
      );
      const goto = vi.fn(async () => null);
      Object.assign(page, { goto });

      const result = await executeHttpTasks({
        page,
        signal: new AbortController().signal,
        actionDelayMs: 0,
        log: () => {}
      });

      expect(goto).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('/do_action'))).toHaveLength(9);
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('/task_list'))).toHaveLength(2);
      expect(result.snapshot?.total).toBe(9);
      expect(result.snapshot?.done).toBe(9);
      expect(result.snapshot?.final).toBe(true);
    });
  });
});


