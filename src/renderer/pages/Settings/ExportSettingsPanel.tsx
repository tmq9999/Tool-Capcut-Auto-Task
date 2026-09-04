import React from 'react';
import { Download } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { Select } from '@renderer/components/ui/Select';
import { Checkbox } from '@renderer/components/ui/Checkbox';
import type { ExportSettingsDTO, ExportField } from '@shared/schemas/settings.schema';
import {
  CANONICAL_EXPORT_FIELD_ORDER,
  EXPORT_FIELD_HEADERS
} from '@shared/schemas/account-export.schema';

export interface ExportSettingsPanelProps {
  settings: ExportSettingsDTO;
  onChange: (settings: ExportSettingsDTO) => void;
}

/** Nhãn cột lấy từ contract dùng chung, để Settings và file xuất không lệch chữ. */
const FIELD_LABELS = EXPORT_FIELD_HEADERS;

const SAMPLE_VALUES: Record<ExportField, string[]> = {
  email: ['john.doe@gmail.com', 'jane.smith@yahoo.com'],
  passwordCapcut: ['P@ssw0rd123', 'SecurePwd!99'],
  emailData: ['session_token_89x', 'session_token_21y'],
  credit: ['120', '50'],
  subscription: ['Pro 1Y', 'Trial 7D'],
  createdAt: ['2026-09-01 14:30:00', '2026-09-01 15:12:45'],
};

export const ExportSettingsPanel: React.FC<ExportSettingsPanelProps> = ({
  settings,
  onChange,
}) => {
  const handleToggleField = (field: ExportField) => {
    const isChecked = settings.checkedFields.includes(field);
    let newFields: ExportField[];

    if (isChecked) {
      // Uncheck
      newFields = settings.checkedFields.filter((f) => f !== field);
    } else {
      // Check and add to end of selected order
      newFields = [...settings.checkedFields, field];
    }

    onChange({
      ...settings,
      checkedFields: newFields,
    });
  };

  /**
   * Ký tự ngăn cột trong ô xem trước.
   *
   * XLSX/CSV KHÔNG dùng `|` — chỉ TXT (AGENTS §21). Bản cũ vẽ XLSX bằng `|` nên
   * xem trước hứa một thứ mà file thật ra thứ khác; `│` (vạch kẻ) để người dùng
   * hiểu đó là ranh giới ô, không phải ký tự có trong file.
   */
  const getDelimiter = () => {
    switch (settings.defaultFormat) {
      case 'csv':
        return ',';
      case 'xlsx':
        return ' │ ';
      case 'txt':
      default:
        return '|';
    }
  };

  const delimiter = getDelimiter();

  /**
   * Xem trước theo ĐÚNG thứ tự §21, không theo thứ tự người dùng bấm chọn: file
   * xuất ra do `CANONICAL_EXPORT_FIELD_ORDER` quyết định, xem trước phải khớp.
   */
  const previewFields = CANONICAL_EXPORT_FIELD_ORDER.filter((f) =>
    settings.checkedFields.includes(f)
  );

  const headerPreview = previewFields
    .map((f) => FIELD_LABELS[f] ?? f)
    .join(delimiter);
  const row1Preview = previewFields
    .map((f) => SAMPLE_VALUES[f]?.[0] || '...')
    .join(delimiter);
  const row2Preview = previewFields
    .map((f) => SAMPLE_VALUES[f]?.[1] || '...')
    .join(delimiter);

  return (
    <Panel
      title="XUẤT DỮ LIỆU (EXPORT SETTINGS)"
      icon={<Download className="w-4 h-4" />}
    >
      <div className="grid grid-cols-12 gap-lg mt-sm">
        {/* Left Form: Format & Fields */}
        <div className="col-span-12 md:col-span-4 space-y-md">
          <div className="space-y-1">
            <label className="block font-label-md text-label-md text-on-surface-variant">
              Định dạng xuất mặc định (Format)
            </label>
            <Select
              value={settings.defaultFormat}
              onChange={(e) =>
                onChange({
                  ...settings,
                  defaultFormat: e.target.value as ExportSettingsDTO['defaultFormat'],
                })
              }
            >
              <option value="txt">TXT (Dấu gạch đứng |)</option>
              <option value="csv">CSV (Dấu phẩy ,)</option>
              <option value="xlsx">XLSX (Bảng tính Excel)</option>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block font-label-md text-label-md text-on-surface-variant">
                Các trường dữ liệu xuất (Order)
              </label>
              <span className="font-label-xs text-[10px] text-on-surface-variant">
                {settings.checkedFields.length} đã chọn
              </span>
            </div>

            <div className="space-y-1 bg-surface-container-low p-sm rounded border border-panel-border max-h-[190px] overflow-y-auto custom-scrollbar select-none">
              {settings.availableFields.map((field) => {
                const isChecked = settings.checkedFields.includes(field);
                const orderIndex = settings.checkedFields.indexOf(field);

                return (
                  <label
                    key={field}
                    className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-high cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isChecked}
                        onChange={() => handleToggleField(field)}
                      />
                      <span className="font-body-sm text-body-sm text-on-surface">
                        {FIELD_LABELS[field] ?? field}
                      </span>
                    </div>

                    {isChecked && (
                      <span className="font-code text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 font-semibold">
                        #{orderIndex + 1}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Preview Box */}
        <div className="col-span-12 md:col-span-8 flex flex-col">
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Xem trước cấu trúc file xuất ({settings.defaultFormat.toUpperCase()})
          </label>
          <div className="flex-1 p-md bg-surface-container-lowest border border-panel-border rounded font-mono text-xs text-on-surface-variant overflow-x-auto custom-scrollbar flex flex-col justify-center space-y-2">
            <div className="text-on-surface font-semibold whitespace-nowrap">
              {headerPreview || '<Chưa chọn trường nào>'}
            </div>
            <div className="whitespace-nowrap text-on-surface-variant/70 border-t border-panel-border/30 pt-1.5">
              {row1Preview || '...'}
            </div>
            <div className="whitespace-nowrap text-on-surface-variant/50">
              {row2Preview || '...'}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
};
