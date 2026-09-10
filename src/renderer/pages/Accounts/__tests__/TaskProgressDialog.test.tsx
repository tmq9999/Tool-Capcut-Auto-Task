import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TaskProgressDialog } from '../TaskProgressDialog';
import type { AccountTasksResponseDTO } from '../../../../shared/schemas/account-task.schema';

describe('TaskProgressDialog', () => {
  it('shows the server total instead of a hard-coded twelve', () => {
    const partialData: AccountTasksResponseDTO = {
      doneCount: 6,
      creditsEarned: 180,
      verification: {
        state: 'partial',
        runId: 'run-1',
        observedAt: '2026-09-08T01:00:00.000Z',
        serverTotal: 10,
        serverDone: 6
      },
      items: Array.from({ length: 10 }, (_, i) => ({
        taskKey: `task_${i}`,
        title: `Task ${i}`,
        reward: 30,
        status: i < 6 ? 4 : 1,
        opId: null,
        provedAt: null,
        updatedAt: '2026-09-08T01:00:00.000Z'
      }))
    };

    const html = renderToStaticMarkup(
      <TaskProgressDialog
        isOpen={true}
        onClose={() => {}}
        accountId="acc-1"
        email="test@example.com"
        initialData={partialData}
      />
    );

    expect(html).toContain('6/10');
    expect(html).not.toContain('/12');
    expect(html).toContain('Chưa hoàn tất');
  });

  it('never labels a stale complete receipt as verified', () => {
    const staleData: AccountTasksResponseDTO = {
      doneCount: 12,
      creditsEarned: 360,
      verification: {
        state: 'stale',
        runId: 'run-old',
        observedAt: '2026-09-01T00:00:00.000Z',
        serverTotal: 12,
        serverDone: 12
      },
      items: Array.from({ length: 12 }, (_, i) => ({
        taskKey: `task_${i}`,
        title: `Task ${i}`,
        reward: 30,
        status: 4,
        opId: null,
        provedAt: null,
        updatedAt: '2026-09-01T00:00:00.000Z'
      }))
    };

    const html = renderToStaticMarkup(
      <TaskProgressDialog
        isOpen={true}
        onClose={() => {}}
        accountId="acc-1"
        email="test@example.com"
        initialData={staleData}
      />
    );

    expect(html).toContain('Chưa xác minh (cũ)');
    expect(html).not.toContain('Đã xác minh');
  });

  it('không hiển thị receipt cũ khi accountId không khớp ngay cả khi render SSR trước useEffect', () => {
    const dataForAcc1: AccountTasksResponseDTO = {
      doneCount: 10,
      creditsEarned: 300,
      verification: {
        state: 'verified',
        runId: 'run-1',
        observedAt: '2026-09-08T01:00:00.000Z',
        serverTotal: 10,
        serverDone: 10
      },
      items: [
        {
          taskKey: 'task_0',
          title: 'Special Acc1 Task',
          reward: 30,
          status: 4,
          opId: 'op-1',
          provedAt: '2026-09-08T01:00:00.000Z',
          updatedAt: '2026-09-08T01:00:00.000Z'
        }
      ]
    };

    // Rendering with acc-2 while initialData belonged to acc-1:
    // When initialData is provided, TaskProgressDialog must only bind it if accountId is identical,
    // or if initialData is for a different account, it must not render acc-1's receipt under acc-2.
    // Specifically: if component binds initialData to initial accountId props,
    // then when rendered with accountId="acc-2" but data was from acc-1, it shouldn't show acc-1 data.
    const html = renderToStaticMarkup(
      <TaskProgressDialog
        isOpen={true}
        onClose={() => {}}
        accountId={null}
        email="acc2@example.com"
        initialData={dataForAcc1}
      />
    );

    expect(html).not.toContain('Special Acc1 Task');
    expect(html).not.toContain('Đã xác minh');
  });
});
