import { describe, expect, it, vi } from 'vitest';
import { CapcutHttpTaskApi } from '../taskApi';
import initialFixture from '../../../../../../tools/fixtures/task-list-initial.json';
import { parseHttpTaskList } from '../taskClient';

describe('CapcutHttpTaskApi', () => {
  it('parses the existing captured regional task fixture without UI monitoring', () => {
    const snap = parseHttpTaskList(initialFixture, 10);
    expect(snap.byKey.size).toBe(12);
    expect(snap.totalReward).toBe(2060);
    expect(snap.doneKeys).toEqual(['capcut_web_newbie_register']);
    expect(snap.byKey.get('capcut_web_design_studio_picture_creation')?.childIds).toEqual([100009, 100010, 100011]);
  });

  it('rejects nonzero err_no even if a plausible task list is present', async () => {
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { ...initialFixture, err_no: 1 } }) });
    await expect(api.getTaskList()).rejects.toThrow('CAPCUT_HTTP_TASK_LIST_REJECTED');
  });
  it('uses the observed capcut_web_task scene and parses regional rewards', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      data: { err_no: 0, data: { task_list: [{ task_key: 'capcut_web_pwa_install', task_id: 7, task_status: 1, task_reward_view: { reward_amount: 70 }, task_view: { title: 'Install', button_text: 'Go' }, task_relation: {} }] } }
    });
    const snapshot = await new CapcutHttpTaskApi({ requestJson }).getTaskList();
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
      path: '/luckycat/i18n/capcut/task/v1/task_list',
      method: 'POST',
      body: { scene: 'capcut_web_task' },
      effect: 'read',
    }));
    expect(snapshot.byKey.get('capcut_web_pwa_install')?.reward).toBe(70);
  });

  it('rejects a non-success response without treating it as an empty task list', async () => {
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 403, ok: false, data: {} }) });
    await expect(api.getTaskList()).rejects.toThrow('CAPCUT_HTTP_TASK_LIST_403');
  });

  it('accepts a successful empty task list without inventing tasks', async () => {
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: 0, data: { task_list: [] } } }) }, 'direct-http');
    const snap = await api.getTaskList();
    expect(snap.byKey.size).toBe(0);
    expect(snap.totalReward).toBe(0);
    expect(snap.doneKeys).toEqual([]);
  });

  it.each([
    { err_no: 1, data: { task_list: [] } },
    { data: { task_list: [] } },
    { err_no: 0, data: {} },
    { err_no: 0, data: { task_list: {} } },
    { err_no: 0, data: { task_list: [null] } }
  ])('rejects API errors and malformed lists: %j', async body => {
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: body }) });
    await expect(api.getTaskList()).rejects.toThrow(/CAPCUT_HTTP_TASK_LIST_/);
  });

  it('preserves claimable status, server parent relations and varying reward values', async () => {
    const task = (key: string, id: number, status: number, reward: number, children: number[] = []) => ({
      task_key: key, task_id: id, task_status: status,
      task_reward_view: { reward_amount: reward }, task_view: { title: 'Same title', button_text: '' },
      task_relation: { child_task_ids: children }
    });
    const rows = [task('parent', 1, 1, 40, [2, 3]), task('chat', 2, 2, 17), task('upload', 3, 4, 83)];
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: 0, data: { task_list: rows } } }) });
    const snap = await api.getTaskList();
    expect(snap.byKey.get('chat')?.status).toBe(2);
    expect(snap.byKey.get('parent')?.childIds).toEqual([2, 3]);
    expect(snap.totalReward).toBe(140);
    expect(snap.earnedReward).toBe(83);
  });

  it.each([
    { task_key: 'task', task_id: 1, task_status: 4, task_reward_view: { reward_amount: '83' } },
    { task_key: 'task', task_id: 1, task_status: 4, task_reward_view: { reward_amount: -5 } },
    { task_key: '', task_id: 1, task_status: 4, task_reward_view: { reward_amount: 83 } },
    { task_key: 'task', task_id: 1, task_status: 9, task_reward_view: { reward_amount: 83 } }
  ])('rejects a malformed task row rather than reducing incorrect totals: %j', async row => {
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: 0, data: { task_list: [row] } } }) });
    await expect(api.getTaskList()).rejects.toThrow('CAPCUT_HTTP_TASK_LIST_INVALID');
  });

  it('does not silently overwrite duplicate task keys', async () => {
    const row = { task_key: 'task', task_id: 1, task_status: 4, task_reward_view: { reward_amount: 83 }, task_view: {}, task_relation: {} };
    const api = new CapcutHttpTaskApi({ requestJson: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: 0, data: { task_list: [row, row] } } }) });
    await expect(api.getTaskList()).rejects.toThrow('CAPCUT_HTTP_TASK_LIST_INVALID');
  });
});
