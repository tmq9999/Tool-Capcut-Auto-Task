import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { EMAIL_SOURCE_OPTIONS, getEmailSourceOptions } from '../emailSourceOptions';
import { AddAccountDrawer } from '../AddAccountDrawer';
import { EditAccountDrawer } from '../EditAccountDrawer';
import { AccountsToolbar } from '../AccountsToolbar';
import type { Account } from '@shared/types/account';

describe('emailSourceOptions', () => {
  it('defines the canonical 4 email sources with correct labels', () => {
    expect(EMAIL_SOURCE_OPTIONS).toEqual([
      { value: 'manual', label: 'Nhập tay' },
      { value: 'gmail94', label: 'Gmail94' },
      { value: 'dongvanfb', label: 'DongVanFB' },
      { value: 'customdomain', label: 'Domain riêng' }
    ]);
  });

  it('injects legacy value when existing account has non-canonical provider', () => {
    const options = getEmailSourceOptions('Outlook');
    expect(options.some((o) => o.value === 'Outlook')).toBe(true);
    expect(options).toHaveLength(5);
  });

  it('does not duplicate canonical values in options', () => {
    const options = getEmailSourceOptions('gmail94');
    expect(options).toHaveLength(4);
  });

  it('AddAccountDrawer renders with Nguồn email label and default manual option', () => {
    const html = renderToStaticMarkup(
      <AddAccountDrawer
        isOpen={true}
        onClose={() => {}}
        onAddAccount={() => {}}
      />
    );

    expect(html).toContain('Nguồn email');
    expect(html).toContain('Nhập tay');
    expect(html).toContain('Gmail94');
    expect(html).toContain('DongVanFB');
    expect(html).toContain('Domain riêng');
    expect(html).not.toContain('Email Provider');
  });

  it('EditAccountDrawer preserves legacy email source without mapping to manual or gmail94', () => {
    const legacyAccount: Account = {
      id: 'acc-leg',
      stt: 1,
      email: 'legacy@example.com',
      provider: 'Outlook',
      password: '',
      emailPassword: '',
      proxy: '',
      browserProfile: '',
      status: 'active',
      fullData: '',
      notes: 'test legacy',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    };

    const html = renderToStaticMarkup(
      <EditAccountDrawer
        isOpen={true}
        onClose={() => {}}
        account={legacyAccount}
        onSaveAccount={() => {}}
      />
    );

    expect(html).toContain('Nguồn email');
    expect(html).toContain('Outlook (legacy)');
  });

  it('AccountsToolbar renders canonical email source options', () => {
    const html = renderToStaticMarkup(
      <AccountsToolbar
        filters={{
          searchQuery: '',
          statusFilter: 'all',
          dateFilter: 'all',
          providerFilter: 'all',
          browserFilter: 'all'
        }}
        onFilterChange={() => {}}
        onClearFilters={() => {}}
      />
    );

    expect(html).toContain('Nguồn email: Tất cả');
    expect(html).toContain('Nhập tay');
    expect(html).toContain('Gmail94');
    expect(html).toContain('DongVanFB');
    expect(html).toContain('Domain riêng');
  });
});
