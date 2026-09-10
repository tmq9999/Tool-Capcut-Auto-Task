import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Badge } from '../../../components/ui/Badge';
import { DashboardActionBar } from '../DashboardActionBar';
import { accountStatusBadgeVariant, createDashboardColumns } from '../columns';
import { AutomationConfigGrid } from '../AutomationConfigGrid';
import { DEFAULT_AUTOMATION_CONFIG } from '../automationConfig';

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

  it('R08 renders plaintext password for Dashboard table column', () => {
    const columns = createDashboardColumns({
      isThreadRunning: () => false,
      onStopThread: () => {}
    });
    const passwordCol = columns.find(
      (c) => 'accessorKey' in c && c.accessorKey === 'passwordCapcut'
    );
    expect(passwordCol).toBeDefined();
    if (!passwordCol || typeof passwordCol.cell !== 'function') {
      throw new Error('password column cell function expected');
    }
    const cellFn = passwordCol.cell as (props: {
      row: { original: { passwordCapcut?: string | null } };
    }) => React.ReactElement;
    const html = renderToStaticMarkup(
      cellFn({ row: { original: { passwordCapcut: 'PASS-DEMO' } } })
    );
    expect(html).toContain('PASS-DEMO');
    expect(html).not.toContain('••••••••');
  });

  it('R08 renders plaintext API key in AutomationConfigGrid panel', () => {
    const html = renderToStaticMarkup(
      <AutomationConfigGrid
        config={{
          ...DEFAULT_AUTOMATION_CONFIG,
          emailSourceMode: 'api',
          emailApiProvider: 'gmail94'
        }}
        onChange={() => {}}
        emailProviders={[
          { provider: 'gmail94', isConfigured: true, maskedHint: '••••••••', apiKey: 'KEY-DEMO' }
        ]}
        customEmail={{
          domain: 'custom.test',
          apiBaseUrl: 'http://custom.test',
          senderFilter: ''
        }}
      />
    );

    expect(html).toContain('KEY-DEMO');
    expect(html).not.toContain('••••••••');
  });

  it.each([
    ['PASS-DEMO', true, 'PASS-DEMO'],
    [null, true, 'Không đọc được mật khẩu'],
    [null, false, '-']
  ] as const)('F02 renders value %s with presence %s', (value, present, expected) => {
    const column = createDashboardColumns({
      isThreadRunning: () => false, onStopThread: () => {}
    }).find(c => 'accessorKey' in c && c.accessorKey === 'passwordCapcut');
    if (!column || typeof column.cell !== 'function') {
      throw new Error('Password cell expected');
    }
    const cell = column.cell as (props: {
      row: { original: {
        passwordCapcut: string | null; hasPasswordCapcut: boolean;
      } };
    }) => React.ReactElement;
    const html = renderToStaticMarkup(cell({
      row: { original: { passwordCapcut: value, hasPasswordCapcut: present } }
    }));
    expect(html).toContain('>' + expected + '</span>');
    expect(html).not.toContain('••••••••');
    if (value !== null) expect(html).toContain('select-all');
  });
});
