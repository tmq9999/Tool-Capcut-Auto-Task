import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { Checkbox } from '@renderer/components/ui/Checkbox';
import { LogFilterState } from '@shared/types/log';

export interface LogsFilterBarProps {
  filters: LogFilterState;
  onFilterChange: (filters: LogFilterState) => void;
  availableEmails: string[];
}

export const LogsFilterBar: React.FC<LogsFilterBarProps> = ({
  filters,
  onFilterChange,
  availableEmails,
}) => {
  return (
    <div className="px-lg py-sm bg-panel flex flex-wrap items-center justify-between gap-md border-b border-panel-border shrink-0 select-none">
      <div className="flex flex-wrap items-center gap-sm flex-1">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Input
            controlSize="sm"
            placeholder="Tìm email hoặc nội dung log..."
            value={filters.searchQuery}
            onChange={(e) =>
              onFilterChange({ ...filters, searchQuery: e.target.value })
            }
            leftIcon={<Search className="w-4 h-4 text-on-surface-variant" />}
          />
        </div>

        {/* Level Filter */}
        <div className="w-[140px]">
          <Select
            controlSize="sm"
            value={filters.levelFilter}
            onChange={(e) =>
              onFilterChange({ ...filters, levelFilter: e.target.value })
            }
          >
            <option value="ALL">Level: Tất cả</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WAITING">WAITING</option>
            <option value="SUCCESS">SUCCESS</option>
            {/* WARNING thiếu trong bản cũ dù `log.schema.ts` có và engine bắn rất
                nhiều dòng loại này (audit 04/09/2026). */}
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </Select>
        </div>

        {/* Account / Email Filter */}
        <div className="w-[200px]">
          <Select
            controlSize="sm"
            value={filters.emailFilter}
            onChange={(e) =>
              onFilterChange({ ...filters, emailFilter: e.target.value })
            }
          >
            <option value="ALL">Email: Tất cả tài khoản</option>
            {availableEmails.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Auto Scroll Toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <Checkbox
          checked={filters.autoScroll}
          onChange={(e) =>
            onFilterChange({ ...filters, autoScroll: e.target.checked })
          }
        />
        <span className="font-code text-code text-on-surface-variant">Auto Scroll</span>
      </label>
    </div>
  );
};
