import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RotateCcw, Save, Check, AlertTriangle } from 'lucide-react';
import { AppHeader } from '@renderer/layouts/AppHeader';
import { Button } from '@renderer/components/ui/Button';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { BrowserSettingsPanel } from './BrowserSettingsPanel';
import { EmailProviderPanel } from './EmailProviderPanel';
import { ProxyProviderPanel } from './ProxyProviderPanel';
import { ExportSettingsPanel } from './ExportSettingsPanel';
import {
  SettingsController,
  type ISettingsBridge,
  type SettingsState,
  type KnownServiceName,
  type SimpleDraft,
} from './settingsController';
import { DEFAULT_APP_SETTINGS } from '@shared/settings/default-settings';
import { applyTheme, writeBootPreferences } from '@renderer/app/appPreferences';

export const SettingsPage: React.FC = () => {
  const bridge = useMemo<ISettingsBridge>(() => {
    if (window.electronAPI?.settings) {
      return {
        settings: window.electronAPI.settings,
        credentials: window.electronAPI.credentials,
      };
    }
    return {
      settings: {
        get: async () => ({
          success: false,
          error: {
            code: 'ERR_BRIDGE_UNAVAILABLE',
            message: 'Electron IPC bridge is unavailable in this environment.',
          },
        }),
        save: async () => ({
          success: false,
          error: {
            code: 'ERR_BRIDGE_UNAVAILABLE',
            message: 'Electron IPC bridge is unavailable in this environment.',
          },
        }),
      },
    };
  }, []);

  const controller = useMemo(() => new SettingsController(bridge), [bridge]);
  const [state, setState] = useState<SettingsState>(() => controller.getState());
  const [testResult, setTestResult] = useState<{ service: string; code: string; message: string } | null>(null);
  const effectEpoch = useRef(0);

  useEffect(() => {
    effectEpoch.current += 1;
    const unsubscribe = controller.subscribe((newState) => {
      setState({ ...newState });
    });
    controller.load();

    return () => {
      effectEpoch.current += 1;
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  /**
   * Khôi phục mặc định CHỈ những mục trang này hiện ra.
   *
   * Bản cũ ghi đè cả `DEFAULT_APP_SETTINGS`, tức là xoá luôn `automation` (số
   * luồng, độ trễ, quy tắc mật khẩu — sửa ở Dashboard) và `customEmail` (domain,
   * API) mà không nói gì: người dùng bấm nút ở trang Settings rồi mất cấu hình ở
   * trang khác (audit 04/09/2026).
   */
  const handleResetDefaults = () => {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)) as typeof DEFAULT_APP_SETTINGS;
    controller.updateSettings((current) => ({
      ...current,
      general: defaults.general,
      browser: defaults.browser,
      logs: defaults.logs,
      exportConfig: defaults.exportConfig
    }));
  };

  const handleSaveSettings = async () => {
    const saveEpoch = effectEpoch.current;
    const saved = await controller.save();
    if (!saved || effectEpoch.current !== saveEpoch) return;
    const committed = controller.getLastCommittedGeneral();
    if (committed) {
      writeBootPreferences(window.localStorage, committed.general);
      applyTheme(committed.general.theme, document.documentElement);
    }
  };

  const handleTestConnection = async (serviceName: KnownServiceName) => {
    if (!bridge.credentials?.test) {
      setTestResult({
        service: serviceName,
        code: 'ERR_BRIDGE_UNAVAILABLE',
        message: 'Dịch vụ kiểm tra không khả dụng.',
      });
      return;
    }

    const status = state.credentialStatuses[serviceName];
    const simpleDraft =
      serviceName !== 'multilogin'
        ? (state.drafts as unknown as Record<string, SimpleDraft>)[serviceName]
        : undefined;
    const multiloginDraft = state.drafts.multilogin;

    let draftSecret: string | undefined;
    let mlDraft:
      | { mode: 'token' | 'credentials'; automationToken?: string; email?: string; password?: string }
      | undefined;

    if (serviceName === 'multilogin') {
      if (multiloginDraft.action === 'replace') {
        if (multiloginDraft.auth.mode === 'token') {
          if (!multiloginDraft.auth.automationToken?.trim()) {
            setTestResult({
              service: serviceName,
              code: 'CONFIG_ERROR',
              message: 'Ô automation token đang trống. Vui lòng nhập token trước khi kiểm tra.',
            });
            return;
          }
          mlDraft = { mode: 'token', automationToken: multiloginDraft.auth.automationToken.trim() };
        } else {
          if (!multiloginDraft.auth.email?.trim() || !multiloginDraft.auth.password?.trim()) {
            setTestResult({
              service: serviceName,
              code: 'CONFIG_ERROR',
              message: 'Vui lòng nhập đầy đủ Email và Mật khẩu Multilogin trước khi kiểm tra.',
            });
            return;
          }
          mlDraft = {
            mode: 'credentials',
            email: multiloginDraft.auth.email.trim(),
            password: multiloginDraft.auth.password.trim(),
          };
        }
      } else if (multiloginDraft.action === 'clear') {
        setTestResult({
          service: serviceName,
          code: 'CONFIG_ERROR',
          message: 'Cấu hình Multilogin đã bị xóa (chưa lưu). Vui lòng nhập thông tin mới.',
        });
        return;
      } else if (!status?.isConfigured) {
        setTestResult({
          service: serviceName,
          code: 'CONFIG_ERROR',
          message: 'Chưa thiết lập thông tin Multilogin. Vui lòng nhập token hoặc email/mật khẩu.',
        });
        return;
      }
    } else {
      if (simpleDraft?.action === 'replace') {
        draftSecret = simpleDraft.value.trim();
        if (!draftSecret) {
          setTestResult({
            service: serviceName,
            code: 'CONFIG_ERROR',
            message: 'Ô nhập API key đang trống. Vui lòng nhập key trước khi kiểm tra.',
          });
          return;
        }
      } else if (simpleDraft?.action === 'clear') {
        setTestResult({
          service: serviceName,
          code: 'CONFIG_ERROR',
          message: 'API key đã bị xóa (chưa lưu). Vui lòng nhập key mới trước khi kiểm tra.',
        });
        return;
      } else if (!status?.isConfigured) {
        setTestResult({
          service: serviceName,
          code: 'CONFIG_ERROR',
          message: 'Chưa thiết lập API key cho dịch vụ này. Vui lòng nhập key vào ô bên cạnh.',
        });
        return;
      }
    }

    try {
      const payload = {
        serviceName,
        draftSecret,
        multiloginDraft: mlDraft,
      };
      const res = await bridge.credentials.test(payload);
      if (res.success) {
        setTestResult({
          service: serviceName,
          code: res.data.code,
          message: res.data.message,
        });
      } else {
        setTestResult({
          service: serviceName,
          code: res.error.code,
          message: res.error.message,
        });
      }
    } catch {
      setTestResult({
        service: serviceName,
        code: 'ERR_PERSISTENCE_FAILED',
        message: 'Không thể kiểm tra kết nối dịch vụ.',
      });
    }
  };

  const isBridgeAvailable = !!window.electronAPI?.settings;

  const headerActions = (
    <div className="flex items-center gap-2">
      {state.isSaved && (
        <span className="text-success text-xs font-label-xs flex items-center gap-1 mr-2">
          <Check className="w-3.5 h-3.5" />
          <span>Đã lưu cài đặt</span>
        </span>
      )}
      <Button
        variant="secondary"
        size="md"
        icon={<RotateCcw className="w-3.5 h-3.5" />}
        onClick={handleResetDefaults}
        disabled={state.isSaving || state.isLoading}
      >
        Khôi phục mặc định
      </Button>

      <Button
        variant="primary"
        size="md"
        icon={<Save className="w-3.5 h-3.5" />}
        onClick={handleSaveSettings}
        disabled={state.isSaving || state.isLoading || !isBridgeAvailable}
      >
        {state.isSaving ? 'ĐANG LƯU...' : 'LƯU CÀI ĐẶT'}
      </Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Shared AppHeader */}
      <AppHeader
        title="CÀI ĐẶT"
        subtitle="Quản lý cấu hình hệ thống, tích hợp trình duyệt và định dạng xuất dữ liệu"
        actions={headerActions}
      />

      {/* Scrollable Canvas */}
      <div className="flex-1 overflow-y-auto bg-background p-xl pb-16 custom-scrollbar">
        <div className="max-w-[1200px] mx-auto space-y-lg">
          {/* Error Banner */}
          {state.error && (
            <div className="p-3 bg-error/10 border border-error/30 rounded text-error text-xs font-body-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>[{state.error.code}] {state.error.message}</span>
            </div>
          )}

          {/* Warning Banner */}
          {state.warning && (
            <div className="p-3 bg-warning/10 border border-warning/30 rounded text-warning text-xs font-body-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{state.warning}</span>
            </div>
          )}

          {!isBridgeAvailable && (
            <div className="p-3 bg-warning/10 border border-warning/30 rounded text-warning text-xs font-body-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Electron IPC bridge không khả dụng. Chức năng lưu cài đặt đã bị vô hiệu hóa.</span>
            </div>
          )}

          {/* Top Row: General Settings (4 cols) & Browser/Email Settings (8 cols) */}
          <div className="grid grid-cols-12 gap-lg items-start">
            {/* General Settings */}
            <div className="col-span-12 lg:col-span-4 h-full">
              <GeneralSettingsPanel
                settings={state.settings.general}
                onChange={(general) =>
                  controller.updateSettings((prev) => ({ ...prev, general }))
                }
                logs={state.settings.logs}
                onLogsChange={(logs) =>
                  controller.updateSettings((prev) => ({ ...prev, logs }))
                }
              />
            </div>

            {/* Middle Column: Browser & Email Provider Panels */}
            <div className="col-span-12 lg:col-span-8 flex flex-col gap-lg">
              <BrowserSettingsPanel
                settings={state.settings.browser}
                onChange={(browser) =>
                  controller.updateSettings((prev) => ({ ...prev, browser }))
                }
                credentialStatuses={state.credentialStatuses}
                drafts={state.drafts}
                onSetSimpleDraft={(service, draft) =>
                  controller.setSimpleDraft(service, draft)
                }
                onSetMultiloginDraft={(draft) =>
                  controller.setMultiloginDraft(draft)
                }
                onTestConnection={handleTestConnection}
                testResult={testResult}
              />

              <EmailProviderPanel
                credentialStatuses={state.credentialStatuses}
                drafts={state.drafts}
                onSetSimpleDraft={(service, draft) =>
                  controller.setSimpleDraft(service, draft)
                }
                onTestConnection={handleTestConnection}
                testResult={testResult}
                customEmail={state.settings.customEmail}
                onCustomEmailChange={(patch) =>
                  controller.updateSettings((prev) => ({
                    ...prev,
                    customEmail: { ...prev.customEmail, ...patch },
                  }))
                }
              />

              <ProxyProviderPanel
                credentialStatuses={state.credentialStatuses}
                drafts={state.drafts}
                onSetSimpleDraft={(service, draft) =>
                  controller.setSimpleDraft(service, draft)
                }
                onTestConnection={handleTestConnection}
                testResult={testResult}
              />
            </div>
          </div>

          {/* Bottom Row: Export Settings */}
          <div className="w-full">
            <ExportSettingsPanel
              settings={state.settings.exportConfig}
              onChange={(exportConfig) =>
                controller.updateSettings((prev) => ({ ...prev, exportConfig }))
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};
