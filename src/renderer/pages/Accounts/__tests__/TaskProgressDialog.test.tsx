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
});
