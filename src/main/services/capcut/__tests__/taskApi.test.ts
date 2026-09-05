import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { parseDoAction, parseTaskList, TaskStore } from '../taskApi';

// Fixture đọc theo đường dẫn tương đối từ gốc repo, giống engine CLI: đây là
// bản ghi THẬT của một lượt làm tay 12/12 nhiệm vụ, không phải dữ liệu bịa.
const RAW = fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8');
const RAW_INITIAL = fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8');

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
});

// ---------------------------------------------------------------------------
// TaskStore — cổng chứng minh
// ---------------------------------------------------------------------------

describe('TaskStore', () => {
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
});
