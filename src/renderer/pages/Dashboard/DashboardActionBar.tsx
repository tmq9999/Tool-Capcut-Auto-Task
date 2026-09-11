import React from 'react';
import { User, Globe, Monitor, Play, Save, CheckSquare } from 'lucide-react';
import { Button } from '@renderer/components/ui/Button';
import type { AutomationRunState, AutomationTerminalReasonDTO } from '@shared/schemas/automation.schema';

const RUN_STATE_LABEL: Record<AutomationRunState, string> = {
  idle: 'Chưa chạy',
  preparing: 'Đang chuẩn bị',
  running: 'Đang chạy',
  stopping: 'Đang dừng',
  completed: 'Hoàn tất',
  stopped: 'Đã dừng',
  blocked: 'Bị chặn',
  failed: 'Thất bại'
};

function formatCapacityDetails(
  reason: AutomationTerminalReasonDTO | undefined
): string | null {
  if (reason?.code !== 'INSUFFICIENT_FUNDS' || !reason.details) return null;
  const details = reason.details;
  const values = [
    ['requestedWorkers', 'Yêu cầu ', ' luồng'],
    ['reusableCount', 'tái sử dụng ', ''],
    ['balance', 'số dư ', ''],
    ['unitPrice', 'giá ', ''],
    ['affordablePurchaseCount', 'mua được ', ''],
    ['checkedAt', 'kiểm tra lúc ', '']
  ] as const;
  const parts = values.flatMap(([key, prefix, suffix]) =>
    details[key] === undefined
      ? []
      : [prefix + String(details[key]) + suffix]
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

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
  isStopping?: boolean;
  isSubmitting?: boolean;
  workerTarget?: number;
  workersActive?: number;
  accountsAccepted?: number;
  accountsCompleted?: number;
  accountsFailed?: number;
  accountsStopped?: number;
  runState?: AutomationRunState;
  runMessage?: string;
  terminalReason?: AutomationTerminalReasonDTO;
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
  isStopping = false,
  isSubmitting = false,
  workerTarget,
  workersActive,
  accountsAccepted,
  accountsCompleted,
  accountsFailed,
  accountsStopped,
  runState,
  runMessage,
  terminalReason,
}) => {
  const capacityDetails = formatCapacityDetails(terminalReason);
  const hasCounters = workerTarget !== undefined && workersActive !== undefined;

  return (
    <div className="bg-panel border border-panel-border rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm shrink-0 select-none">
      {/* Summary Indicators */}
      <div className="flex flex-wrap items-center gap-4 font-body-sm text-body-sm text-on-surface-variant">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-primary" />
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

        {hasCounters && (
          <div className="flex items-center gap-3 text-xs border-l border-panel-border pl-3">
            <span>{workersActive}/{workerTarget} luồng đang hoạt động</span>
            {accountsAccepted !== undefined && <span>{accountsAccepted} đã nhận</span>}
            {accountsCompleted !== undefined && <span className="text-success">{accountsCompleted} xong</span>}
            {accountsFailed !== undefined && <span className="text-error">{accountsFailed} lỗi</span>}
            {accountsStopped !== undefined && <span className="text-on-surface-variant">{accountsStopped} dừng</span>}
          </div>
        )}

        {runState && (
          <div className="flex items-center gap-2 text-xs border-l border-panel-border pl-3">
            <span className="font-semibold text-on-surface">{RUN_STATE_LABEL[runState]}</span>
            {runMessage && <span>{runMessage}</span>}
            {capacityDetails && (
              <span className="text-on-surface-variant/80 font-code">{capacityDetails}</span>
            )}
          </div>
        )}
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
          disabled={isStopping || isSubmitting}
          className="px-5 font-bold tracking-wide"
        >
          {isStopping ? 'ĐANG DỪNG...' : isSubmitting ? 'ĐANG BẬT...' : isRunning ? 'DỪNG LẠI' : 'BẮT ĐẦU'}
        </Button>
      </div>
    </div>
  );
};
