import React, { useState } from 'react';
import { Modal } from '@renderer/components/ui/Modal';
import { Button } from '@renderer/components/ui/Button';
import { ExportFormat, ExportScope } from '@shared/types/account';
import type { ExportField } from '@shared/schemas/settings.schema';
import {
  CANONICAL_EXPORT_FIELD_ORDER,
  EXPORT_FIELD_HEADERS,
  type AccountExportFilterDTO,
  type AccountExportRequestDTO
} from '@shared/schemas/account-export.schema';
import type { ExportOutcome } from './accountsController';
import { Download, FileSpreadsheet, FileText, FileCode } from 'lucide-react';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  checkedCount: number;
  filteredCount: number;
  totalCount: number;
  /** Cột được chọn trong Cài đặt xuất; thứ tự hiển thị luôn theo AGENTS §21. */
  exportFields: ExportField[];
  defaultFormat?: ExportFormat;
  /** Id các dòng đang tích — phạm vi "Đã chọn" gửi thẳng danh sách này. */
  checkedIds: string[];
  /** Bộ lọc đang áp ở server — phạm vi "Đang lọc" lấy hết dòng khớp, không chỉ trang này. */
  currentFilter: AccountExportFilterDTO;
  onExport: (request: AccountExportRequestDTO) => Promise<ExportOutcome>;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  checkedCount,
  filteredCount,
  totalCount,
  exportFields,
  defaultFormat = 'TXT',
  checkedIds,
  currentFilter,
  onExport,
}) => {
  const [scope, setScope] = useState<ExportScope>(
    checkedCount > 0 ? 'checked' : 'all'
  );
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setScope(checkedCount > 0 ? 'checked' : 'all');
      setFormat(defaultFormat);
      setStatus(null);
    }
  }, [isOpen, checkedCount, defaultFormat]);

  /** Thứ tự cột do §21 chốt, Cài đặt xuất chỉ chọn cột nào được xuất. */
  const orderedFields = CANONICAL_EXPORT_FIELD_ORDER.filter((f) => exportFields.includes(f));

  const getFormatIcon = (fmt: ExportFormat) => {
    switch (fmt) {
      case 'XLSX':
        return <FileSpreadsheet className="w-4 h-4 text-success" />;
      case 'CSV':
        return <FileCode className="w-4 h-4 text-warning" />;
      case 'TXT':
        return <FileText className="w-4 h-4 text-primary" />;
    }
  };

  const getScopeCount = () => {
    switch (scope) {
      case 'checked':
        return checkedCount;
      case 'filtered':
        return filteredCount;
      case 'all':
      default:
        return totalCount;
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setStatus(null);

    const outcome = await onExport({
      format,
      fields: orderedFields,
      scope:
        scope === 'checked'
          ? { kind: 'checked', ids: checkedIds }
          : scope === 'filtered'
            ? { kind: 'filtered', filter: currentFilter }
            : { kind: 'all' },
    });

    setIsExporting(false);
    if (outcome.kind === 'done') {
      setStatus({ ok: true, text: `Đã xuất ${outcome.exportedCount} tài khoản → ${outcome.filePath}` });
    } else if (outcome.kind === 'error') {
      setStatus({ ok: false, text: outcome.message });
    }
  };

  const canExport = getScopeCount() > 0 && orderedFields.length > 0 && !isExporting;

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={onClose}>
        Đóng
      </Button>
      <Button
        variant="primary"
        size="md"
        icon={<Download className="w-4 h-4" />}
        onClick={handleExport}
        disabled={!canExport}
      >
        {isExporting ? 'Đang xuất...' : `Xuất ${getScopeCount()} tài khoản (${format})`}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Xuất dữ liệu tài khoản"
      subtitle="Chọn phạm vi và định dạng file xuất"
      footer={footer}
      maxWidth="md"
    >
      <div className="space-y-lg">
        {/* Scope Selection */}
        <div className="space-y-sm">
          <label className="font-label-xs text-label-xs text-on-surface-variant uppercase font-semibold">
            1. Phạm vi xuất (Export Scope)
          </label>
          <div className="grid grid-cols-3 gap-sm">
            <label
              className={`flex flex-col gap-1 p-sm rounded border cursor-pointer transition-colors ${
                scope === 'all'
                  ? 'border-primary bg-primary/10'
                  : 'border-panel-border hover:border-outline bg-surface'
              }`}
            >
              <div className="flex items-center justify-between">
                <input
                  type="radio"
                  name="export_scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="text-primary focus:ring-primary border-panel-border bg-surface"
                />
                <span className="font-code text-xs text-on-surface-variant">
                  {totalCount}
                </span>
              </div>
              <span className="font-label-md text-label-md text-on-surface font-medium mt-1">
                Tất cả
              </span>
              <span className="font-label-xs text-[10px] text-on-surface-variant">
                Toàn bộ dữ liệu
              </span>
            </label>

            <label
              className={`flex flex-col gap-1 p-sm rounded border cursor-pointer transition-colors ${
                scope === 'checked'
                  ? 'border-primary bg-primary/10'
                  : 'border-panel-border hover:border-outline bg-surface'
              } ${checkedCount === 0 ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <div className="flex items-center justify-between">
                <input
                  type="radio"
                  name="export_scope"
                  checked={scope === 'checked'}
                  onChange={() => setScope('checked')}
                  disabled={checkedCount === 0}
                  className="text-primary focus:ring-primary border-panel-border bg-surface"
                />
                <span className="font-code text-xs text-on-surface-variant">
                  {checkedCount}
                </span>
              </div>
              <span className="font-label-md text-label-md text-on-surface font-medium mt-1">
                Đã chọn
              </span>
              <span className="font-label-xs text-[10px] text-on-surface-variant">
                Mục có tích chọn
              </span>
            </label>

            <label
              className={`flex flex-col gap-1 p-sm rounded border cursor-pointer transition-colors ${
                scope === 'filtered'
                  ? 'border-primary bg-primary/10'
                  : 'border-panel-border hover:border-outline bg-surface'
              } ${filteredCount === 0 ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <div className="flex items-center justify-between">
                <input
                  type="radio"
                  name="export_scope"
                  checked={scope === 'filtered'}
                  onChange={() => setScope('filtered')}
                  disabled={filteredCount === 0}
                  className="text-primary focus:ring-primary border-panel-border bg-surface"
                />
                <span className="font-code text-xs text-on-surface-variant">
                  {filteredCount}
                </span>
              </div>
              <span className="font-label-md text-label-md text-on-surface font-medium mt-1">
                Đang lọc
              </span>
              <span className="font-label-xs text-[10px] text-on-surface-variant">
                Theo bộ lọc hiện tại
              </span>
            </label>
          </div>
        </div>

        {/* Format Selection */}
        <div className="space-y-sm">
          <label className="font-label-xs text-label-xs text-on-surface-variant uppercase font-semibold">
            2. Định dạng file (Format)
          </label>
          <div className="grid grid-cols-3 gap-sm">
            {(['TXT', 'CSV', 'XLSX'] as ExportFormat[]).map((fmt) => (
              <label
                key={fmt}
                className={`flex items-center gap-2 p-sm rounded border cursor-pointer transition-colors ${
                  format === fmt
                    ? 'border-primary bg-primary/10'
                    : 'border-panel-border hover:border-outline bg-surface'
                }`}
              >
                <input
                  type="radio"
                  name="export_format"
                  checked={format === fmt}
                  onChange={() => setFormat(fmt)}
                  className="text-primary focus:ring-primary border-panel-border bg-surface"
                />
                {getFormatIcon(fmt)}
                <span className="font-body-sm text-body-sm text-on-surface font-medium">
                  {fmt}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Export Fields Preview (read from Export Settings) */}
        <div className="space-y-sm">
          <div className="flex items-center justify-between">
            <label className="font-label-xs text-label-xs text-on-surface-variant uppercase font-semibold">
              3. Cột xuất (Theo Cài đặt xuất)
            </label>
            <span className="font-label-xs text-[10px] text-on-surface-variant">
              {orderedFields.length} trường
            </span>
          </div>

          <div className="p-sm bg-surface-container-low border border-panel-border rounded flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
            {orderedFields.map((field, idx) => (
              <span
                key={field}
                className="px-2 py-0.5 rounded bg-surface border border-panel-border font-code text-[11px] text-on-surface flex items-center gap-1"
              >
                <span className="text-on-surface-variant">{idx + 1}.</span>
                <span>{EXPORT_FIELD_HEADERS[field]}</span>
              </span>
            ))}
          </div>

          {orderedFields.length === 0 && (
            <p className="font-body-sm text-body-sm text-warning">
              Chưa chọn cột nào trong Cài đặt → Xuất dữ liệu, nên chưa xuất được.
            </p>
          )}
        </div>

        {status && (
          <p
            className={`font-body-sm text-body-sm break-all ${status.ok ? 'text-success' : 'text-error'}`}
            role="status"
          >
            {status.text}
          </p>
        )}
      </div>
    </Modal>
  );
};
