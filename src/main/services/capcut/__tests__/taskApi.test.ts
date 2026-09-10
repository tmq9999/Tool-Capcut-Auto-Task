import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Request, Response } from 'playwright-core';
import fs from 'node:fs';

import { attachTaskMonitor, parseDoAction, parseTaskList, TaskStore } from '../taskApi';
import type { RewardAttempt } from '../types';

// Fixture đọc theo đường dẫn tương đối từ gốc repo, giống engine CLI: đây là
// bản ghi THẬT của một lượt làm tay 12/12 nhiệm vụ, không phải dữ liệu bịa.
const RAW = fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8');
const RAW_INITIAL = fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8');

class FakeContext extends EventEmitter {
  pages(): never[] { return []; }
}

function request(url: string, body: string | null = null): Request {
  return { url: () => url, method: () => 'POST', postData: () => body } as unknown as Request;
}

function response(req: Request, body: string, status = 200): Response {
  return {
    url: () => req.url(),
    request: () => req,
    status: () => status,
    text: async () => body,
  } as unknown as Response;
}

function unreadableResponse(req: Request): Response {
  return {
    url: () => req.url(),
    request: () => req,
    status: () => 200,
    text: async () => { throw new Error('body unavailable'); },
  } as unknown as Response;
}

const MONITOR_IDENTITY = {
  runId: 'run-task-api-test',
  sessionAlias: 'worker-1-session-1',
};

function attempt(stepAttemptId: string, taskKey = 'capcut_web_pwa_install'): RewardAttempt {
  return {
    sessionAlias: MONITOR_IDENTITY.sessionAlias,
    stepAttemptId,
    taskKey,
    actionDispatchedAt: Date.now(),
  };
}

async function settleMonitor(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseTaskList', () => {
  it('parseTaskList đọc đủ 12 nhiệm vụ, tổng 2060 credits', () => {
    const snap = parseTaskList(RAW, 1000);
    expect(snap).not.toBeNull();
    expect(snap!.byKey.size).toBe(12);
    expect(snap!.totalReward).toBe(2060);
    expect(snap!.at).toBe(1000);
  });

  it('hai nhiệm vụ trùng tên vẫn phân biệt được bằng task_key', () => {
    const snap = parseTaskList(RAW)!;
    const design = snap.byKey.get('capcut_web_design_studio_ai_chat')!;
    const video = snap.byKey.get('capcut_web_video_studio_send_msg')!;
    expect(design.title).toBe('Chat with AI agent');
    expect(video.title).toBe('Chat with AI agent');
    expect(design.reward).toBe(110);
    expect(video.reward).toBe(130);
  });

  it('snapshot cuoi luot: ca 12 nhiem vu da status=4', () => {
    const snap = parseTaskList(RAW)!;
    expect(snap.doneKeys.length).toBe(12);
    expect(snap.earnedReward).toBe(2060);
  });

  it('snapshot dau luot: chi signup xong, 11 nhiem vu con mo', () => {
    const snap = parseTaskList(RAW_INITIAL)!;
    expect(snap.byKey.size).toBe(12);
    expect(snap.doneKeys).toEqual(['capcut_web_newbie_register']);
    expect(snap.earnedReward).toBe(520);
    expect(snap.byKey.get('capcut_web_video_studio_export')!.status).toBe(1);
  });

  it('parseTaskList trả null với JSON không phải task_list', () => {
    expect(parseTaskList('{"data":{}}')).toBe(null);
    expect(parseTaskList('khong phai json')).toBe(null);
  });
});

describe('parseDoAction', () => {
  it('parseDoAction đọc được cả 9 bản ghi thật, tất cả err_no=0', () => {
    const lines = fs
      .readFileSync('tools/fixtures/do-actions.ndjson', 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { reqBody: string; resBody: string });

    expect(lines.length).toBe(9);
    const proofs = lines.map((l) => parseDoAction(l.reqBody, l.resBody, 5));
    expect(proofs.every((p) => p !== null)).toBe(true);
    expect(proofs.every((p) => p!.errNo === 0)).toBe(true);

    const keys = proofs.map((p) => p!.actionKey);
    for (const k of [
      'capcut_web_design_studio_canvas_edit',
      'capcut_web_video_studio_generate_done',
      'capcut_web_video_studio_export',
    ]) {
      expect(keys, `thiếu ${k}`).toContain(k);
    }
    expect(proofs[0]!.opId).toMatch(/^capcut_web_pwa_install_\d+_\d{4}-\d{2}-\d{2}$/);
  });

  it('parseDoAction coi err_no khác 0 là bằng chứng THẤT BẠI, không phải null', () => {
    const p = parseDoAction(
      '{"action_key":"x","op_id":"x_1_2026-09-01"}',
      '{"err_no":8001003,"err_tips":"blocked"}'
    );
    expect(p).not.toBeNull();
    expect(p!.errNo).toBe(8001003);
    expect(p!.errTips).toBe('blocked');
  });

  it('parseDoAction rejects string "0", boolean false, and null as numeric 0', () => {
    const invalidValues = ['"0"', 'false', 'null', '""'];
    for (const val of invalidValues) {
      const p = parseDoAction(
        '{"action_key":"x","op_id":"x_1_2026-09-01"}',
        `{"err_no":${val},"err_tips":"test"}`
      );
      expect(p).not.toBeNull();
      expect(p!.errNo).toBe(-1);
    }
  });
});

// ---------------------------------------------------------------------------
// TaskStore — cổng chứng minh
// ---------------------------------------------------------------------------

describe('TaskStore', () => {
  it('does not assign a late response from attempt A to attempt B with the same task key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const attemptA = attempt('attempt-a');
    store.beginAttempt(attemptA);
    store.registerActionContract({
      taskKey: attemptA.taskKey,
      requestActionKey: attemptA.taskKey,
    });
    const actionA = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"old-job"}'
    );
    context.emit('request', actionA);
    store.endAttempt(attemptA.stepAttemptId);

    vi.setSystemTime(200);
    const attemptB = attempt('attempt-b');
    expect(() => store.beginAttempt(attemptB)).toThrow('REWARD_ATTEMPT_OVERLAP');
    context.emit('response', response(actionA, '{"err_no":0,"err_tips":""}'));
    await settleMonitor();

    await expect(store.verifyRewardStep(attemptB, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      reasonCode: 'REWARD_PROOF_MISSING',
    });
    vi.setSystemTime(201);
    const snapshotRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list'
    );
    context.emit('request', snapshotRequest);
    context.emit('response', response(snapshotRequest, RAW));
    await settleMonitor();
    await expect(store.verifyRewardStep(attemptA, Date.now())).resolves.toMatchObject({
      verdict: 'pass',
      status: 4,
    });
  });

  it('does not treat a task_list body received after mutation as fresh when its request started before proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-old-snapshot');
    store.beginAttempt(rewardAttempt);
    store.registerActionContract({
      taskKey: rewardAttempt.taskKey,
      requestActionKey: rewardAttempt.taskKey,
    });
    const oldSnapshotRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list'
    );
    context.emit('request', oldSnapshotRequest);

    vi.setSystemTime(110);
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"current-job"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(120);
    context.emit('response', response(actionRequest, '{"err_no":0,"err_tips":""}'));
    await settleMonitor();
    vi.setSystemTime(130);
    context.emit('response', response(oldSnapshotRequest, RAW));
    await settleMonitor();

    await expect(store.verifyRewardStep(rewardAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      reasonCode: 'REWARD_SNAPSHOT_MISSING',
    });
  });

  it('accepts exact action-key proof followed by a newly started task_list request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-current');
    store.beginAttempt(rewardAttempt);
    store.registerActionContract({
      taskKey: rewardAttempt.taskKey,
      requestActionKey: rewardAttempt.taskKey,
    });
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"current-job"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(110);
    context.emit('response', response(actionRequest, '{"err_no":0,"err_tips":""}'));
    await settleMonitor();
    vi.setSystemTime(120);
    const freshSnapshotRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list'
    );
    context.emit('request', freshSnapshotRequest);
    vi.setSystemTime(130);
    context.emit('response', response(freshSnapshotRequest, RAW));
    await settleMonitor();

    const verified = await store.verifyRewardStep(rewardAttempt, Date.now());
    expect(verified).toMatchObject({
      verdict: 'pass',
      proofAt: 110,
      snapshotAt: 130,
      status: 4,
      reasonCode: 'REWARD_VERIFIED',
    });
    expect(verified.evidenceRefs.join(' ')).not.toContain('current-job');
  });

  it('keeps temporal-only same-key request origin unknown without a confirmed causal contract', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-temporal-only');
    store.beginAttempt(rewardAttempt);
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"possibly-old-job"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(110);
    context.emit('response', response(actionRequest, '{"err_no":0,"err_tips":""}'));
    await settleMonitor();

    await expect(store.verifyRewardStep(rewardAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      proofAt: 110,
      reasonCode: 'REWARD_CAUSAL_RELATION_UNKNOWN',
    });
  });

  it('chooses the latest post-proof snapshot request when response bodies finish out of order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-out-of-order');
    store.registerActionContract({ taskKey: rewardAttempt.taskKey, requestActionKey: rewardAttempt.taskKey });
    store.beginAttempt(rewardAttempt);
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"action"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(110);
    context.emit('response', response(actionRequest, '{"err_no":0}'));
    await settleMonitor();

    vi.setSystemTime(120);
    const older = request('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list');
    context.emit('request', older);
    vi.setSystemTime(130);
    const newer = request('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list');
    context.emit('request', newer);
    vi.setSystemTime(140);
    context.emit('response', response(newer, RAW));
    await settleMonitor();
    vi.setSystemTime(150);
    context.emit('response', response(older, RAW_INITIAL));
    await settleMonitor();

    await expect(store.verifyRewardStep(rewardAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'pass',
      snapshotAt: 140,
      status: 4,
    });
  });

  it('does not turn malformed or unreadable response bodies into strict proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const malformedAttempt = attempt('attempt-malformed');
    store.registerActionContract({ taskKey: malformedAttempt.taskKey, requestActionKey: malformedAttempt.taskKey });
    store.beginAttempt(malformedAttempt);
    const malformedRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"malformed"}'
    );
    context.emit('request', malformedRequest);
    context.emit('response', response(malformedRequest, 'not-json'));
    await settleMonitor();
    await expect(store.verifyRewardStep(malformedAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      reasonCode: 'REWARD_ACTION_BODY_INVALID',
    });

    const otherStore = new TaskStore();
    const otherContext = new FakeContext();
    attachTaskMonitor(otherContext as unknown as BrowserContext, otherStore, MONITOR_IDENTITY);
    const unreadableAttempt = attempt('attempt-unreadable', 'capcut_web_push_authorize');
    otherStore.registerActionContract({ taskKey: unreadableAttempt.taskKey, requestActionKey: unreadableAttempt.taskKey });
    otherStore.beginAttempt(unreadableAttempt);
    const unreadableRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_push_authorize","op_id":"unreadable"}'
    );
    otherContext.emit('request', unreadableRequest);
    otherContext.emit('response', unreadableResponse(unreadableRequest));
    await settleMonitor();
    await expect(otherStore.verifyRewardStep(unreadableAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      reasonCode: 'REWARD_PROOF_MISSING',
    });
  });

  it('keeps opaque request IDs unique when a store monitor moves between contexts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = new TaskStore();
    const contextA = new FakeContext();
    const disposeA = attachTaskMonitor(contextA as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const attemptA = attempt('attempt-context-a');
    store.beginAttempt(attemptA);
    const requestA = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"a"}'
    );
    contextA.emit('request', requestA);
    contextA.emit('response', response(requestA, '{"err_no":0}'));
    await settleMonitor();
    const resultA = await store.verifyRewardStep(attemptA, Date.now());
    disposeA();

    const contextB = new FakeContext();
    attachTaskMonitor(contextB as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const attemptB = attempt('attempt-context-b', 'capcut_web_push_authorize');
    store.beginAttempt(attemptB);
    const requestB = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_push_authorize","op_id":"b"}'
    );
    contextB.emit('request', requestB);
    contextB.emit('response', response(requestB, '{"err_no":0}'));
    await settleMonitor();
    const resultB = await store.verifyRewardStep(attemptB, Date.now());

    expect(resultA.evidenceRefs).toContain('task-action:attempt-context-a:request-1');
    expect(resultB.evidenceRefs).toContain('task-action:attempt-context-b:request-2');
  });

  it('keeps legacy push APIs parseable but origin-unknown to strict verification', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = new TaskStore();
    const rewardAttempt = attempt('attempt-legacy');
    store.beginAttempt(rewardAttempt);
    store.pushAction({
      actionKey: rewardAttempt.taskKey,
      opId: 'legacy',
      errNo: 0,
      errTips: '',
      at: 110,
    });
    store.pushTaskList(RAW, 120);

    expect((await store.waitForAction(rewardAttempt.taskKey, 1, 0)).opId).toBe('legacy');
    await expect(store.verifyRewardStep(rewardAttempt, Date.now())).resolves.toMatchObject({
      verdict: 'unknown',
      reasonCode: 'REWARD_PROOF_MISSING',
    });
  });

  it('keeps a same-key attempt unresolved after a rejected or unreadable result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const first = attempt('attempt-rejected');
    store.beginAttempt(first);
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"rejected-job"}'
    );
    context.emit('request', actionRequest);
    context.emit('response', response(actionRequest, '{"err_no":8001003,"err_tips":"blocked"}'));
    await settleMonitor();
    store.endAttempt(first.stepAttemptId);

    expect(() => store.beginAttempt(attempt('attempt-after-rejection')))
      .toThrow('REWARD_ATTEMPT_OVERLAP');
  });

  it('rejects a second monitor owner on the same authoritative store', () => {
    const firstContext = new FakeContext();
    const secondContext = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(firstContext as unknown as BrowserContext, store, MONITOR_IDENTITY);

    expect(() => attachTaskMonitor(secondContext as unknown as BrowserContext, store, {
      runId: 'peer-run',
      sessionAlias: MONITOR_IDENTITY.sessionAlias,
    })).toThrow('TASK_MONITOR_OWNER_MISMATCH');
  });

  it('ignores lookalike hosts and detaches all context listeners through its disposer', async () => {
    const context = new FakeContext();
    const store = new TaskStore();
    const dispose = attachTaskMonitor(
      context as unknown as BrowserContext,
      store,
      MONITOR_IDENTITY
    );
    const rewardAttempt = attempt('attempt-host');
    store.beginAttempt(rewardAttempt);
    const malicious = request(
      'https://capcut.com.attacker.invalid/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"malicious"}'
    );
    context.emit('request', malicious);
    context.emit('response', response(malicious, '{"err_no":0}'));
    await settleMonitor();
    dispose();

    expect(context.listenerCount('request')).toBe(0);
    expect(context.listenerCount('response')).toBe(0);
    expect(store.seenActions()).toEqual([]);
  });

  it('waitForAction thấy được action đã bắn TRƯỚC khi bắt đầu chờ', async () => {
    const store = new TaskStore();
    store.pushAction({ actionKey: 'k1', opId: 'o', errNo: 0, errTips: '', at: 100 });
    const proof = await store.waitForAction('k1', 50, 50);
    expect(proof.actionKey).toBe('k1');
  });

  it('waitForAction bỏ qua action cũ hơn sinceMs', async () => {
    const store = new TaskStore();
    store.pushAction({ actionKey: 'k1', opId: 'o', errNo: 0, errTips: '', at: 10 });
    await expect(store.waitForAction('k1', 60, 500)).rejects.toThrow(/không thấy do_action/);
  });

  it('waitForAction giải quyết khi action tới muộn', async () => {
    const store = new TaskStore();
    const p = store.waitForAction('k2', 2000, 0);
    setTimeout(
      () => store.pushAction({ actionKey: 'k2', opId: 'o', errNo: 0, errTips: '', at: Date.now() }),
      30
    );
    expect((await p).actionKey).toBe('k2');
  });

  it('pushTaskList cập nhật snapshot và waitForSnapshot chỉ nhận bản mới', async () => {
    const store = new TaskStore();
    store.pushTaskList(RAW, 100);
    expect(store.snapshot()!.at).toBe(100);
    const p = store.waitForSnapshot(200, 2000);
    setTimeout(() => store.pushTaskList(RAW, 300), 30);
    expect((await p).at).toBe(300);
  });

  it('pushTaskList bỏ qua payload rác, snapshot cũ vẫn còn', () => {
    const store = new TaskStore();
    store.pushTaskList(RAW, 100);
    store.pushTaskList('{"data":{}}', 200);
    expect(store.snapshot()!.at).toBe(100);
  });

  it('cancels an action wait without spending its timeout', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const controller = new AbortController();
    let rejection = '';
    void store.waitForAction('k-stop', 60_000, 0, controller.signal)
      .catch((error: unknown) => { rejection = (error as Error).message; });

    controller.abort(new Error('stop requested'));
    await Promise.resolve();

    expect(rejection).toBe('stop requested');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('cancels a snapshot wait without spending its timeout', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const controller = new AbortController();
    let rejection = '';
    void store.waitForSnapshot(0, 60_000, controller.signal)
      .catch((error: unknown) => { rejection = (error as Error).message; });

    controller.abort(new Error('stop requested'));
    await Promise.resolve();

    expect(rejection).toBe('stop requested');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('D01: rejects do_action response with HTTP 503 even if body contains err_no: 0', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-503-action');
    store.beginAttempt(rewardAttempt);
    store.registerActionContract({
      taskKey: rewardAttempt.taskKey,
      requestActionKey: rewardAttempt.taskKey,
    });
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"current-job"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(110);
    context.emit('response', response(actionRequest, '{"err_no":0,"err_tips":""}', 503));
    await settleMonitor();
    vi.setSystemTime(120);
    const freshSnapshotRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list'
    );
    context.emit('request', freshSnapshotRequest);
    vi.setSystemTime(130);
    context.emit('response', response(freshSnapshotRequest, RAW, 200));
    await settleMonitor();

    const verified = await store.verifyRewardStep(rewardAttempt, Date.now());
    expect(verified.verdict).toBe('unknown');
    expect(verified.reasonCode).toBe('REWARD_PROOF_MISSING');
  });

  it('D01: rejects task_list response with HTTP 503 even if action was 200', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const context = new FakeContext();
    const store = new TaskStore();
    attachTaskMonitor(context as unknown as BrowserContext, store, MONITOR_IDENTITY);
    const rewardAttempt = attempt('attempt-503-snapshot');
    store.beginAttempt(rewardAttempt);
    store.registerActionContract({
      taskKey: rewardAttempt.taskKey,
      requestActionKey: rewardAttempt.taskKey,
    });
    const actionRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      '{"action_key":"capcut_web_pwa_install","op_id":"current-job"}'
    );
    context.emit('request', actionRequest);
    vi.setSystemTime(110);
    context.emit('response', response(actionRequest, '{"err_no":0,"err_tips":""}', 200));
    await settleMonitor();
    vi.setSystemTime(120);
    const freshSnapshotRequest = request(
      'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list'
    );
    context.emit('request', freshSnapshotRequest);
    vi.setSystemTime(130);
    context.emit('response', response(freshSnapshotRequest, RAW, 503));
    await settleMonitor();

    const verified = await store.verifyRewardStep(rewardAttempt, Date.now());
    expect(verified.verdict).toBe('unknown');
    expect(verified.reasonCode).toBe('REWARD_SNAPSHOT_MISSING');
  });
});
