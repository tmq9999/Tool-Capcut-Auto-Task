import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { logsColumns } from '../columns';
import type { RuntimeLog } from '../../../../shared/types/log';

describe('logsColumns rendering', () => {
  const statusColumn = logsColumns.find(
    (col) => 'accessorKey' in col && col.accessorKey === 'status'
  )!;

  function renderStatusCell(status: RuntimeLog['status']) {
    const logItem: RuntimeLog = {
      id: 'log-1',
      time: '12:00:00',
      email: 'user@test.com',
      step: 'Step',
      status,
      message: 'test message'
    };
    const info = {
      getValue: () => status,
      row: { original: logItem },
      column: statusColumn,
      table: {}
    };

    const cellFn = statusColumn.cell as (info: unknown) => React.ReactElement;
    return renderToStaticMarkup(cellFn(info));
  }

  it('renders WARNING with warning styling (text-warning) and label WARNING', () => {
    const html = renderStatusCell('WARNING');
    expect(html).toContain('WARNING');
    expect(html).toContain('text-warning');
  });

  it('renders SUCCESS with done styling (text-success) and label SUCCESS', () => {
    const html = renderStatusCell('SUCCESS');
    expect(html).toContain('SUCCESS');
    expect(html).toContain('text-success');
  });

  it('renders ERROR with error styling (text-error) and label ERROR', () => {
    const html = renderStatusCell('ERROR');
    expect(html).toContain('ERROR');
    expect(html).toContain('text-error');
  });

  it('renders INFO with info styling (text-primary) and label INFO', () => {
    const html = renderStatusCell('INFO');
    expect(html).toContain('INFO');
    expect(html).toContain('text-primary');
  });

  it('renders DEBUG with debug styling and label DEBUG', () => {
    const html = renderStatusCell('DEBUG');
    expect(html).toContain('DEBUG');
    expect(html).toContain('text-on-secondary-container');
  });

  it('renders WAITING with waiting styling (text-warning) and label WAITING', () => {
    const html = renderStatusCell('WAITING');
    expect(html).toContain('WAITING');
    expect(html).toContain('text-warning');
  });
});
