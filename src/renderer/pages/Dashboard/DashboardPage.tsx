import React, { useState, useMemo, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Upload, Download, Trash2, AlertCircle } from 'lucide-react';
import { RowSelectionState } from '@tanstack/react-table';
import { AppHeader } from '@renderer/layouts/AppHeader';
import { Button } from '@renderer/components/ui/Button';
import { IconButton } from '@renderer/components/ui/IconButton';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { DataGrid } from '@renderer/components/ui/DataGrid';
import { AutomationConfigGrid } from './AutomationConfigGrid';
import { DashboardActionBar } from './DashboardActionBar';
import { DockedLiveLogs } from './DockedLiveLogs';
import { createDashboardColumns } from './columns';
import { DashboardController, type IDashboardBridge } from './dashboardController';

/** Offline fallback so the page still renders outside Electron. */
const OFFLINE_BRIDGE: IDashboardBridge = {
  accounts: {
    list: async () => ({ success: true, data: { items: [], total: 0 } }),
    remove: async () => ({ success: true, data: { deletedCount: 0 } }),
  },
  logs: {
    list: async () => ({ success: true, data: { items: [], total: 0 } }),
    onEntry: () => () => {},
  },
  run: {
    start: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
    stop: async () => ({ success: true, data: { success: true } }),
    stopThread: async () => ({ success: true, data: { stopped: false } }),
    threads: async () => ({ success: true, data: [] }),
    progress: async () => ({
      success: true,
      data: {
        runId: 'none',
        state: 'idle',
        workerTarget: 0,
        workersActive: 0,
        accountsAccepted: 0,
        accountsCompleted: 0,
        accountsFailed: 0,
        accountsStopped: 0,
        message: 'Chưa chạy',
      },
    }),
    onProgress: () => () => {},
  },
  email: {
    providers: async () => ({ success: true, data: [] }),
  },
  settings: {
    get: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
    save: async () => ({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Không có kết nối tới tiến trình chính.' },
    }),
  },
};

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const controller = useMemo(() => {
    const api = window.electronAPI;
    const bridge: IDashboardBridge = api
      ? {
          accounts: api.accounts,
          logs: api.logs,
          run: api.run,
          email: api.email,
          settings: api.settings,
        }
      : OFFLINE_BRIDGE;
    return new DashboardController(bridge);
  }, []);

  const state = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.getState()
  );

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(false);

  useEffect(() => {
    controller.attach();
    void controller.load();
    return () => controller.dispose();
  }, [controller]);

  const isRunning = controller.isRunning();
  const hasOwnedProfiles = state.runningThreads.length > 0;

  const filteredAccounts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return state.accounts.filter((account) => {
      const matchesSearch =
        query.length === 0 ||
        account.email.toLowerCase().includes(query) ||
        (account.notes ?? '').toLowerCase().includes(query);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'running' && (account.status === 'active' || account.status === 'processing')) ||
        (statusFilter === 'waiting' && account.status === 'waiting') ||
        (statusFilter === 'done' && account.status === 'done') ||
        (statusFilter === 'error' && account.status === 'error');

      return matchesSearch && matchesStatus;
    });
  }, [state.accounts, searchQuery, statusFilter]);

  const proxyCount = state.accounts.filter((account) => Boolean(account.proxy)).length;

  // Per-row control: stop just this account browser, never the whole run.
  const runningAccountIds = useMemo(
    () => new Set(state.runningThreads.map((thread) => thread.accountId)),
    [state.runningThreads]
  );

  const columns = useMemo(
    () =>
      createDashboardColumns({
        isThreadRunning: (accountId) => runningAccountIds.has(accountId),
        onStopThread: (accountId) => void controller.stopThread(accountId),
      }),
    [controller, runningAccountIds]
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      <IconButton
        variant="ghost"
        size="md"
        title="Tải lại dữ liệu"
        onClick={() => void controller.load()}
      >
        <RefreshCw className="w-3.5 h-3.5 text-on-surface-variant" />
      </IconButton>

      <div className="h-5 w-px bg-panel-border mx-0.5" />

      <Button
        variant="secondary"
        size="sm"
        disabled={(!isRunning && !hasOwnedProfiles) || state.isStopping}
        onClick={() => void controller.stop()}
      >
        {state.isStopping ? 'Đang dừng...' : 'Dừng phiên'}
      </Button>

      <Button
        variant="primary"
        size="sm"
        disabled={isRunning || hasOwnedProfiles || state.isSubmitting || state.isStopping}
        onClick={() => void controller.start()}
      >
        {isRunning ? 'Đang chạy...' : 'Bắt đầu'}
      </Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <AppHeader
        title="DASHBOARD"
        subtitle="Quản lý và theo dõi các tiến trình automation"
        actions={headerActions}
      />

      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2.5 overflow-hidden">
        <AutomationConfigGrid
          config={state.config}
          onChange={(patch) => controller.updateConfig(patch)}
          emailProviders={state.emailProviders}
          customEmail={state.customEmail}
          disabled={isRunning}
          isCollapsed={isConfigCollapsed}
          onToggleCollapse={() => setIsConfigCollapsed(!isConfigCollapsed)}
        />

        {state.error && (
          <div className="flex items-start gap-2 rounded border border-error/30 bg-error/10 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-error mt-0.5 shrink-0" />
            <span className="font-body-sm text-body-sm text-error">{state.error}</span>
          </div>
        )}

        <DashboardActionBar
          accountCount={state.totalAccounts}
          loadedCount={state.accounts.length}
          proxyCount={proxyCount}
          browserName={state.config.browser}
          isRunning={isRunning || hasOwnedProfiles}
          isStopping={state.isStopping}
          workerTarget={state.progress.workerTarget}
          workersActive={state.progress.workersActive}
          accountsAccepted={state.progress.accountsAccepted}
          accountsCompleted={state.progress.accountsCompleted}
          accountsFailed={state.progress.accountsFailed}
          accountsStopped={state.progress.accountsStopped}
          runState={state.progress.state}
          runMessage={state.progress.message}
          terminalReason={state.progress.terminalReason}
          onStart={() => (isRunning || hasOwnedProfiles ? void controller.stop() : void controller.start())}
          onVerifyData={() => void controller.load()}
          onSaveConfig={() => void controller.saveConfig()}
          saveConfigLabel={
            state.isSavingConfig
              ? 'Đang lưu...'
              : state.configSavedAt
                ? 'Đã lưu cấu hình'
                : 'Lưu cấu hình'
          }
        />

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5 overflow-hidden">
          <div className="flex-1 lg:w-[74%] bg-table-bg border border-panel-border rounded-lg flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-panel-border bg-panel flex flex-wrap items-center justify-between gap-2 shrink-0 select-none">
              <div className="flex items-center gap-2">
                <h3 className="font-title-md text-sm text-on-surface font-semibold">
                  Danh sách tài khoản
                </h3>
                <span className="font-label-xs text-[11px] text-on-surface-variant">
                  {state.progress.message}
                </span>
                <div className="w-44">
                  <Input
                    controlSize="sm"
                    placeholder="Tìm email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    leftIcon={<Search className="w-3.5 h-3.5" />}
                  />
                </div>
                <div className="w-28">
                  <Select
                    controlSize="sm"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Status: All</option>
                    <option value="running">Running</option>
                    <option value="waiting">Waiting</option>
                    <option value="done">Done</option>
                    <option value="error">Error</option>
                    <option value="stopped">Stopped</option>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {/*
                  Hai nút này trước đây KHÔNG có `onClick` (audit 04/09/2026).
                  Xuất file có một đường duy nhất — hộp thoại ở trang Tài khoản, nơi
                  chọn được phạm vi/định dạng/cột — nên nút ở đây dẫn sang đó thay vì
                  mở thêm một đường xuất thứ hai. Nhập account theo file thì chưa có
                  ở bất cứ đâu, nên khoá lại kèm ghi chú thay vì hứa hão.
                */}
                <Button
                  variant="surface"
                  size="sm"
                  icon={<Upload className="w-3 h-3" />}
                  disabled
                  title="Nhập account từ file chưa hỗ trợ. Dán danh sách ở ô Nguồn email (Manual) để chạy."
                >
                  Import
                </Button>
                <Button
                  variant="surface"
                  size="sm"
                  icon={<Download className="w-3 h-3" />}
                  onClick={() => navigate('/accounts?export=1')}
                  title="Mở hộp thoại xuất ở trang Tài khoản"
                >
                  Export
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="w-3 h-3 text-error" />}
                  disabled={isRunning}
                  onClick={() => {
                    const doneIds = state.accounts
                      .filter((account) => account.status === 'done')
                      .map((account) => account.id);
                    if (doneIds.length > 0) {
                      void controller.removeAccounts(doneIds);
                    }
                  }}
                  className="text-on-surface-variant hover:text-error"
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              <DataGrid
                data={filteredAccounts}
                columns={columns}
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
                getRowId={(row) => row.id}
                emptyText={
                  state.isLoading ? 'Đang tải dữ liệu...' : 'Chưa có tài khoản nào. Bấm BẮT ĐẦU để chạy.'
                }
              />
            </div>
          </div>

          <div className="lg:w-[26%] flex flex-col min-h-0 overflow-hidden">
            <DockedLiveLogs logs={state.logs} isStreaming={isRunning} />
          </div>
        </div>
      </div>
    </div>
  );
};
