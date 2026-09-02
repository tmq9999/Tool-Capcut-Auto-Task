import React from 'react';
import { Account } from '@shared/types/account';

export interface AccountsSummaryBarProps {
  accounts: Account[];
}

export const AccountsSummaryBar: React.FC<AccountsSummaryBarProps> = ({ accounts }) => {
  const total = accounts.length;
  const activeCount = accounts.filter((a) => a.status === 'active' || a.status === 'done').length;
  const processingCount = accounts.filter((a) => a.status === 'processing' || a.status === 'waiting').length;
  const errorCount = accounts.filter((a) => a.status === 'error').length;
  const disabledCount = accounts.filter((a) => a.status === 'disabled').length;

  return (
    <div className="flex flex-wrap items-center gap-md font-code text-code text-on-surface-variant bg-surface-container-low px-md py-2 rounded border border-panel-border w-fit select-none shrink-0">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-on-surface-variant/80" />
        <span>Tổng:</span>
        <strong className="text-on-surface font-semibold">{total.toLocaleString()}</strong>
      </span>

      <span className="text-panel-border">|</span>

      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-success" />
        <span>Hoạt động:</span>
        <strong className="text-on-surface font-semibold">{activeCount.toLocaleString()}</strong>
      </span>

      <span className="text-panel-border">|</span>

      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-warning" />
        <span>Đang xử lý:</span>
        <strong className="text-on-surface font-semibold">{processingCount.toLocaleString()}</strong>
      </span>

      <span className="text-panel-border">|</span>

      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-error" />
        <span>Lỗi:</span>
        <strong className="text-on-surface font-semibold">{errorCount.toLocaleString()}</strong>
      </span>

      <span className="text-panel-border">|</span>

      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-outline-variant" />
        <span>Đã tắt:</span>
        <strong className="text-on-surface font-semibold">{disabledCount.toLocaleString()}</strong>
      </span>
    </div>
  );
};
