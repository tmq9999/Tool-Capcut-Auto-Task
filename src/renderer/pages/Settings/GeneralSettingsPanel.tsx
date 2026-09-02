import React from 'react';
import { Sliders } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { SegmentedControl } from '@renderer/components/ui/SegmentedControl';
import { Select } from '@renderer/components/ui/Select';
import { Switch } from '@renderer/components/ui/Switch';
import type { GeneralSettingsDTO } from '@shared/schemas/settings.schema';

export interface GeneralSettingsPanelProps {
  settings: GeneralSettingsDTO;
  onChange: (settings: GeneralSettingsDTO) => void;
}

export const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({
  settings,
  onChange,
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
              { value: 'light', label: 'Light' },
            ]}
            value={settings.theme}
            onChange={(val) => onChange({ ...settings, theme: val as GeneralSettingsDTO['theme'] })}
            size="md"
          />
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
            <option value="en">English</option>
          </Select>
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
                Tải lại trạng thái trước khi tắt ứng dụng
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
