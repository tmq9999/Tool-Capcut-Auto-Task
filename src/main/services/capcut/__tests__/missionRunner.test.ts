import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileMissionEvidence,
  selectGroups,
} from '../missionRunner';
import { parseTaskList, TaskStore } from '../taskApi';
import { DomReadTimeoutError } from '../cancellation';
import type {
  CapcutMissionEnv,
  MissionGroup,
} from '../types';

import { createDirectUiInteraction } from '../uiInteractionScheduler';

// Snapshot DAU luot: chi capcut_web_newbie_register da xong.
const SNAP = parseTaskList(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'))!;
const SNAP_DONE = parseTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'))!;
const noop = async (): Promise<void> => {};

const PWA_DONE_JSON = fs.readFileSync(
  'tools/fixtures/task-list-done.json',
  'utf8'
);
const ENV = {
  page: {} as CapcutMissionEnv['page'],
  context: {} as CapcutMissionEnv['context'],
  sampleImage: 'C:/tmp/sample.png',
  log: () => {},
  signal: new AbortController().signal,
  ui: createDirectUiInteraction(new AbortController().signal),
} satisfies CapcutMissionEnv;

afterEach(() => {
  vi.useRealTimers();
});

const design: MissionGroup = {
  id: 'design-studio',
  name: 'Design Studio',
  workspace: 'editor',
  keys: [
    'capcut_web_design_studio_ai_chat',
    'capcut_web_design_studio_upload_img',
    'capcut_web_design_studio_canvas_edit',
  ],
  proofTimeoutMs: 60000,
  act: noop,
};

const install: MissionGroup = {
  id: 'pwa-install',
  name: 'PWA',
  workspace: 'none',
  keys: ['capcut_web_pwa_install'],
  proofTimeoutMs: 30000,
  act: noop,
};

describe('selectGroups', () => {
  it('selectGroups bỏ nhóm đã xong hết', () => {
    // SNAP_DONE: ca 12 nhiem vu status=4 -> khong con nhom nao can chay
    expect(selectGroups(SNAP_DONE, [install, design])).toEqual([]);
  });

  it('selectGroups lay ca hai nhom khi con viec', () => {
    const picked = selectGroups(SNAP, [install, design]);
    expect(picked.map((p) => p.group.name)).toEqual(['PWA', 'Design Studio']);
  });

  it('selectGroups chỉ đưa vào need những key chưa xong', () => {
    const picked = selectGroups(SNAP, [design]);
    expect([...picked[0].need].sort()).toEqual([
      'capcut_web_design_studio_ai_chat',
      'capcut_web_design_studio_canvas_edit',
      'capcut_web_design_studio_upload_img',
    ]);
  });

  it('selectGroups BỎ QUA key lạ không có trong snapshot', () => {
    // Trước đây bản cũ coi key lạ là "chưa xong" rồi đứng chờ do_action 45 giây
    // cho một nhiệm vụ mà account không hề có.
    const ghost: MissionGroup = {
      id: 'pwa-install',
      name: 'ghost',
      workspace: 'none',
      keys: ['khong_ton_tai'],
      proofTimeoutMs: 1,
      act: noop,
    };
    expect(selectGroups(SNAP, [ghost])).toEqual([]);
  });

  it('selectGroups giữ đúng thứ tự nhóm được truyền vào', () => {
    const picked = selectGroups(SNAP, [design, install, design]);
    expect(picked.map((p) => p.group.name)).toEqual(['Design Studio', 'PWA', 'Design Studio']);
  });
});

// ---------------------------------------------------------------------------
// Biến thể account: có account chỉ có 10 nhiệm vụ / 1380 credits, KHÔNG có
// capcut_web_pwa_install và capcut_web_push_authorize (thay bằng Daily sign-in).
// Đo được trên arcgxxod38164@oldevlk.com, 2026-09-02 05:2x.
// ---------------------------------------------------------------------------

/** Bỏ vài task khỏi snapshot để mô phỏng biến thể account. */
function withoutKeys(snap: typeof SNAP, keys: string[]): typeof SNAP {
  const byKey = new Map(snap.byKey);
  for (const k of keys) byKey.delete(k);
  return { ...snap, byKey };
}

describe('selectGroups — biến thể account', () => {
  it('selectGroups BỎ QUA key mà account không có', () => {
    const variant = withoutKeys(SNAP, ['capcut_web_pwa_install']);
    // Nhóm PWA không còn key nào áp dụng được -> không được chọn.
    expect(selectGroups(variant, [install])).toEqual([]);
  });

  it('selectGroups vẫn chạy các key còn lại của nhóm bị khuyết một phần', () => {
    const variant = withoutKeys(SNAP, ['capcut_web_design_studio_upload_img']);
    const picked = selectGroups(variant, [design]);
    expect(picked.length).toBe(1);
    expect([...picked[0].need].sort()).toEqual([
      'capcut_web_design_studio_ai_chat',
      'capcut_web_design_studio_canvas_edit',
    ]);
  });
});

describe('reconcileMissionEvidence', () => {
  it('does not dispatch a grouped mission under strict verification without explicit leaf boundaries', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const verifyRewardStep = vi.fn();
    const act = vi.fn(async () => {});
    const group: MissionGroup = {
      id: 'design-studio',
      name: 'Design Studio',
      workspace: 'editor',
      keys: [...design.keys],
      proofTimeoutMs: 90_000,
      act,
    };

    const result = await reconcileMissionEvidence(
      group,
      {
        ...ENV,
        rewardSessionAlias: 'worker-1-session-1',
        verifyRewardStep,
      },
      store,
      new Set(group.keys)
    );

    expect(act).not.toHaveBeenCalled();
    expect(verifyRewardStep).not.toHaveBeenCalled();
    expect([...result.evidence.values()]).toHaveLength(3);
    expect([...result.evidence.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: 'failed',
        error: expect.objectContaining({ message: 'REWARD_LEAF_BOUNDARY_REQUIRED' }),
      }),
    ]));
  });

  it('propagates an unresponsive renderer so the owner can tear down instead of retrying UI', async () => {
    const group: MissionGroup = {
      id: 'design-studio',
      name: 'Design Studio',
      workspace: 'editor',
      keys: ['capcut_web_design_studio_canvas_edit'],
      proofTimeoutMs: 90000,
      act: async () => { throw new DomReadTimeoutError('canvas-ready'); }
    };
    const result = await reconcileMissionEvidence(group, ENV, new TaskStore(), new Set(group.keys));
    expect(result.evidence.get('capcut_web_design_studio_canvas_edit')?.error).toBeInstanceOf(DomReadTimeoutError);
    expect(result.fatalError).toBeInstanceOf(DomReadTimeoutError);
  });
  it('uses a confirming snapshot received after proof but before the action settled', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const group: MissionGroup = {
      id: 'pwa-install',
      name: 'PWA',
      workspace: 'none',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: async () => {
        store.pushAction({ actionKey: 'capcut_web_pwa_install', opId: 'proof-during-act', errNo: 0, errTips: '', at: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 1));
        store.pushTaskList(PWA_DONE_JSON);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    const start = Date.now();
    const result = reconcileMissionEvidence(group, ENV, store, new Set(group.keys));
    await vi.runAllTimersAsync();
    expect((await result).evidence.get('capcut_web_pwa_install')?.state).toBe('verified');
    expect(Date.now() - start).toBe(1001);
  });
  it('consumes a PWA proof captured during act without a second 45 second wait', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const group: MissionGroup = {
      id: 'pwa-install',
      name: 'PWA',
      workspace: 'none',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: async () => {
        store.pushAction({
          actionKey: 'capcut_web_pwa_install',
          opId: 'op-1',
          errNo: 0,
          errTips: '',
          at: Date.now(),
        });
      },
    };

    const resultPromise = reconcileMissionEvidence(
      group,
      ENV,
      store,
      new Set(group.keys)
    );
    store.pushTaskList(PWA_DONE_JSON, Date.now() + 1);
    const result = await resultPromise;

    expect(result.evidence.get('capcut_web_pwa_install')).toMatchObject({
      state: 'verified',
      snapshotStatus: 4,
      proof: { opId: 'op-1', errNo: 0 },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one 12 second budget when the confirming snapshot never arrives', async () => {
    vi.useFakeTimers();
    const store = new TaskStore();
    const group: MissionGroup = {
      id: 'pwa-install',
      name: 'PWA',
      workspace: 'none',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: async () => {},
    };
    const startedAt = Date.now();
    const resultPromise = reconcileMissionEvidence(
      group,
      ENV,
      store,
      new Set(group.keys)
    );
    store.pushAction({
      actionKey: 'capcut_web_pwa_install',
      opId: 'op-2',
      errNo: 0,
      errTips: '',
      at: Date.now(),
    });

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await resultPromise;

    expect(result.evidence.get('capcut_web_pwa_install')).toMatchObject({
      state: 'proved-awaiting-snapshot',
      proof: { opId: 'op-2', errNo: 0 },
    });
    expect(Date.now() - startedAt).toBe(12_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('excludes a proof-backed task from later group selection despite a stale snapshot', () => {
    const proofBacked = new Set(['capcut_web_pwa_install']);
    expect(selectGroups(SNAP, [install], proofBacked)).toEqual([]);
  });

  it('logs mission action and reconciliation as separate stages', async () => {
    const messages: string[] = [];
    const store = new TaskStore();
    const group: MissionGroup = {
      id: 'pwa-install',
      name: 'PWA',
      workspace: 'none',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: async () => {
        store.pushAction({
          actionKey: 'capcut_web_pwa_install',
          opId: 'op-timing',
          errNo: 0,
          errTips: '',
          at: Date.now()
        });
        store.pushTaskList(PWA_DONE_JSON, Date.now() + 50_000);
      }
    };

    await reconcileMissionEvidence(
      group,
      { ...ENV, log: (message) => messages.push(message) },
      store,
      new Set(group.keys)
    );

    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /^stage=mission-action:pwa elapsedMs=\d+ outcome=success$/
      ),
      expect.stringMatching(
        /^stage=mission-reconciliation:pwa elapsedMs=\d+ outcome=success$/
      )
    ]));
  });
});
