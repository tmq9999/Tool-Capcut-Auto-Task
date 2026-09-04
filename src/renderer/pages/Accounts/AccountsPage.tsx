import React, { useState, useMemo, useEffect, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { TaskProgressDialog } from './TaskProgressDialog';
import { AccountsController, dateFilterToCreatedFrom, type IAccountsBridge } from './accountsController';
import { Account, AccountFilterState, ExportFormat } from '@shared/types/account';
import type { ExportSettingsDTO } from '@shared/schemas/settings.schema';
import { DEFAULT_APP_SETTINGS } from '@shared/settings/default-settings';

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
    export: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
    tasks: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
  },
};

export const AccountsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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
  /** Account đang xem tiến độ 12 nhiệm vụ; null = hộp thoại đóng. */
  const [taskAccount, setTaskAccount] = useState<Account | null>(null);

  /**
   * Nút Export trên Dashboard dẫn sang đây kèm `?export=1` — chỉ có MỘT hộp thoại
   * xuất trong app, đúng chỗ chọn được phạm vi/định dạng/cột. Xoá tham số ngay sau
   * khi mở để bấm F5 hay quay lại không tự bật hộp thoại lần nữa.
   */
  useEffect(() => {
    if (searchParams.get('export') !== '1') return;
    setIsExportDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('export');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /**
   * Bộ lọc GỬI XUỐNG SERVER. Một nguồn duy nhất cho cả `load()` và phạm vi
   * "Đang lọc" của hộp thoại xuất — xuất theo bộ lọc mà lệch bộ lọc đang xem
   * thì người dùng nhận file khác hẳn cái đang nhìn.
   */
  const serverFilter = useMemo(
    () => ({
      query: filters.searchQuery,
      status: filters.statusFilter,
      emailProvider: filters.providerFilter,
      createdFrom: dateFilterToCreatedFrom(filters.dateFilter),
    }),
    [filters.searchQuery, filters.statusFilter, filters.providerFilter, filters.dateFilter]
  );

  /**
   * Đẩy bộ lọc XUỐNG SERVER. Bản cũ chỉ `load()` một lần rồi lọc phía client trên
   * 500 dòng đầu — có 2000 account thì cái nằm ở dòng 900 tìm không ra dù DB có
   * (audit 04/09/2026). Debounce vì ô tìm kiếm gõ từng ký tự.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      void controller.load(serverFilter);
      setCurrentPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [controller, serverFilter]);

  /**
   * Ba bộ lọc trên đã chạy Ở SERVER nên KHÔNG lọc lại ở đây — lọc hai lần thì kết
   * quả server trả về đúng lại bị cắt bởi phép so client-side yếu hơn.
   * `browserFilter` vẫn ở client vì contract chưa có khoá tương ứng.
   */
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesBrowser =
        filters.browserFilter === 'all' ||
        (acc.browserProfile &&
          acc.browserProfile.toLowerCase().includes(filters.browserFilter.toLowerCase()));

      return matchesBrowser;
    });
  }, [accounts, filters.browserFilter]);

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
        onViewTasks: (account) => setTaskAccount(account),
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
              pagination={{ pageIndex: currentPage - 1, pageSize }}
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
        /**
         * Tổng THẬT trong DB, không phải số dòng đã tải. Phạm vi "Tất cả" xuất
         * hết bảng nên con số trên nút phải là con số đó.
         */
        totalCount={controllerState.total}
        exportFields={exportConfig.checkedFields}
        defaultFormat={CANONICAL_TO_DISPLAY_FORMAT[exportConfig.defaultFormat] ?? 'TXT'}
        checkedIds={checkedAccountIds}
        currentFilter={serverFilter}
        onExport={(request) => controller.exportAccounts(request)}
      />

      <TaskProgressDialog
        isOpen={taskAccount !== null}
        onClose={() => setTaskAccount(null)}
        accountId={taskAccount?.id ?? null}
        email={taskAccount?.email ?? ''}
        loadTasks={(accountId) => controller.loadTasks(accountId)}
      />
    </div>
  );
};
