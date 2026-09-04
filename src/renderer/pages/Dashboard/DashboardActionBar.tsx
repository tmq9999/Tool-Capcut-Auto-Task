import React from 'react';
import { User, Globe, Monitor, Play, Save, CheckSquare } from 'lucide-react';
import { Button } from '@renderer/components/ui/Button';

export interface DashboardActionBarProps {
  accountCount?: number;
  /** Số dòng lưới đang thực sự giữ; nhỏ hơn tổng thì hiện "đang tải / tổng". */
  loadedCount?: number;
  proxyCount?: number;
  browserName?: string;
  onSaveConfig?: () => void;
  saveConfigLabel?: string;
  onVerifyData?: () => void;
  onStart?: () => void;
  isRunning?: boolean;
}

export const DashboardActionBar: React.FC<DashboardActionBarProps> = ({
  accountCount = 10,
  loadedCount,
  proxyCount = 10,
  browserName = 'Multilogin',
  onSaveConfig,
  saveConfigLabel = 'Lưu cấu hình',
  onVerifyData,
  onStart,
  isRunning = false,
}) => {
  return (
    <div className="bg-panel border border-panel-border rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm shrink-0 select-none">
      {/* Summary Indicators */}
      <div className="flex items-center gap-4 font-body-sm text-body-sm text-on-surface-variant">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-primary" />
          {/*
            Hiện "đang tải / tổng" khi lưới bị cắt: bản cũ chỉ hiện tổng thật trong
            DB trong khi lưới chỉ nạp 200 dòng mới nhất — người dùng đếm không ra
            (audit 04/09/2026).
          */}
          <span className="font-medium text-on-surface">
            {typeof loadedCount === 'number' && loadedCount < accountCount
              ? loadedCount + ' / ' + accountCount
              : accountCount}
          </span>
          <span className="text-xs">Tài khoản</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-primary" />
          <span className="font-medium text-on-surface">{proxyCount}</span>
          <span className="text-xs">Proxies</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Monitor className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs">Browser:</span>
          <span className="font-medium text-primary text-xs">{browserName}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="surface"
          size="sm"
          icon={<Save className="w-3.5 h-3.5 text-on-surface-variant" />}
          onClick={onSaveConfig}
        >
          {saveConfigLabel}
        </Button>

        <Button
          variant="surface"
          size="sm"
          icon={<CheckSquare className="w-3.5 h-3.5 text-on-surface-variant" />}
          onClick={onVerifyData}
        >
          Kiểm tra dữ liệu
        </Button>

        <Button
          variant={isRunning ? 'danger' : 'primary'}
          size="sm"
          icon={<Play className="w-3.5 h-3.5 fill-current" />}
          onClick={onStart}
          className="px-5 font-bold tracking-wide"
        >
          {isRunning ? 'DỪNG LẠI' : 'BẮT ĐẦU'}
        </Button>
      </div>
    </div>
  );
};
