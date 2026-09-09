import React, { useState, useEffect } from 'react';
import { Globe, Check, AlertCircle, Trash2 } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { Select } from '@renderer/components/ui/Select';
import { Input } from '@renderer/components/ui/Input';
import { Button } from '@renderer/components/ui/Button';
import { Switch } from '@renderer/components/ui/Switch';
import type { BrowserSettingsDTO } from '@shared/schemas/settings.schema';
import type { CredentialStatusDTO } from '@shared/schemas/diagnostics.schema';
import type {
  KnownServiceName,
  SimpleServiceName,
  SimpleDraft,
  MultiloginDraft,
} from './settingsController';

export interface BrowserSettingsPanelProps {
  settings: BrowserSettingsDTO;
  onChange: (settings: BrowserSettingsDTO) => void;
  credentialStatuses: Record<KnownServiceName, CredentialStatusDTO>;
  drafts: {
    gologin: SimpleDraft;
    multilogin: MultiloginDraft;
    [key: string]: SimpleDraft | MultiloginDraft;
  };
  onSetSimpleDraft: (service: SimpleServiceName, draft: SimpleDraft) => void;
  onSetMultiloginDraft: (draft: MultiloginDraft) => void;
  onTestConnection: (service: KnownServiceName) => void;
  testResult: { service: string; code: string; message: string } | null;
}

export const BrowserSettingsPanel: React.FC<BrowserSettingsPanelProps> = ({
  settings,
  onChange,
  credentialStatuses,
  drafts,
  onSetSimpleDraft,
  onSetMultiloginDraft,
  onTestConnection,
  testResult,
}) => {
  const [multiloginMode, setMultiloginMode] = useState<'token' | 'credentials'>('token');
  const [multiloginEmail, setMultiloginEmail] = useState('');
  const [multiloginPassword, setMultiloginPassword] = useState('');

  useEffect(() => {
    if (drafts.multilogin.action === 'keep') {
      setMultiloginEmail('');
      setMultiloginPassword('');
    }
  }, [drafts.multilogin.action]);

  const handleCredentialsChange = (newEmail: string, newPassword: string) => {
    setMultiloginEmail(newEmail);
    setMultiloginPassword(newPassword);
    if (newEmail.trim().length > 0 || newPassword.trim().length > 0) {
      onSetMultiloginDraft({
        action: 'replace',
        auth: {
          mode: 'credentials',
          email: newEmail.trim(),
          password: newPassword,
        },
      });
    } else {
      onSetMultiloginDraft({ action: 'keep' });
    }
  };

  const gologinStatus = credentialStatuses.gologin;
  const multiloginStatus = credentialStatuses.multilogin;

  const getStatusHeaderAction = () => {
    if (settings.provider === 'gpm') {
      return (
        <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant border border-panel-border rounded font-label-xs text-label-xs flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant inline-block" />
          <span>Đã cấu hình: Port {settings.gpm.port}</span>
        </span>
      );
    }

    if (settings.provider === 'gologin') {
      const isConfigured = gologinStatus?.isConfigured;
      return (
        <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant border border-panel-border rounded font-label-xs text-label-xs flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isConfigured ? 'bg-primary' : 'bg-on-surface-variant'}`} />
          <span>{isConfigured ? 'Đã cấu hình' : 'Chưa thiết lập'}</span>
        </span>
      );
    }

    if (settings.provider === 'multilogin') {
      const isConfigured = multiloginStatus?.isConfigured;
      if (!isConfigured) {
        return (
          <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant border border-panel-border rounded font-label-xs text-label-xs flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant inline-block" />
            <span>Chưa thiết lập</span>
          </span>
        );
      }
      if (multiloginStatus?.metadata.lastTestResult) {
        const isOk = multiloginStatus.metadata.lastTestResult.code === 'OK';
        return (
          <span
            className={`px-2 py-0.5 border rounded font-label-xs text-label-xs flex items-center gap-1 ${
              isOk
                ? 'bg-success/10 text-success border-success/25'
                : 'bg-error/10 text-error border-error/25'
            }`}
          >
            {isOk ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            <span>{isOk ? 'Connected' : 'Lỗi kết nối'}</span>
          </span>
        );
      }
      return (
        <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant border border-panel-border rounded font-label-xs text-label-xs flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full inline-block bg-primary" />
          <span>Đã cấu hình</span>
        </span>
      );
    }

    return (
      <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant border border-panel-border rounded font-label-xs text-label-xs flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant inline-block" />
        <span>Cấu hình cục bộ</span>
      </span>
    );
  };

  const currentTestResult = testResult?.service === settings.provider ? testResult : null;

  return (
    <Panel
      title="BROWSER & AUTOMATION RUNTIME"
      icon={<Globe className="w-4 h-4" />}
      headerAction={getStatusHeaderAction()}
      className="flex-1"
    >
      <div className="space-y-md mt-sm">
        {/* Browser Provider Dropdown */}
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Trình duyệt tự động (Browser Provider)
          </label>
          <Select
            value={settings.provider}
            onChange={(e) =>
              onChange({ ...settings, provider: e.target.value as BrowserSettingsDTO['provider'] })
            }
          >
            {/*
              Bốn tên còn lại chưa có một file implementation nào — `providerStack`
              trả `UnsupportedBrowserRuntime` và main từ chối lượt chạy TRƯỚC khi mua
              email. Khoá ở đây cho khớp dropdown Dashboard, đúng quyết định
              "tạm thời chỉ dùng Multilogin" (04/09/2026).
            */}
            <option value="multilogin">Multilogin (Local / Cloud)</option>
            <option value="gpm" disabled>GPM Login (chưa hỗ trợ)</option>
            <option value="gologin" disabled>GoLogin (chưa hỗ trợ)</option>
            <option value="camoufox" disabled>Camoufox (chưa hỗ trợ)</option>
            <option value="patchright" disabled>Patchright (chưa hỗ trợ)</option>
          </Select>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            Ô này chỉ chọn nơi để nhập thông tin đăng nhập. Browser dùng cho một lượt
            chạy chọn ở Dashboard.
          </p>
        </div>

        {/* Conditional Configuration based on Provider */}
        <div className="p-md bg-surface-container-low border border-panel-border rounded space-y-md">
          {/* 1. GPM Login Form */}
          {settings.provider === 'gpm' && (
            <div className="space-y-md">
              <div className="space-y-1">
                <label className="block font-label-md text-label-md text-on-surface-variant">
                  GPM Port (Mặc định: 19995)
                </label>
                <div className="flex gap-sm">
                  <Input
                    type="number"
                    value={settings.gpm.port}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        onChange({
                          ...settings,
                          gpm: { ...settings.gpm, port: val },
                        });
                      }
                    }}
                    fontMono
                    placeholder="19995"
                  />
                </div>
              </div>
              <p className="font-label-xs text-label-xs text-on-surface-variant">
                Yêu cầu phần mềm GPM Login đang mở và bật API trên port tương ứng.
              </p>
            </div>
          )}

          {/* 2. GoLogin Form */}
          {settings.provider === 'gologin' && (
            <div className="space-y-md">
              <div className="space-y-1">
                <label className="block font-label-md text-label-md text-on-surface-variant">
                  GoLogin API Token (Write-only)
                </label>
                <div className="flex gap-sm">
                  <Input
                    type="password"
                    value={drafts.gologin.action === 'replace' ? drafts.gologin.value : ''}
                    onChange={(e) =>
                      onSetSimpleDraft('gologin', { action: 'replace', value: e.target.value })
                    }
                    fontMono
                    placeholder={gologinStatus?.isConfigured ? 'Đã lưu: ••••••••' : 'Chưa thiết lập'}
                  />
                  {gologinStatus?.isConfigured && drafts.gologin.action !== 'clear' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={() => onSetSimpleDraft('gologin', { action: 'clear' })}
                      className="whitespace-nowrap shrink-0"
                    >
                      Xóa
                    </Button>
                  )}
                  {drafts.gologin.action === 'clear' && (
                    <span className="text-warning text-xs font-label-xs flex items-center px-2">
                      Sẽ xóa khi lưu
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="surface"
                    size="md"
                    onClick={() => onTestConnection('gologin')}
                    className="whitespace-nowrap shrink-0"
                  >
                    Kiểm tra API
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 3. Multilogin Form */}
          {settings.provider === 'multilogin' && (
            <div className="space-y-md">
              <div className="flex gap-sm mb-2">
                <Button
                  type="button"
                  variant={multiloginMode === 'token' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMultiloginMode('token')}
                >
                  Automation Token
                </Button>
                <Button
                  type="button"
                  variant={multiloginMode === 'credentials' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMultiloginMode('credentials')}
                >
                  Email & Mật khẩu
                </Button>
              </div>

              {multiloginMode === 'token' ? (
                <div className="space-y-1">
                  <label className="block font-label-md text-label-md text-on-surface-variant">
                    Multilogin Automation Token (Write-only)
                  </label>
                  <Input
                    type="password"
                    value={
                      drafts.multilogin.action === 'replace' && drafts.multilogin.auth.mode === 'token'
                        ? drafts.multilogin.auth.automationToken
                        : ''
                    }
                    onChange={(e) =>
                      onSetMultiloginDraft({
                        action: 'replace',
                        auth: { mode: 'token', automationToken: e.target.value },
                      })
                    }
                    fontMono
                    placeholder={
                      multiloginStatus?.isConfigured
                        ? 'Đã lưu: •••••••• (nhập để thay đổi)'
                        : 'Dán automation token vào đây...'
                    }
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-md">
                  <div className="space-y-1">
                    <label className="block font-label-md text-label-md text-on-surface-variant">
                      Email tài khoản Multilogin
                    </label>
                    <Input
                      type="email"
                      value={multiloginEmail}
                      onChange={(e) => handleCredentialsChange(e.target.value, multiloginPassword)}
                      placeholder={
                        multiloginStatus?.isConfigured
                          ? 'Đã lưu cấu hình (nhập để thay đổi)'
                          : 'user@domain.com'
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-label-md text-label-md text-on-surface-variant">
                      Mật khẩu Multilogin (Write-only)
                    </label>
                    <Input
                      type="password"
                      value={multiloginPassword}
                      onChange={(e) => handleCredentialsChange(multiloginEmail, e.target.value)}
                      placeholder={
                        multiloginStatus?.isConfigured
                          ? 'Đã lưu: •••••••• (nhập để thay đổi)'
                          : 'Nhập mật khẩu...'
                      }
                    />
                  </div>
                </div>
              )}

              {/*
                Đường mở quick profile. Hai đường đều đã chạy thật, khác nhau ở
                chỗ đã kiểm tới đâu — xem docs/MERGE-PLAN.md §8.
              */}
              <div className="space-y-1">
                <label className="block font-label-md text-label-md text-on-surface-variant">
                  Đường mở profile
                </label>
                <Select
                  value={settings.multilogin.launcher}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      multilogin: {
                        ...settings.multilogin,
                        launcher: e.target.value as BrowserSettingsDTO['multilogin']['launcher'],
                      },
                    })
                  }
                >
                  <option value="api-v3">api-v3 — REST /api/v3/profile/quick (Mặc định)</option>
                  <option value="xcli">xcli — CLI Multilogin</option>
                </Select>
                <p className="text-on-surface-variant text-xs font-label-xs">
                  {settings.multilogin.launcher === 'xcli'
                    ? 'Tắt được dialog "Save password" vì bơm Preferences trước khi Chrome mở. Không dùng được proxy có user/mật khẩu.'
                    : 'Dùng REST API đã live test. Proxy có user/mật khẩu chạy được; phần tắt dialog "Save password" chưa đo tay.'}
                </p>
              </div>

              <div className="flex justify-between items-center pt-2">
                <div>
                  {multiloginStatus?.isConfigured && drafts.multilogin.action !== 'clear' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={() => onSetMultiloginDraft({ action: 'clear' })}
                    >
                      Xóa cấu hình
                    </Button>
                  )}
                  {drafts.multilogin.action === 'clear' && (
                    <span className="text-warning text-xs font-label-xs">
                      Sẽ xóa khi lưu
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="surface"
                  size="md"
                  onClick={() => onTestConnection('multilogin')}
                >
                  Kiểm tra kết nối
                </Button>
              </div>

              {drafts.multilogin.action === 'replace' ? (
                <span className="text-warning text-xs font-label-xs block">
                  Đang nhập thông tin Multilogin mới (chưa lưu). Bấm &quot;Kiểm tra kết nối&quot; để test trực tiếp thông tin này.
                </span>
              ) : multiloginStatus?.isConfigured ? (
                <span className="text-on-surface-variant text-[11px] font-label-xs block">
                  Hệ thống đang lưu cấu hình Multilogin. Bấm &quot;Kiểm tra kết nối&quot; để test tài khoản và launcher Multilogin đã lưu.
                </span>
              ) : (
                <span className="text-on-surface-variant text-[11px] font-label-xs block">
                  Chưa có thông tin Multilogin. Vui lòng nhập token hoặc email/mật khẩu rồi bấm &quot;Lưu cài đặt&quot;.
                </span>
              )}
            </div>
          )}

          {/* 4. Camoufox Form */}
          {settings.provider === 'camoufox' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-label-md text-label-md text-on-surface font-medium">
                  Camoufox Engine (Anti-detect Firefox)
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Chế độ chạy ngầm (Headless mode)
                </p>
              </div>
              <Switch
                checked={settings.camoufox.headless}
                onChange={(checked) =>
                  onChange({
                    ...settings,
                    camoufox: { ...settings.camoufox, headless: checked },
                  })
                }
              />
            </div>
          )}

          {/* 5. Patchright Form */}
          {settings.provider === 'patchright' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-label-md text-label-md text-on-surface font-medium">
                  Patchright Chromium Engine
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Chế độ chạy ngầm (Headless mode)
                </p>
              </div>
              <Switch
                checked={settings.patchright.headless}
                onChange={(checked) =>
                  onChange({
                    ...settings,
                    patchright: { ...settings.patchright, headless: checked },
                  })
                }
              />
            </div>
          )}
        </div>

        {currentTestResult && (
          <div
            className={`p-2 rounded font-body-sm text-xs flex items-center gap-1.5 ${
              currentTestResult.code === 'OK'
                ? 'bg-success/10 border border-success/20 text-success'
                : 'bg-surface-container-high border border-panel-border text-on-surface-variant'
            }`}
          >
            {currentTestResult.code === 'OK' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            <span>[{currentTestResult.code}] {currentTestResult.message}</span>
          </div>
        )}
      </div>
    </Panel>
  );
};
