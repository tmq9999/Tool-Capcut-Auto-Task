import React, { useState, useMemo, useEffect, useSyncExternalStore } from 'react';
import { Download, Trash2, Edit, Plus, AlertCircle } from 'lucide-react';
import { RowSelectionState } from '@tanstack/react-table';
import { AppHeader } from '@renderer/layouts/AppHeader';
import { Button } from '@renderer/components/ui/Button';
import { DataGrid } from '@renderer/components/ui/DataGrid';
import { Pagination } from '@renderer/components/ui/Pagination';
import { AccountsSummaryBar } from './AccountsSummaryBar';
import { AccountsToolbar } from './AccountsToolbar';
import { createAccountsColumns } from './columns';
import { AddAccountDrawer } from './AddAccountDrawer';
import { EditAccountDrawer } from './EditAccountDrawer';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { ExportDialog } from './ExportDialog';
import { AccountsController, type IAccountsBridge } from './accountsController';
import { Account, AccountFilterState, ExportFormat } from '@shared/types/account';
import { ExportFieldName } from '@shared/types/settings';
import type { ExportSettingsDTO, ExportField } from '@shared/schemas/settings.schema';
import { DEFAULT_APP_SETTINGS } from '@shared/settings/default-settings';

const CANONICAL_TO_DISPLAY_FIELD: Record<ExportField, ExportFieldName> = {
  email: 'Email',
  passwordCapcut: 'Password CapCut',
  emailData: 'Email Data',
  credit: 'Credit',
  subscription: 'Subscription',
  createdAt: 'Create At',
};

const CANONICAL_TO_DISPLAY_FORMAT: Record<'xlsx' | 'csv' | 'txt', ExportFormat> = {
  xlsx: 'XLSX',
  csv: 'CSV',
  txt: 'TXT',
};

/** Offline fallback so the page still renders outside Electron. */
const OFFLINE_BRIDGE: IAccountsBridge = {
  accounts: {
    list: async () => ({ success: true, data: { items: [], total: 0 } }),
    create: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
    update: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
    remove: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
  },
};

export const AccountsPage: React.FC = () => {
  const controller = useMemo(() => {
    const api = window.electronAPI;
    return new AccountsController(api ? { accounts: api.accounts } : OFFLINE_BRIDGE);
  }, []);

  const controllerState = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.getState()
  );
  const accounts = controllerState.accounts;

  useEffect(() => {
    void controller.load();
  }, [controller]);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const [exportConfig, setExportConfig] = useState<ExportSettingsDTO>(
    DEFAULT_APP_SETTINGS.exportConfig
  );

  useEffect(() => {
    if (window.electronAPI?.settings?.get) {
      window.electronAPI.settings
        .get()
        .then((res) => {
          if (res.success) {
            setExportConfig(res.data.settings.exportConfig);
          }
        })
        .catch(() => {
          // Keep DEFAULT_APP_SETTINGS.exportConfig
        });
    }
  }, []);

  // Filter State
  const [filters, setFilters] = useState<AccountFilterState>({
    searchQuery: '',
    statusFilter: 'all',
    dateFilter: 'all',
    providerFilter: 'all',
    browserFilter: 'all',
  });

  // Modal / Drawer States
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Filtered accounts calculation
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = filters.searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        acc.email.toLowerCase().includes(q) ||
        (acc.proxy && acc.proxy.toLowerCase().includes(q)) ||
        (acc.notes && acc.notes.toLowerCase().includes(q));

      const matchesStatus =
        filters.statusFilter === 'all' || acc.status === filters.statusFilter;

      const matchesProvider =
        filters.providerFilter === 'all' ||
        acc.provider.toLowerCase() === filters.providerFilter.toLowerCase();

      const matchesBrowser =
        filters.browserFilter === 'all' ||
        (acc.browserProfile &&
          acc.browserProfile.toLowerCase().includes(filters.browserFilter.toLowerCase()));

      return matchesSearch && matchesStatus && matchesProvider && matchesBrowser;
    });
  }, [accounts, filters]);

  // Checked count
  const checkedAccountIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const checkedCount = checkedAccountIds.length;

  const handleEditAccount = (acc: Account) => {
    setEditingAccount(acc);
    setIsEditDrawerOpen(true);
  };

  const handleEditSelected = () => {
    if (checkedCount === 1) {
      const targetId = checkedAccountIds[0];
      const acc = accounts.find((a) => a.id === targetId);
      if (acc) {
        handleEditAccount(acc);
      }
    }
  };

  const handleClearFilters = () => {
    setFilters({
      searchQuery: '',
      statusFilter: 'all',
      dateFilter: 'all',
      providerFilter: 'all',
      browserFilter: 'all',
    });
  };

  const handleAddAccount = (newAccData: Omit<Account, 'id' | 'stt'>) => {
    void controller.create(newAccData);
  };

  const handleSaveAccount = (updated: Account) => {
    void controller.update(updated.id, updated);
  };

  const handleDeleteSelected = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    void controller.remove(checkedAccountIds);
    setRowSelection({});
    setIsDeleteDialogOpen(false);
  };

  const columns = useMemo(
    () =>
      createAccountsColumns({
        onEditAccount: handleEditAccount,
      }),
    []
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        icon={<Download className="w-3.5 h-3.5" />}
        onClick={() => setIsExportDialogOpen(true)}
      >
        Xuất File
      </Button>

      {checkedCount > 0 && (
        <Button
          variant="danger"
          size="md"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={handleDeleteSelected}
        >
          Xóa ({checkedCount})
        </Button>
      )}

      {checkedCount === 1 && (
        <Button
          variant="secondary"
          size="md"
          icon={<Edit className="w-3.5 h-3.5" />}
          onClick={handleEditSelected}
        >
          Chỉnh sửa
        </Button>
      )}

      <Button
        variant="primary"
        size="md"
        icon={<Plus className="w-3.5 h-3.5" />}
        onClick={() => setIsAddDrawerOpen(true)}
      >
        THÊM TÀI KHOẢN
      </Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Shared AppHeader */}
      <AppHeader
        title="QUẢN LÝ TÀI KHOẢN"
        subtitle="Danh sách và trạng thái tài khoản CapCut trong hệ thống"
        actions={headerActions}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 bg-background p-lg space-y-md overflow-hidden">
        {controllerState.error && (
          <div className="flex items-start gap-2 rounded border border-error/30 bg-error/10 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-error mt-0.5 shrink-0" />
            <span className="font-body-sm text-body-sm text-error">{controllerState.error}</span>
          </div>
        )}

        {/* KPI Summary Header */}
        <AccountsSummaryBar accounts={accounts} />

        {/* Action & Filter Toolbar */}
        <AccountsToolbar
          filters={filters}
          onFilterChange={setFilters}
          onClearFilters={handleClearFilters}
        />

        {/* DataGrid Container */}
        <div className="flex-1 flex flex-col min-h-0 bg-surface rounded border border-panel-border overflow-hidden">
          <div className="flex-1 overflow-auto custom-scrollbar">
            <DataGrid
              data={filteredAccounts}
              columns={columns}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              getRowId={(row) => row.id}
              emptyText={
                controllerState.isLoading
                  ? 'Đang tải danh sách tài khoản...'
                  : 'Chưa có tài khoản nào trong hệ thống.'
              }
            />
          </div>

          {/* Pagination */}
          <Pagination
            currentPage={currentPage}
            totalItems={filteredAccounts.length}
            pageSize={pageSize}
            selectedCount={checkedCount}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>

      {/* Drawers & Dialogs */}
      <AddAccountDrawer
        isOpen={isAddDrawerOpen}
        onClose={() => setIsAddDrawerOpen(false)}
        onAddAccount={handleAddAccount}
      />

      <EditAccountDrawer
        isOpen={isEditDrawerOpen}
        onClose={() => setIsEditDrawerOpen(false)}
        account={editingAccount}
        onSaveAccount={handleSaveAccount}
      />

      <DeleteAccountDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        selectedCount={checkedCount}
        onConfirmDelete={handleConfirmDelete}
      />

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        checkedCount={checkedCount}
        filteredCount={filteredAccounts.length}
        totalCount={accounts.length}
        exportFields={exportConfig.checkedFields.map(
          (f) => CANONICAL_TO_DISPLAY_FIELD[f] ?? 'Email'
        )}
        defaultFormat={CANONICAL_TO_DISPLAY_FORMAT[exportConfig.defaultFormat] ?? 'TXT'}
      />
    </div>
  );
};
