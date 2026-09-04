import React from 'react';
import { Sliders } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { SegmentedControl } from '@renderer/components/ui/SegmentedControl';
import { Select } from '@renderer/components/ui/Select';
import { Switch } from '@renderer/components/ui/Switch';
import type { GeneralSettingsDTO, LogSettingsDTO } from '@shared/schemas/settings.schema';

export interface GeneralSettingsPanelProps {
  settings: GeneralSettingsDTO;
  onChange: (settings: GeneralSettingsDTO) => void;
  logs: LogSettingsDTO;
  onLogsChange: (logs: LogSettingsDTO) => void;
}

export const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({
  settings,
  onChange,
  logs,
  onLogsChange,
}) => {
  return (
    <Panel
      title="CÀI ĐẶT CHUNG"
      icon={<Sliders className="w-4 h-4" />}
      className="h-full"
    >
      <div className="space-y-lg mt-sm">
        {/* Theme Selector */}
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Giao diện (Theme)
          </label>
          <SegmentedControl
            options={[
              { value: 'dark', label: 'Dark Mode (Mặc định)' },
              { value: 'light', label: 'Light (chưa có bảng màu)', disabled: true },
            ]}
            value={settings.theme}
            onChange={(val) => onChange({ ...settings, theme: val as GeneralSettingsDTO['theme'] })}
            size="md"
          />
          {/*
            Ô này giờ ĐIỀU KHIỂN THẬT class `dark` ở `<html>` (xem
            `app/appPreferences.ts`) — trước đây `index.html` hard-code nên chọn gì
            cũng như nhau. `Light` khoá lại vì bảng màu trong `tailwind.config.ts`
            chỉ có một bộ tối, bỏ class `dark` là chữ đen trên nền đen.
          */}
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            Bảng màu sáng chưa được thiết kế nên tạm khoá.
          </p>
        </div>

        {/* Language Selector */}
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Ngôn ngữ (Language)
          </label>
          <Select
            value={settings.language}
            onChange={(e) =>
              onChange({ ...settings, language: e.target.value as GeneralSettingsDTO['language'] })
            }
          >
            <option value="vi">Tiếng Việt (Mặc định)</option>
            <option value="en" disabled>English (chưa dịch)</option>
          </Select>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            Toàn bộ chữ trong app đang là tiếng Việt; bản tiếng Anh chưa dịch.
          </p>
        </div>

        {/* Log Retention — AGENTS §18 */}
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Giữ nhật ký (Log retention)
          </label>
          <Select
            value={logs.retention}
            onChange={(e) =>
              onLogsChange({ ...logs, retention: e.target.value as LogSettingsDTO['retention'] })
            }
          >
            <option value="7">7 ngày</option>
            <option value="30">30 ngày (Mặc định)</option>
            <option value="90">90 ngày</option>
            <option value="never">Không tự xoá</option>
          </Select>
          {/*
            AGENTS §18 yêu cầu dọn log theo hạn; `runLogRetentionCleanup` chạy lúc
            mở app nhưng trước đây KHÔNG có ô nào để đổi hạn — cài đặt lưu xuống DB
            mà người dùng không sờ tới được (audit 04/09/2026).
          */}
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            Log quá hạn được dọn mỗi lần mở app.
          </p>
        </div>

        {/* Toggles */}
        <div className="space-y-md pt-md border-t border-panel-border">
          <div className="flex justify-between items-center">
            <div>
              <span className="font-body-sm text-body-sm text-on-surface block font-medium">
                Tự động lưu cấu hình
              </span>
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                Lưu tham số ngay khi thay đổi
              </span>
            </div>
            <Switch
              checked={settings.autoSaveConfig}
              onChange={(checked) => onChange({ ...settings, autoSaveConfig: checked })}
            />
          </div>

          <div className="flex justify-between items-center">
            <div>
              <span className="font-body-sm text-body-sm text-on-surface block font-medium">
                Khôi phục phiên làm việc
              </span>
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                Mở lại đúng trang đang xem trước khi tắt
              </span>
            </div>
            <Switch
              checked={settings.sessionRestore}
              onChange={(checked) => onChange({ ...settings, sessionRestore: checked })}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
};
