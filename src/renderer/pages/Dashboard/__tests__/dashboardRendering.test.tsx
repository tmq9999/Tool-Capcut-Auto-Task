import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Badge } from '../../../components/ui/Badge';
import { DashboardActionBar } from '../DashboardActionBar';
import { accountStatusBadgeVariant } from '../columns';

describe('Dashboard continuous-run rendering', () => {
  it('maps a stopped account to the neutral stopped badge', () => {
    expect(accountStatusBadgeVariant('stopped')).toBe('stopped');
    const html = renderToStaticMarkup(<Badge variant="stopped" />);
    expect(html).toContain('Đã dừng');
  });

  it('renders concurrency separately from every cumulative outcome counter', () => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        workerTarget={3}
        workersActive={2}
        accountsAccepted={7}
        accountsCompleted={4}
        accountsFailed={2}
        accountsStopped={1}
      />
    );

    expect(html).toContain('2/3 luồng đang hoạt động');
    expect(html).toContain('7 đã nhận');
    expect(html).toContain('4 xong');
    expect(html).toContain('2 lỗi');
    expect(html).toContain('1 dừng');
  });

  it.each([
    ['completed', 'Hoàn tất'],
    ['stopped', 'Đã dừng'],
    ['blocked', 'Bị chặn'],
    ['failed', 'Thất bại']
  ] as const)('renders terminal state %s distinctly', (runState, label) => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        runState={runState}
        runMessage={'message-' + runState}
      />
    );

    expect(html).toContain(label);
    expect(html).toContain('message-' + runState);
  });

  it('renders only approved safe Gmail94 capacity details', () => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        runState="blocked"
        runMessage="Số dư Gmail94 không đủ."
        terminalReason={{
          code: 'INSUFFICIENT_FUNDS',
          provider: 'gmail94',
          details: {
            requestedWorkers: 3,
            reusableCount: 1,
            balance: 1000,
            unitPrice: 1000,
            affordablePurchaseCount: 1,
            checkedAt: '2026-09-05T00:00:00.000Z'
          }
        }}
      />
    );

    expect(html).toContain('Yêu cầu 3 luồng');
    expect(html).toContain('tái sử dụng 1');
    expect(html).toContain('số dư 1000');
    expect(html).toContain('giá 1000');
    expect(html).toContain('mua được 1');
    expect(html).toContain('2026-09-05T00:00:00.000Z');
  });
});
