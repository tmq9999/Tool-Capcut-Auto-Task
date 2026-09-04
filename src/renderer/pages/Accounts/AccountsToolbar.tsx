import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { AccountFilterState } from '@shared/types/account';

export interface AccountsToolbarProps {
  filters: AccountFilterState;
  onFilterChange: (filters: AccountFilterState) => void;
  onClearFilters: () => void;
}

export const AccountsToolbar: React.FC<AccountsToolbarProps> = ({
  filters,
  onFilterChange,
  onClearFilters,
}) => {
  const hasActiveFilters =
    filters.statusFilter !== 'all' ||
    filters.providerFilter !== 'all' ||
    filters.browserFilter !== 'all' ||
    filters.dateFilter !== 'all' ||
    filters.searchQuery.trim() !== '';

  return (
    <div className="p-md border-b border-panel-border flex flex-col gap-sm shrink-0 bg-panel select-none">
      {/* Top Filter Controls */}
      <div className="flex flex-wrap items-center gap-sm">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Input
            controlSize="sm"
            placeholder="Tìm email, ID, proxy, ghi chú..."
            value={filters.searchQuery}
            onChange={(e) => onFilterChange({ ...filters, searchQuery: e.target.value })}
            leftIcon={<Search className="w-4 h-4 text-on-surface-variant" />}
          />
        </div>

        {/* Filters */}
        <div className="w-[140px]">
          <Select
            controlSize="sm"
            value={filters.statusFilter}
            onChange={(e) => onFilterChange({ ...filters, statusFilter: e.target.value })}
          >
            <option value="all">Trạng thái: Tất cả</option>
            <option value="active">Hoạt động</option>
            <option value="processing">Đang xử lý</option>
            <option value="error">Lỗi</option>
            <option value="disabled">Đã tắt</option>
            {/*
              `waiting` và `done` thiếu trong bản cũ, mà `done` chính là trạng thái
              của MỌI account chạy xong (`AutomationRunService.shutdownThread`) —
              không lọc được đúng thứ người dùng cần tìm nhất.
            */}
            <option value="waiting">Đang chờ</option>
            <option value="done">Hoàn tất</option>
          </Select>
        </div>

        <div className="w-[130px]">
          <Select
            controlSize="sm"
            value={filters.dateFilter}
            onChange={(e) => onFilterChange({ ...filters, dateFilter: e.target.value })}
          >
            <option value="all">Ngày tạo: Tất cả</option>
            <option value="today">Hôm nay</option>
            <option value="7days">7 ngày qua</option>
            <option value="30days">30 ngày qua</option>
          </Select>
        </div>

        <div className="w-[140px]">
          <Select
            controlSize="sm"
            value={filters.providerFilter}
            onChange={(e) => onFilterChange({ ...filters, providerFilter: e.target.value })}
          >
            <option value="all">Provider: Tất cả</option>
            {/*
              Giá trị phải khớp `emailProvider` mà automation GHI RA
              (`AutomationRunService`): gmail94 / dongvanfb / customdomain / manual.
              Bản cũ để Gmail/Outlook/Yahoo/Proton và so `===` nên KHÔNG BAO GIỜ
              khớp account do bot tạo — lọc luôn ra 0 dòng (audit 04/09/2026).
            */}
            <option value="gmail94">Gmail94</option>
            <option value="dongvanfb">DongVanFB</option>
            <option value="customdomain">Domain riêng</option>
            <option value="manual">Nhập tay</option>
          </Select>
        </div>

        <div className="w-[140px]">
          <Select
            controlSize="sm"
            value={filters.browserFilter}
            onChange={(e) => onFilterChange({ ...filters, browserFilter: e.target.value })}
          >
            <option value="all">Browser: Tất cả</option>
            <option value="Multilogin">Multilogin</option>
            <option value="GPM">GPM Login</option>
            <option value="Camoufox">Camoufox</option>
            <option value="Patchright">Patchright</option>
          </Select>
        </div>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-xs pt-1">
          <span className="font-label-xs text-label-xs text-on-surface-variant uppercase mr-1">
            Active Filters:
          </span>

          {filters.statusFilter !== 'all' && (
            <div className="h-6 px-2 flex items-center gap-1 bg-primary/10 border border-primary/30 text-primary font-body-sm text-xs rounded-full">
              <span>Trạng thái: {filters.statusFilter}</span>
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, statusFilter: 'all' })}
                className="hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {filters.providerFilter !== 'all' && (
            <div className="h-6 px-2 flex items-center gap-1 bg-surface-container-high border border-panel-border text-on-surface font-body-sm text-xs rounded-full">
              <span>Provider: {filters.providerFilter}</span>
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, providerFilter: 'all' })}
                className="hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {filters.browserFilter !== 'all' && (
            <div className="h-6 px-2 flex items-center gap-1 bg-surface-container-high border border-panel-border text-on-surface font-body-sm text-xs rounded-full">
              <span>Browser: {filters.browserFilter}</span>
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, browserFilter: 'all' })}
                className="hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClearFilters}
            className="text-primary font-label-xs text-xs hover:underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};
