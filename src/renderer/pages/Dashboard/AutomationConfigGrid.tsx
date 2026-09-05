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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2.5">
          {/* Panel 1: Cấu hình chung */}
          <Panel
            title="Cấu hình chung"
            icon={<Sliders className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-1.5 mt-1">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <label className="font-label-xs text-[10px] text-on-surface-variant">Luồng</label>
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

                <div className="flex flex-col gap-0.5">
                  <label className="font-label-xs text-[10px] text-on-surface-variant">Browser</label>
                  <Select
                    controlSize="sm"
                    value={config.browser}
                    disabled={disabled}
                    onChange={(e) => onChange({ browser: e.target.value as BrowserRuntime })}
                  >
                    {BROWSER_OPTIONS.map((option) => {
                      /**
                       * Khoá browser chưa có implementation, đúng khuôn `module`
                       * trial/team ở dưới. Trước 04/09/2026 dropdown cho chọn cả
                       * 5 trong khi chỉ Multilogin có provider + launcher, mà
                       * `start()` lại MUA EMAIL trước khi mở browser — chọn nhầm
                       * là mất tiền rồi mới báo lỗi.
                       */
                      const ready = isBrowserImplemented(option.value);
                      return (
                        <option key={option.value} value={option.value} disabled={!ready}>
                          {option.label}{ready ? '' : ' (chưa hỗ trợ)'}
                        </option>
                      );
                    })}
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="font-label-xs text-[10px] text-on-surface-variant">Mode</label>
                <SegmentedControl
                  options={[
                    { value: 'headed', label: 'Headed' },
                    { value: 'headless', label: 'Headless' },
                  ]}
                  value={config.headless ? 'headless' : 'headed'}
                  onChange={(value) => onChange({ headless: value === 'headless' })}
                  size="sm"
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <span className="font-label-xs text-[10px] text-on-surface-variant">Thử lại (lần)</span>
                <NumberStepper
                  value={config.retryCount}
                  onChange={(value) => onChange({ retryCount: value })}
                  min={0}
                  max={10}
                  controlSize="sm"
                />
              </div>
            </div>
          </Panel>

          {/* Panel 2: Delay & Timing */}
          <Panel
            title="Delay & Timing"
            icon={<Timer className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-2 mt-1">
              <div className="flex flex-col gap-0.5">
                <label className="font-label-xs text-[10px] text-on-surface-variant">
                  Delay thao tác (ms)
                </label>
                <div className="flex items-center gap-1">
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
                  <span className="text-on-surface-variant text-xs">-</span>
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

              <div className="flex flex-col gap-0.5">
                <label className="font-label-xs text-[10px] text-on-surface-variant">
                  Delay gõ phím (ms)
                </label>
                <div className="flex items-center gap-1">
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
                  <span className="text-on-surface-variant text-xs">-</span>
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
          </Panel>

          {/* Panel 3: Proxy Settings */}
          <Panel
            title="Proxy Settings"
            icon={<Globe className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-1.5 mt-1 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <label className="font-label-xs text-[10px] text-on-surface-variant">Mode</label>
                <div className="w-28">
                  <Select
                    controlSize="sm"
                    value={config.proxyMode}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyMode: e.target.value as 'direct' | 'proxykey' })}
                  >
                    <option value="direct">Direct IP</option>
                    <option value="proxykey">Proxy Key</option>
                  </Select>
                </div>
              </div>

              {config.proxyMode === 'proxykey' ? (
                <div className="flex-1 flex flex-col gap-0.5">
                  {/*
                    Vùng chỉ có nghĩa với proxy key: KiotProxy cấp IP theo vùng
                    (`bac`/`trung`/`nam`), còn proxy dán tay `http://ip:port` thì IP
                    đã cố định. `random` = không gửi khoá vùng, để KiotProxy tự chọn.
                  */}
                  <div className="flex items-center justify-between">
                    <label className="font-label-xs text-[10px] text-on-surface-variant">Vùng</label>
                    <div className="w-28">
                      <Select
                        controlSize="sm"
                        value={config.proxyRegion}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange({ proxyRegion: e.target.value as AutomationConfigState['proxyRegion'] })
                        }
                      >
                        <option value="random">Ngẫu nhiên</option>
                        <option value="bac">Miền Bắc</option>
                        <option value="trung">Miền Trung</option>
                        <option value="nam">Miền Nam</option>
                      </Select>
                    </div>
                  </div>
                  <Textarea
                    placeholder="Mỗi dòng một proxy key..."
                    value={config.proxyKeyList}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyKeyList: e.target.value })}
                    className="h-[38px] min-h-[38px] py-1 text-[11px]"
                  />
                  <span className="flex items-start gap-1 text-[10px] text-on-surface-variant leading-snug">
                    <ShieldCheck className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                    <span>
                      {proxyKeyCount > 0
                        ? 'Chỉ dùng ' + proxyKeyCount + ' key này, tối đa ' + proxyKeyCount + ' luồng song song.'
                        : 'Để trống = dùng toàn bộ key trong tài khoản.'}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 flex-1">
                  <Textarea
                    placeholder="IP:PORT:USER:PASS"
                    value={config.proxyList}
                    disabled={disabled}
                    onChange={(e) => onChange({ proxyList: e.target.value })}
                    className="h-[52px] min-h-[52px] py-1 text-[11px]"
                  />
                </div>
              )}
            </div>
          </Panel>

          {/* Panel 4: Module */}
          <Panel
            title="Module"
            icon={<CreditCard className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-1.5 mt-1">
              {/*
                Chỉ `credit` có engine thật (đăng ký/đăng nhập + làm 12 nhiệm vụ).
                `trial` và `team` chưa implement — khoá lại thay vì cho chọn rồi
                im lặng không làm gì, giống cách browser chưa hỗ trợ báo lỗi rõ.
              */}
              {([
                { value: 'credit', label: 'Làm NV Credit', ready: true },
                { value: 'trial', label: 'Pay Trial 7D', ready: false },
                { value: 'team', label: 'Pay Team', ready: false },
              ] as const).map((option) => (
                <label
                  key={option.value}
                  title={option.ready ? undefined : 'Chưa hỗ trợ'}
                  className={`flex items-center gap-2 p-1.5 border rounded transition-colors ${
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
                  <span className="font-body-sm text-body-sm text-on-surface">
                    {option.label}
                    {option.ready ? '' : ' (chưa hỗ trợ)'}
                  </span>
                </label>
              ))}

              {/*
                Cổng trial đọc bằng selector và CỐ Ý fail-open: đọc không được thì
                coi như đủ điều kiện. Bật ô này là chấp nhận bỏ qua account — mỗi
                account bỏ qua là một hộp thư đã trả tiền, nên mặc định TẮT.
              */}
              <label
                className={`flex items-start gap-2 p-1.5 border rounded border-panel-border ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-outline'
                }`}
              >
                <input
                  type="checkbox"
                  checked={config.skipWithoutTrial}
                  disabled={disabled}
                  onChange={(e) => onChange({ skipWithoutTrial: e.target.checked })}
                  className="w-3.5 h-3.5 mt-0.5 text-primary focus:ring-primary border-panel-border bg-surface rounded"
                />
                <span className="font-label-xs text-[10px] text-on-surface-variant leading-snug">
                  Bỏ qua account không có trial Pro ≥ 7 ngày
                </span>
              </label>
            </div>
          </Panel>

          {/* Panel 5: Nguồn Email */}
          <Panel
            title="Nguồn Email"
            icon={<Mail className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-1.5 mt-1 flex-1 flex flex-col">
              <SegmentedControl
                options={[
                  { value: 'manual', label: 'Manual' },
                  { value: 'api', label: 'API' },
                  { value: 'custom', label: 'Custom (Đã khóa)', disabled: true },
                ]}
                value={config.emailSourceMode === 'custom' ? 'api' : config.emailSourceMode}
                onChange={(value) => onChange({ emailSourceMode: value })}
                size="sm"
                disabled={disabled}
              />

              {config.emailSourceMode === 'custom' ? (
                <div className="flex-1 flex flex-col gap-1">
                  <div className="rounded border border-panel-border bg-surface-container-low px-2 py-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-on-surface-variant">Domain</span>
                      <span className="font-code text-[11px] text-primary">@{customEmail.domain}</span>
                    </div>
                    <span className="text-[10px] text-on-surface-variant leading-snug block">
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
                <div className="flex-1 flex flex-col gap-1">
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

                  {selectedEmailProvider?.isConfigured ? (
                    <div className="rounded border border-panel-border bg-surface-container-low px-2 py-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-on-surface-variant">API Key</span>
                        <span className="font-code text-[11px] text-primary tracking-wider">
                          {selectedEmailProvider.maskedHint}
                        </span>
                      </div>
                      <span className="text-[10px] text-on-surface-variant leading-snug">
                        {'Duy trì tối đa ' + config.threadCount + ' luồng; chỉ lấy 1 email khi một luồng đã có proxy và sẵn sàng.'}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded border border-warning/30 bg-warning/10 px-2 py-1 flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
                      <span className="text-[10px] text-warning leading-snug">
                        Chưa cấu hình API key ở Settings.
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 flex-1">
                  <Textarea
                    placeholder="email|password..."
                    value={config.emailList}
                    disabled={disabled}
                    onChange={(e) => onChange({ emailList: e.target.value })}
                    className="h-[52px] min-h-[52px] py-1 text-[11px]"
                  />
                  <span className="text-[10px] text-on-surface-variant leading-snug">
                    {'Xử lý mọi dòng hợp lệ, tối đa ' + config.threadCount + ' dòng cùng lúc.'}
                  </span>
                </div>
              )}
            </div>
          </Panel>

          {/* Panel 6: Mật khẩu CapCut */}
          <Panel
            title="Mật khẩu CapCut"
            icon={<KeyRound className="w-3.5 h-3.5" />}
            className="p-2.5 flex flex-col justify-between"
          >
            <div className="space-y-1.5 mt-1">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="pw_mode"
                      checked={config.passwordMode === 'custom'}
                      disabled={disabled}
                      onChange={() => onChange({ passwordMode: 'custom' })}
                      className="w-3 h-3 text-primary"
                    />
                    <span className="text-[11px] text-on-surface">Tự đặt</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="pw_mode"
                      checked={config.passwordMode === 'random'}
                      disabled={disabled}
                      onChange={() => onChange({ passwordMode: 'random' })}
                      className="w-3 h-3 text-primary"
                    />
                    <span className="text-[11px] text-on-surface">Random</span>
                  </label>
                </div>

                <div className="flex items-center gap-1">
                  <span className="font-label-xs text-[10px] text-on-surface-variant">Dài</span>
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
                    className="w-12 text-center py-0 h-6 text-xs"
                    fontMono
                  />
                </div>
              </div>

              {config.passwordMode === 'custom' && (
                <Input
                  type="text"
                  placeholder="Mật khẩu dùng cho mọi tài khoản"
                  value={config.customPassword}
                  disabled={disabled}
                  onChange={(e) => onChange({ customPassword: e.target.value })}
                  controlSize="sm"
                  fontMono
                />
              )}

              <div className="grid grid-cols-2 gap-1 p-1 bg-surface-container-low rounded border border-panel-border text-[10px]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={config.includeUppercase}
                    disabled={disabled}
                    onChange={(e) => onChange({ includeUppercase: e.target.checked })}
                  />
                  <span className="text-on-surface-variant">A-Z</span>
                </label>

                <label className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={config.includeNumbers}
                    disabled={disabled}
                    onChange={(e) => onChange({ includeNumbers: e.target.checked })}
                  />
                  <span className="text-on-surface-variant">0-9</span>
                </label>

                <label className="flex items-center gap-1 cursor-pointer col-span-2">
                  <Checkbox
                    checked={config.includeSpecial}
                    disabled={disabled}
                    onChange={(e) => onChange({ includeSpecial: e.target.checked })}
                  />
                  <span className="text-on-surface-variant">Ký tự đặc biệt (!@#)</span>
                </label>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
};
