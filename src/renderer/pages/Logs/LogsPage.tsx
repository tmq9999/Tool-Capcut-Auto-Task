import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
    return () => controller.dispose();
  }, [controller]);

  /**
   * Lọc `level`/`email` chạy bằng SQL (`LogRepository.ts:55-62`) chứ không lọc
   * trên mảng đã tải: bộ đệm chỉ giữ 500 dòng mới nhất, mà DB có 1573 dòng —
   * dòng ERROR thứ 800 không nằm trong bộ đệm nên lọc client báo "không có bản
   * ghi phù hợp" trong khi lỗi vẫn nằm trong DB (đo 04/09/2026).
   *
   * Hoãn 250ms vì `emailFilter` cũng đổi theo từng lần gõ ở các bản sau; một
   * lượt `logs.list` cho mỗi ký tự là thừa. Dọn timer khi unmount để không gọi
   * `load()` trên controller đã `dispose()`.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      void controller.load({ level: filters.levelFilter, email: filters.emailFilter });
    }, 250);
    return () => clearTimeout(timer);
  }, [controller, filters.levelFilter, filters.emailFilter]);

  const availableEmails = useMemo(() => {
    const unique = new Set<string>();
    state.logs.forEach((log) => {
      if (log.email && log.email !== 'system') unique.add(log.email);
    });
    return Array.from(unique);
  }, [state.logs]);

  /**
   * Chỉ còn lọc `searchQuery` phía client: `LogFilterSchema` không có khoá tìm
   * kiếm toàn văn (kiểm `log.schema.ts` 04/09/2026 — chỉ có `level`, `email`,
   * `page`, `pageSize`), nên không có gì để đẩy xuống SQL. `level`/`email` đã
   * lọc bằng SQL ở effect trên; lọc lại ở đây là lọc hai lần.
   */
  const filteredLogs = useMemo(() => {
    const query = filters.searchQuery.trim().toLowerCase();
    if (query.length === 0) return state.logs;
    return state.logs.filter(
      (log) =>
        log.message.toLowerCase().includes(query) ||
        log.email.toLowerCase().includes(query) ||
        log.step.toLowerCase().includes(query)
    );
  }, [state.logs, filters.searchQuery]);

  /**
   * "Auto Scroll" — ô tích này trước đây chỉ đổi state, không cuộn gì (audit
   * 04/09/2026). Dòng MỚI NHẤT được `logsController` chèn lên ĐẦU danh sách
   * (`logs: [entry, ...prev]`), nên "theo dòng mới" là cuộn về ĐỈNH, không phải
   * xuống đáy. Chỉ cuộn khi ô được tích, để người đang đọc log cũ không bị giật.
   */
  const gridScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filters.autoScroll) return;
    const el = gridScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [filteredLogs, filters.autoScroll]);

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
          scrollRef={gridScrollRef}
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
