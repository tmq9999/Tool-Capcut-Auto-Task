import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { selectGroups } from '../missionRunner';
import { parseTaskList } from '../taskApi';
import type { MissionGroup } from '../types';

// Snapshot DAU luot: chi capcut_web_newbie_register da xong.
const SNAP = parseTaskList(fs.readFileSync('tools/fixtures/task-list-initial.json', 'utf8'))!;
const SNAP_DONE = parseTaskList(fs.readFileSync('tools/fixtures/task-list-done.json', 'utf8'))!;
const noop = async (): Promise<void> => {};

const design: MissionGroup = {
  name: 'Design Studio',
  keys: [
    'capcut_web_design_studio_ai_chat',
    'capcut_web_design_studio_upload_img',
    'capcut_web_design_studio_canvas_edit',
  ],
  proofTimeoutMs: 60000,
  act: noop,
};

const install: MissionGroup = {
  name: 'PWA',
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
      name: 'ghost',
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
