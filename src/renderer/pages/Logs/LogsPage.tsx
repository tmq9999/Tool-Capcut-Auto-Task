import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pause, Play, Trash2, AlertCircle } from 'lucide-react';
import { AppHeader } from '@renderer/layouts/AppHeader';
import { Button } from '@renderer/components/ui/Button';
import { DataGrid } from '@renderer/components/ui/DataGrid';
import { LogsFilterBar } from './LogsFilterBar';
import { logsColumns } from './columns';
import { LogsController, type ILogsBridge } from './logsController';
import { LogFilterState } from '@shared/types/log';

/** Offline fallback so the page still renders outside Electron. */
const OFFLINE_BRIDGE: ILogsBridge = {
  logs: {
    list: async () => ({ success: true, data: { items: [], total: 0 } }),
    clear: async () => ({ success: true, data: { success: true } }),
    onEntry: () => () => {},
  },
};

export const LogsPage: React.FC = () => {
  const controller = useMemo(() => {
    const api = window.electronAPI;
    return new LogsController(api ? { logs: api.logs } : OFFLINE_BRIDGE);
  }, []);

  const state = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.getState()
  );

  const [filters, setFilters] = useState<LogFilterState>({
    searchQuery: '',
    levelFilter: 'ALL',
    emailFilter: 'ALL',
    autoScroll: true,
    isPaused: false,
  });

  useEffect(() => {
    controller.attach();
    void controller.load();
    return () => controller.dispose();
  }, [controller]);

  const availableEmails = useMemo(() => {
    const unique = new Set<string>();
    state.logs.forEach((log) => {
      if (log.email && log.email !== 'system') unique.add(log.email);
    });
    return Array.from(unique);
  }, [state.logs]);

  const filteredLogs = useMemo(() => {
    const query = filters.searchQuery.trim().toLowerCase();
    return state.logs.filter((log) => {
      const matchesSearch =
        query.length === 0 ||
        log.message.toLowerCase().includes(query) ||
        log.email.toLowerCase().includes(query) ||
        log.step.toLowerCase().includes(query);

      const matchesLevel =
        filters.levelFilter === 'ALL' ||
        log.status.toUpperCase() === filters.levelFilter.toUpperCase();

      const matchesEmail =
        filters.emailFilter === 'ALL' ||
        log.email.toLowerCase() === filters.emailFilter.toLowerCase();

      return matchesSearch && matchesLevel && matchesEmail;
    });
  }, [state.logs, filters]);

  const handleTogglePause = (): void => {
    const nextPaused = !state.isPaused;
    controller.setPaused(nextPaused);
    setFilters((prev) => ({ ...prev, isPaused: nextPaused }));
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        icon={
          state.isPaused ? (
            <Play className="w-4 h-4 text-success" />
          ) : (
            <Pause className="w-4 h-4 text-warning" />
          )
        }
        onClick={handleTogglePause}
      >
        {state.isPaused ? 'Tiếp tục' : 'Tạm dừng (Pause)'}
      </Button>

      <Button
        variant="danger"
        size="md"
        icon={<Trash2 className="w-4 h-4" />}
        onClick={() => void controller.clear()}
      >
        Xóa Logs
      </Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <AppHeader
        title="NHẬT KÝ LOGS"
        subtitle="Theo dõi runtime và debug lỗi Automation"
        actions={headerActions}
      />

      <LogsFilterBar
        filters={{ ...filters, isPaused: state.isPaused }}
        onFilterChange={setFilters}
        availableEmails={availableEmails}
      />

      {state.error && (
        <div className="mx-lg mt-md flex items-start gap-2 rounded border border-error/30 bg-error/10 px-3 py-2">
          <AlertCircle className="w-4 h-4 text-error mt-0.5 shrink-0" />
          <span className="font-body-sm text-body-sm text-error">{state.error}</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden bg-[#0d1117]">
        <DataGrid
          data={filteredLogs}
          columns={logsColumns}
          getRowId={(row) => row.id}
          className="bg-[#0d1117]"
          tableClassName="bg-[#0d1117]"
          emptyText={
            state.isLoading ? 'Đang tải nhật ký...' : 'Không có bản ghi nhật ký phù hợp.'
          }
          rowClassName={(row) =>
            row.original.status === 'ERROR'
              ? 'bg-[#1a1010]/80 hover:bg-[#2a1515] border-l-2 border-l-error'
              : ''
          }
        />
      </div>
    </div>
  );
};
