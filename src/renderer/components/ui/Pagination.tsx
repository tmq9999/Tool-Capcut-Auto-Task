import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  selectedCount?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  selectedCount,
  onPageChange,
  className,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div
      className={clsx(
        'p-sm border-t border-panel-border flex justify-between items-center bg-panel font-body-sm text-body-sm text-on-surface-variant shrink-0 select-none',
        className
      )}
    >
      <div className="flex items-center gap-md">
        {selectedCount !== undefined && selectedCount > 0 && (
          <span className="text-primary font-medium bg-primary/10 px-2 py-0.5 rounded border border-primary/20 font-label-xs">
            {selectedCount} mục đã chọn
          </span>
        )}
      </div>

      <div className="flex items-center gap-md font-body-sm text-body-sm">
        <span className="font-code text-code">
          {startItem}-{endItem} trong {totalItems.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="h-6 w-6 flex items-center justify-center border border-panel-border rounded bg-surface hover:bg-surface-container-high text-on-surface-variant disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="h-6 w-6 flex items-center justify-center border border-panel-border rounded bg-surface hover:bg-surface-container-high text-on-surface hover:text-primary disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
