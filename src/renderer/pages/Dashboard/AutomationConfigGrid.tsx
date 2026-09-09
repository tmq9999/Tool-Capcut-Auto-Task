import React from 'react';
import {
  Sliders,
  Timer,
  Globe,
  CreditCard,
  Mail,
  KeyRound,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { Textarea } from '@renderer/components/ui/Textarea';
import { SegmentedControl } from '@renderer/components/ui/SegmentedControl';
import { NumberStepper } from '@renderer/components/ui/NumberStepper';
import { isBrowserImplemented } from '../../../shared/schemas/automation.schema';
import { clampConfigNumber } from './automationConfig';
import { Checkbox } from '@renderer/components/ui/Checkbox';
import type { EmailApiProvider, EmailProviderConfigDTO } from '@shared/schemas/provider.schema';
import type { CustomEmailSettingsDTO } from '@shared/schemas/settings.schema';
import type { BrowserRuntime } from '@shared/schemas/automation.schema';
import type { AutomationConfigState } from './automationConfig';

export interface AutomationConfigGridProps {
  config: AutomationConfigState;
  onChange: (patch: Partial<AutomationConfigState>) => void;
  emailProviders: EmailProviderConfigDTO[];
  customEmail: CustomEmailSettingsDTO;
  disabled?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const BROWSER_OPTIONS: Array<{ value: BrowserRuntime; label: string }> = [
  { value: 'multilogin', label: 'Multilogin' },
  { value: 'gologin', label: 'GoLogin' },
  { value: 'gpm', label: 'GPM Login' },
  { value: 'camoufox', label: 'Camoufox' },
  { value: 'patchright', label: 'Patchright' },
];

const LINE_BREAK = String.fromCharCode(10);

const EMAIL_PROVIDER_LABEL: Record<EmailApiProvider, string> = {
  gmail94: 'Gmail94',
  dongvanfb: 'DongVanFB',
};

export const AutomationConfigGrid: React.FC<AutomationConfigGridProps> = ({
  config,
  onChange,
  emailProviders,
  customEmail,
  disabled = false,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const selectedEmailProvider = emailProviders.find(
    (entry) => entry.provider === config.emailApiProvider
  );

  const proxyKeyCount = config.proxyKeyList
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

  const directProxyCount = config.proxyList
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      {onToggleCollapse && (
        <div className="flex items-center justify-between px-1">
          <span className="font-label-xs text-[11px] text-on-surface-variant font-semibold uppercase tracking-wider">
            Cấu hình kịch bản tự động
          </span>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex items-center gap-1 font-label-xs text-[11px] text-primary hover:text-primary-hover transition-colors cursor-pointer"
          >
            <span>{isCollapsed ? 'Mở rộng cấu hình' : 'Thu gọn cấu hình'}</span>
            {isCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {!isCollapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* Panel 1: Cấu hình chung */}
          <Panel
            title="Cấu hình chung"
            icon={<Sliders className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Số luồng song song</label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={config.threadCount}
                    onChange={(e) =>
                      onChange({ threadCount: clampConfigNumber(e.target.value, 1, 200, config.threadCount) })
                    }
                    controlSize="sm"
                    disabled={disabled}
                    fontMono
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Trình duyệt</label>
                  <Select
                    controlSize="sm"
                    value={config.browser}
                    disabled={disabled}
                    onChange={(e) => onChange({ browser: e.target.value as BrowserRuntime })}
                  >
                    {BROWSER_OPTIONS.map((option) => {
                      const ready = isBrowserImplemented(option.value);
                      return (
                        <option key={option.value} value={option.value} disabled={!ready}>
                          {option.label}{ready ? '' : ' (chưa hỗ trợ)'}
                        </option>
                      );
                    })}
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Giới hạn mail</label>
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    placeholder="0 = không giới hạn"
                    value={config.mailLimit}
                    onChange={(e) => onChange({ mailLimit: clampConfigNumber(e.target.value, 0, 200, config.mailLimit) })}
                    controlSize="sm"
                    disabled={disabled}
                    fontMono
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="purchase-budget" className="font-label-xs text-[11px] text-on-surface-variant font-medium">Giới hạn mua mới</label>
                  <Input
                    id="purchase-budget"
                    type="number"
                    min={0}
                    max={200}
                    placeholder="0 = chỉ dùng mail sẵn"
                    value={config.maxBillablePurchases}
                    onChange={(e) => onChange({ maxBillablePurchases: clampConfigNumber(e.target.value, 0, 200, config.maxBillablePurchases) })}
                    controlSize="sm"
                    disabled={disabled || config.emailSourceMode !== 'api'}
                    fontMono
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-panel-border/50">
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Hiển thị trình duyệt</label>
                  <SegmentedControl
                    options={[
                      { value: 'headed', label: 'Headed (Hiện)' },
                      { value: 'headless', label: 'Headless (Ẩn)' },
                    ]}
                    value={config.headless ? 'headless' : 'headed'}
                    onChange={(value) => onChange({ headless: value === 'headless' })}
                    size="sm"
                    disabled={disabled}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Số lần thử lại</label>
                  <div className="flex items-center justify-between h-8">
                    <span className="text-xs text-on-surface-variant">Thất bại thử lại:</span>
                    <NumberStepper
                      value={config.retryCount}
                      onChange={(value) => onChange({ retryCount: value })}
                      min={0}
                      max={10}
                      controlSize="sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* Panel 2: Proxy Settings */}
          <Panel
            title="Proxy Settings"
            icon={<Globe className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1 flex-1 flex flex-col">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Chế độ Proxy</label>
                  <Select
                    controlSize="sm"
                    value={config.proxyMode}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyMode: e.target.value as 'direct' | 'proxykey' })}
                  >
                    <option value="direct">Direct IP (Proxy tĩnh)</option>
                    <option value="proxykey">Proxy Key (KiotProxy)</option>
                  </Select>
                </div>

                {config.proxyMode === 'proxykey' ? (
                  <div className="flex flex-col gap-1">
                    <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Vùng IP (Region)</label>
                    <Select
                      controlSize="sm"
                      value={config.proxyRegion}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange({ proxyRegion: e.target.value as AutomationConfigState['proxyRegion'] })
                      }
                    >
                      <option value="random">Ngẫu nhiên (Tự động)</option>
                      <option value="bac">Miền Bắc</option>
                      <option value="trung">Miền Trung</option>
                      <option value="nam">Miền Nam</option>
                    </Select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Cấu trúc chuẩn</label>
                    <div
                      className="h-8 flex items-center px-2 rounded bg-surface-container-low border border-panel-border text-[11px] text-primary font-mono truncate"
                      title="http://ip:port hoặc socks5://ip:port (tùy chọn user:pass)"
                    >
                      scheme://ip:port[:user:pass]
                    </div>
                  </div>
                )}
              </div>

              {config.proxyMode === 'proxykey' ? (
                <div className="flex-1 flex flex-col gap-1">
                  <Textarea
                    placeholder="Nhập danh sách Proxy Key (mỗi dòng một key)..."
                    value={config.proxyKeyList}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyKeyList: e.target.value })}
                    className="h-28 min-h-[110px] py-1.5 text-xs font-mono resize-y"
                    rows={5}
                  />
                  <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant leading-snug">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>
                      {proxyKeyCount > 0
                        ? `Đã nạp ${proxyKeyCount} key, tối đa ${proxyKeyCount} luồng song song.`
                        : 'Để trống = sử dụng toàn bộ key có sẵn trong tài khoản KiotProxy.'}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1 flex-1">
                  <Textarea
                    placeholder={"Mỗi dòng một proxy (HTTP hoặc SOCKS5). Ví dụ:\nhttp://1.2.3.4:8080\nsocks5://1.2.3.4:1080\nhttp://1.2.3.4:8080:user:pass\nsocks5://user:pass@1.2.3.4:1080"}
                    value={config.proxyList}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyList: e.target.value })}
                    className="h-28 min-h-[110px] py-1.5 text-xs font-mono resize-y"
                    rows={5}
                  />
                  <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant leading-snug">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>
                      {directProxyCount > 0
                        ? `Đã nạp ${directProxyCount} proxy tĩnh (HTTP/SOCKS5), tối đa ${directProxyCount} luồng song song.`
                        : 'Hỗ trợ: http://ip:port hoặc socks5://ip:port (tùy chọn user:pass).'}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </Panel>

          {/* Panel 3: Nguồn Email */}
          <Panel
            title="Nguồn Email"
            icon={<Mail className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1 flex-1 flex flex-col">
              <SegmentedControl
                options={[
                  { value: 'api', label: 'API Thuê Mail' },
                  { value: 'manual', label: 'Dán thủ công' },
                  { value: 'custom', label: 'Custom (Đã khóa)', disabled: true },
                ]}
                value={config.emailSourceMode === 'custom' ? 'api' : config.emailSourceMode}
                onChange={(value) => onChange({ emailSourceMode: value })}
                size="sm"
                disabled={disabled}
              />

              {config.emailSourceMode === 'custom' ? (
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="rounded border border-panel-border bg-surface-container-low p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-on-surface-variant">Domain</span>
                      <span className="font-code text-xs text-primary">@{customEmail.domain}</span>
                    </div>
                    <span className="text-[10px] text-on-surface-variant leading-snug block mt-1">
                      {'Duy trì tối đa ' + config.threadCount + ' luồng; mỗi luồng tự sinh địa chỉ mới khi sẵn sàng.'}
                    </span>
                  </div>
                  <span className="text-[10px] text-on-surface-variant leading-snug">
                    Đọc OTP từ mail có người gửi chứa
                    <span className="font-code text-on-surface"> {customEmail.senderFilter}</span>.
                    Đổi domain hoặc API trong Settings.
                  </span>
                </div>
              ) : config.emailSourceMode === 'api' ? (
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Nhà cung cấp Email</label>
                    <Select
                      controlSize="sm"
                      value={config.emailApiProvider}
                      disabled={disabled}
                      onChange={(e) => onChange({ emailApiProvider: e.target.value as EmailApiProvider })}
                    >
                      {emailProviders.map((entry) => (
                        <option key={entry.provider} value={entry.provider}>
                          {EMAIL_PROVIDER_LABEL[entry.provider]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">Chờ nạp lại khi hết email</label>
                    <Select
                      controlSize="sm"
                      value={config.emailRetryIntervalSeconds}
                      disabled={disabled}
                      onChange={(e) => onChange({ emailRetryIntervalSeconds: Number(e.target.value) })}
                    >
                      <option value={10}>10 giây</option>
                      <option value={15}>15 giây (Khuyên dùng)</option>
                      <option value={30}>30 giây</option>
                      <option value={60}>60 giây</option>
                    </Select>
                  </div>

                  {selectedEmailProvider?.isConfigured ? (
                    <div className="rounded border border-panel-border bg-surface-container-low p-2 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] text-on-surface-variant">API Key:</span>
                        <span className="font-code text-xs text-primary tracking-wider font-semibold">
                          {selectedEmailProvider.maskedHint}
                        </span>
                      </div>
                      <span className="text-[10px] text-on-surface-variant leading-relaxed">
                        {'Duy trì tối đa ' + config.threadCount + ' luồng; chỉ lấy 1 email khi luồng đã có proxy và sẵn sàng.'}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded border border-warning/30 bg-warning/10 p-2 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                      <span className="text-[11px] text-warning leading-snug">
                        Chưa cấu hình API key trong mục Cài đặt.
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1 flex-1">
                  <Textarea
                    placeholder="Nhập email|password (mỗi dòng một tài khoản)..."
                    value={config.emailList}
                    disabled={disabled}
                    onChange={(e) => onChange({ emailList: e.target.value })}
                    className="h-28 min-h-[110px] py-1.5 text-xs font-mono resize-y"
                    rows={5}
                  />
                  <span className="text-[10px] text-on-surface-variant leading-snug">
                    {'Xử lý mọi dòng hợp lệ, tối đa ' + config.threadCount + ' dòng cùng lúc.'}
                  </span>
                </div>
              )}
            </div>
          </Panel>

          {/* Panel 4: Module */}
          <Panel
            title="Module kịch bản"
            icon={<CreditCard className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2.5 mt-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([
                  { value: 'credit', label: 'Làm NV Credit', ready: true },
                  { value: 'trial', label: 'Pay Trial 7D', ready: false },
                  { value: 'team', label: 'Pay Team', ready: false },
                ] as const).map((option) => (
                  <label
                    key={option.value}
                    title={option.ready ? undefined : 'Chưa hỗ trợ'}
                    className={`flex items-center gap-2 p-2 border rounded transition-colors ${
                      option.ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                    } ${
                      config.module === option.value
                        ? 'border-primary bg-primary/10'
                        : 'border-panel-border hover:border-outline'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment_module"
                      checked={config.module === option.value}
                      disabled={disabled || !option.ready}
                      onChange={() => onChange({ module: option.value })}
                      className="w-3.5 h-3.5 text-primary focus:ring-primary border-panel-border bg-surface"
                    />
                    <span className="font-body-sm text-xs text-on-surface font-medium">
                      {option.label}
                      {option.ready ? '' : ' (chưa hỗ trợ)'}
                    </span>
                  </label>
                ))}
              </div>

              <label
                className={`flex items-center gap-2.5 p-2 rounded border border-panel-border bg-surface-container-low/50 ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-outline'
                }`}
              >
                <input
                  type="checkbox"
                  checked={config.skipWithoutTrial}
                  disabled={disabled}
                  onChange={(e) => onChange({ skipWithoutTrial: e.target.checked })}
                  className="w-4 h-4 text-primary focus:ring-primary border-panel-border bg-surface rounded"
                />
                <span className="font-label-xs text-xs text-on-surface leading-snug">
                  Bỏ qua tài khoản nếu không có gói dùng thử Pro trial ≥ 7 ngày
                </span>
              </label>
            </div>
          </Panel>

          {/* Panel 5: Delay & Timing */}
          <Panel
            title="Delay & Timing"
            icon={<Timer className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1">
              <div className="flex flex-col gap-1">
                <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">
                  Delay thao tác giữa các bước (ms)
                </label>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-on-surface-variant shrink-0 w-8">Min:</span>
                    <Input
                      type="number"
                      min={0}
                      max={600000}
                      placeholder="Min"
                      value={config.stepDelayMinMs}
                      onChange={(e) =>
                        onChange({ stepDelayMinMs: clampConfigNumber(e.target.value, 0, 600000, config.stepDelayMinMs) })
                      }
                      controlSize="sm"
                      disabled={disabled}
                      fontMono
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-on-surface-variant shrink-0 w-8">Max:</span>
                    <Input
                      type="number"
                      min={0}
                      max={600000}
                      placeholder="Max"
                      value={config.stepDelayMaxMs}
                      onChange={(e) =>
                        onChange({ stepDelayMaxMs: clampConfigNumber(e.target.value, 0, 600000, config.stepDelayMaxMs) })
                      }
                      controlSize="sm"
                      disabled={disabled}
                      fontMono
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-xs text-[11px] text-on-surface-variant font-medium">
                  Delay gõ phím mô phỏng người thật (ms)
                </label>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-on-surface-variant shrink-0 w-8">Min:</span>
                    <Input
                      type="number"
                      min={0}
                      max={60000}
                      placeholder="Min"
                      value={config.typeDelayMinMs}
                      onChange={(e) =>
                        onChange({ typeDelayMinMs: clampConfigNumber(e.target.value, 0, 60000, config.typeDelayMinMs) })
                      }
                      controlSize="sm"
                      disabled={disabled}
                      fontMono
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-on-surface-variant shrink-0 w-8">Max:</span>
                    <Input
                      type="number"
                      min={0}
                      max={60000}
                      placeholder="Max"
                      value={config.typeDelayMaxMs}
                      onChange={(e) =>
                        onChange({ typeDelayMaxMs: clampConfigNumber(e.target.value, 0, 60000, config.typeDelayMaxMs) })
                      }
                      controlSize="sm"
                      disabled={disabled}
                      fontMono
                    />
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* Panel 6: Mật khẩu CapCut */}
          <Panel
            title="Mật khẩu CapCut"
            icon={<KeyRound className="w-4 h-4 text-primary" />}
            className="p-3 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="pw_mode"
                      checked={config.passwordMode === 'custom'}
                      disabled={disabled}
                      onChange={() => onChange({ passwordMode: 'custom' })}
                      className="w-3.5 h-3.5 text-primary"
                    />
                    <span className="text-xs text-on-surface font-medium">Tự đặt</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="pw_mode"
                      checked={config.passwordMode === 'random'}
                      disabled={disabled}
                      onChange={() => onChange({ passwordMode: 'random' })}
                      className="w-3.5 h-3.5 text-primary"
                    />
                    <span className="text-xs text-on-surface font-medium">Ngẫu nhiên (Random)</span>
                  </label>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-label-xs text-[11px] text-on-surface-variant">Độ dài:</span>
                  <Input
                    type="number"
                    min={6}
                    max={64}
                    value={config.passwordLength}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({ passwordLength: clampConfigNumber(e.target.value, 6, 64, config.passwordLength) })
                    }
                    controlSize="sm"
                    className="w-14 text-center py-0.5 h-7 text-xs font-semibold"
                    fontMono
                  />
                </div>
              </div>

              {config.passwordMode === 'custom' ? (
                <Input
                  type="text"
                  placeholder="Mật khẩu dùng chung cho mọi tài khoản..."
                  value={config.customPassword}
                  disabled={disabled}
                  onChange={(e) => onChange({ customPassword: e.target.value })}
                  controlSize="sm"
                  fontMono
                />
              ) : (
                <div className="grid grid-cols-3 gap-2 p-2 bg-surface-container-low rounded border border-panel-border text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={config.includeUppercase}
                      disabled={disabled}
                      onChange={(e) => onChange({ includeUppercase: e.target.checked })}
                    />
                    <span className="text-on-surface-variant text-[11px]">A-Z (Hoa)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={config.includeNumbers}
                      disabled={disabled}
                      onChange={(e) => onChange({ includeNumbers: e.target.checked })}
                    />
                    <span className="text-on-surface-variant text-[11px]">0-9 (Số)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={config.includeSpecial}
                      disabled={disabled}
                      onChange={(e) => onChange({ includeSpecial: e.target.checked })}
                    />
                    <span className="text-on-surface-variant text-[11px]">!@# (Ký tự)</span>
                  </label>
                </div>
              )}
            </div>
          </Panel>
        </div>

      )}
    </div>
  );
};
