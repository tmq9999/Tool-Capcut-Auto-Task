import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { executeHttpTasks, resolveNumericUserId, LEAF_TASKS } from '../httpTasks';

describe('executeHttpTasks', () => {
  it('resolves numeric user ID correctly', async () => {
    const page = {
      evaluate: vi.fn(async () => {
        // simulate page context fetch
        return '7683467167371510805';
      })
    } as unknown as Page;

    const userId = await resolveNumericUserId(page);
    expect(userId).toBe('7683467167371510805');
  });

  it('completes all leaf tasks via HTTP and returns full credit snapshot', async () => {
    const doActionCalls: Array<{ actionKey: string; opId: string }> = [];
    const grantCalls: string[] = [];

    const mockTaskList = [
      ...LEAF_TASKS.map((key, idx) => ({
        task_key: key,
        task_id: 100 + idx,
        task_status: 4,
        task_reward_view: { reward_amount: 50 },
        task_view: { title: key, button_text: 'Done' }
      })),
      {
        task_key: 'capcut_web_inspiration_group',
        task_id: 201,
        task_status: 4,
        task_reward_view: { reward_amount: 70 },
        task_view: { title: 'Inspiration Group' }
      },
      {
        task_key: 'capcut_web_design_studio_group',
        task_id: 202,
        task_status: 4,
        task_reward_view: { reward_amount: 75 },
        task_view: { title: 'Design Studio Group' }
      },
      {
        task_key: 'capcut_web_video_studio_group',
        task_id: 203,
        task_status: 4,
        task_reward_view: { reward_amount: 75 },
        task_view: { title: 'Video Studio Group' }
      }
    ];

    const page = {
      evaluate: vi.fn(async (arg: unknown, data?: unknown) => {
        if (typeof arg === 'function') {
          const fnStr = arg.toString();
          if (fnStr.includes('account/info') || fnStr.includes('user_info')) {
            return '7683467167371510805';
          }
          if (fnStr.includes('task_list')) {
            return mockTaskList;
          }
          if (fnStr.includes('grant_reward')) {
            grantCalls.push(data as string);
            return { errNo: 0 };
          }
          if (fnStr.includes('do_action')) {
            const { actionKey, opId } = (data || {}) as { actionKey: string; opId: string };
            doActionCalls.push({ actionKey, opId });
            return { errNo: 0, errMsg: '' };
          }
        }
        return null;
      })
    } as unknown as Page;

    const log = vi.fn();
    const result = await executeHttpTasks({
      page,
      log,
      signal: new AbortController().signal,
      actionDelayMs: 0,
      sessionStartedAt: Date.now() - 5000
    });

    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.total).toBe(12);
    expect(result.snapshot!.done).toBe(12);
    expect(result.snapshot!.credits).toBe(670);
    expect(result.snapshot!.missing).toEqual([]);
    expect(result.snapshot!.final).toBe(true);
    expect(result.snapshot!.fresh).toBe(true);

    // Verify all 9 leaf tasks had do_action triggered with op_id containing userId
    expect(doActionCalls.length).toBe(9);
    for (const call of doActionCalls) {
      expect(call.opId).toContain('7683467167371510805');
    }

    // Verify outcomes
    expect(result.outcomes.length).toBe(12);
    const leafOutcomes = result.outcomes.filter((o) => LEAF_TASKS.includes(o.key as never));
    expect(leafOutcomes.length).toBe(9);
    for (const outcome of leafOutcomes) {
      expect(outcome.proof).toBeDefined();
      expect(outcome.proof?.errNo).toBe(0);
      expect(outcome.proof?.opId).toContain('7683467167371510805');
    }
  });

  it('claims pending status 2 tasks automatically', async () => {
    let taskListFetchCount = 0;
    const claimedKeys: string[] = [];

    const page = {
      evaluate: vi.fn(async (arg: unknown, data?: unknown) => {
        if (typeof arg === 'function') {
          const fnStr = arg.toString();
          if (fnStr.includes('account/info') || fnStr.includes('user_info')) {
            return '7683467167371510805';
          }
          if (fnStr.includes('task_list')) {
            taskListFetchCount++;
            const status = taskListFetchCount === 1 ? 2 : 4;
            return [
              {
                task_key: 'capcut_web_pwa_install',
                task_id: 1,
                task_status: status,
                task_reward_view: { reward_amount: 70 }
              }
            ];
          }
          if (fnStr.includes('grant_reward')) {
            claimedKeys.push(data as string);
            return { errNo: 0 };
          }
          if (fnStr.includes('do_action')) {
            return { errNo: 0, errMsg: '' };
          }
        }
        return null;
      })
    } as unknown as Page;

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
});
