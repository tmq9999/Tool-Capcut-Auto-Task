import React from 'react';
import { Mail, Check, AlertCircle, Trash2 } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { Input } from '@renderer/components/ui/Input';
import { Button } from '@renderer/components/ui/Button';
import type { CredentialStatusDTO } from '@shared/schemas/diagnostics.schema';
import type { CustomEmailSettingsDTO } from '@shared/schemas/settings.schema';
import type {
  KnownServiceName,
  SimpleServiceName,
  SimpleDraft,
} from './settingsController';

export interface EmailProviderPanelProps {
  credentialStatuses: Record<KnownServiceName, CredentialStatusDTO>;
  drafts: {
    gmail94: SimpleDraft;
    dongvanfb: SimpleDraft;
    [key: string]: unknown;
  };
  onSetSimpleDraft: (service: SimpleServiceName, draft: SimpleDraft) => void;
  onTestConnection: (service: KnownServiceName) => void;
  testResult: { service: string; code: string; message: string } | null;
  customEmail: CustomEmailSettingsDTO;
  onCustomEmailChange: (patch: Partial<CustomEmailSettingsDTO>) => void;
}

export const EmailProviderPanel: React.FC<EmailProviderPanelProps> = ({
  credentialStatuses,
  drafts,
  onSetSimpleDraft,
  onTestConnection,
  testResult,
  customEmail,
  onCustomEmailChange,
}) => {
  const gmailStatus = credentialStatuses.gmail94;
  const dongvanStatus = credentialStatuses.dongvanfb;

  const renderStatusBadge = (status?: CredentialStatusDTO) => {
    if (!status?.isConfigured) {
      return (
        <div className="h-control_height_md px-3 rounded border font-label-xs text-label-xs flex items-center gap-1 shrink-0 bg-surface-container-high text-on-surface-variant border-panel-border">
          <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant" />
          <span>Chưa thiết lập</span>
        </div>
      );
    }

    if (status.metadata.lastTestResult) {
      const isOk = status.metadata.lastTestResult.code === 'OK';
      return (
        <div
          className={`h-control_height_md px-3 rounded border font-label-xs text-label-xs flex items-center gap-1 shrink-0 ${
            isOk
              ? 'bg-success/10 text-success border-success/25'
              : 'bg-error/10 text-error border-error/25'
          }`}
        >
          {isOk ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          <span>{isOk ? 'Connected' : 'Lỗi kết nối'}</span>
        </div>
      );
    }

    return (
      <div className="h-control_height_md px-3 rounded border font-label-xs text-label-xs flex items-center gap-1 shrink-0 bg-surface-container-high text-primary border-panel-border">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span>Đã cấu hình</span>
      </div>
    );
  };

  const gmailTestResult = testResult?.service === 'gmail94' ? testResult : null;
  const dongvanTestResult = testResult?.service === 'dongvanfb' ? testResult : null;

  return (
    <Panel
      title="EMAIL PROVIDER API"
      icon={<Mail className="w-4 h-4" />}
      className="flex-1"
    >
      <div className="space-y-md mt-sm">
        {/* Gmail94 Section */}
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Gmail94 API Key (Dịch vụ OTP & Mail Gmail - Write-only)
          </label>
          <div className="flex items-center gap-sm">
            <Input
              type="password"
              value={drafts.gmail94.action === 'replace' ? drafts.gmail94.value : ''}
              onChange={(e) =>
                onSetSimpleDraft('gmail94', { action: 'replace', value: e.target.value })
              }
              placeholder={gmailStatus?.isConfigured ? 'Đã lưu: •••••••• (nhập để thay đổi)' : 'Dán API key Gmail94 vào đây...'}
              fontMono
            />
            {gmailStatus?.isConfigured && drafts.gmail94.action !== 'clear' && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => onSetSimpleDraft('gmail94', { action: 'clear' })}
                className="whitespace-nowrap shrink-0"
              >
                Xóa
              </Button>
            )}
            {drafts.gmail94.action === 'clear' && (
              <span className="text-warning text-xs font-label-xs flex items-center px-2">
                Sẽ xóa khi lưu
              </span>
            )}
            <Button
              type="button"
              variant="surface"
              size="md"
              onClick={() => onTestConnection('gmail94')}
              className="whitespace-nowrap shrink-0"
            >
              Kiểm tra API
            </Button>
            {renderStatusBadge(gmailStatus)}
          </div>

          {drafts.gmail94.action === 'replace' ? (
            <span className="text-warning text-xs font-label-xs block">
              Đang nhập key mới (chưa lưu). Bấm &quot;Kiểm tra API&quot; để test trực tiếp key này.
            </span>
          ) : gmailStatus?.isConfigured ? (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Hệ thống đang lưu key: <span className="text-primary font-mono font-semibold">{gmailStatus.metadata.maskedHint}</span>. Bấm &quot;Kiểm tra API&quot; để test key đã lưu này.
            </span>
          ) : (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Chưa có key trong máy. Vui lòng nhập key rồi bấm &quot;Lưu cài đặt&quot;.
            </span>
          )}

          {gmailTestResult && (
            <div
              className={`mt-1 p-2 rounded font-body-sm text-xs flex items-center gap-1.5 ${
                gmailTestResult.code === 'OK'
                  ? 'bg-success/10 border border-success/20 text-success'
                  : 'bg-surface-container-high border border-panel-border text-on-surface-variant'
              }`}
            >
              {gmailTestResult.code === 'OK' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              <span>[{gmailTestResult.code}] {gmailTestResult.message}</span>
            </div>
          )}
        </div>

        {/* DongVanFB Section */}
        <div className="space-y-1 pt-2 border-t border-panel-border">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            DongVanFB API Key (Dịch vụ Mail Hotmail/Outlook - Write-only)
          </label>
          <div className="flex items-center gap-sm">
            <Input
              type="password"
              value={drafts.dongvanfb.action === 'replace' ? drafts.dongvanfb.value : ''}
              onChange={(e) =>
                onSetSimpleDraft('dongvanfb', { action: 'replace', value: e.target.value })
              }
              placeholder={dongvanStatus?.isConfigured ? 'Đã lưu: •••••••• (nhập để thay đổi)' : 'Dán API key DongVanFB vào đây...'}
              fontMono
            />
            {dongvanStatus?.isConfigured && drafts.dongvanfb.action !== 'clear' && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => onSetSimpleDraft('dongvanfb', { action: 'clear' })}
                className="whitespace-nowrap shrink-0"
              >
                Xóa
              </Button>
            )}
            {drafts.dongvanfb.action === 'clear' && (
              <span className="text-warning text-xs font-label-xs flex items-center px-2">
                Sẽ xóa khi lưu
              </span>
            )}
            <Button
              type="button"
              variant="surface"
              size="md"
              onClick={() => onTestConnection('dongvanfb')}
              className="whitespace-nowrap shrink-0"
            >
              Kiểm tra API
            </Button>
            {renderStatusBadge(dongvanStatus)}
          </div>

          {drafts.dongvanfb.action === 'replace' ? (
            <span className="text-warning text-xs font-label-xs block">
              Đang nhập key mới (chưa lưu). Bấm &quot;Kiểm tra API&quot; để test trực tiếp key này.
            </span>
          ) : dongvanStatus?.isConfigured ? (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Hệ thống đang lưu key: <span className="text-primary font-mono font-semibold">{dongvanStatus.metadata.maskedHint}</span>. Bấm &quot;Kiểm tra API&quot; để test key đã lưu này.
            </span>
          ) : (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Chưa có key trong máy. Vui lòng nhập key rồi bấm &quot;Lưu cài đặt&quot;.
            </span>
          )}

          {dongvanTestResult && (
            <div
              className={`mt-1 p-2 rounded font-body-sm text-xs flex items-center gap-1.5 ${
                dongvanTestResult.code === 'OK'
                  ? 'bg-success/10 border border-success/20 text-success'
                  : 'bg-surface-container-high border border-panel-border text-on-surface-variant'
              }`}
            >
              {dongvanTestResult.code === 'OK' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              <span>[{dongvanTestResult.code}] {dongvanTestResult.message}</span>
            </div>
          )}
        </div>

        {/* Custom Domain Mail: no API key, addresses are generated on your domain */}
        <div className="space-y-1 pt-2 border-t border-panel-border opacity-70">
          <div className="flex items-center gap-2">
            <label className="block font-label-md text-label-md text-on-surface-variant">
              Custom Domain Mail (domain của bạn - không cần API key)
            </label>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-panel-border">
              Đã khóa
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-sm">
            <div className="space-y-0.5">
              <span className="block font-label-xs text-[10px] text-on-surface-variant">Domain</span>
              <Input
                type="text"
                value={customEmail.domain}
                onChange={(e) => onCustomEmailChange({ domain: e.target.value })}
                placeholder="oldevlk.com"
                disabled={true}
                fontMono
              />
            </div>

            <div className="space-y-0.5">
              <span className="block font-label-xs text-[10px] text-on-surface-variant">API đọc mail</span>
              <Input
                type="text"
                value={customEmail.apiBaseUrl}
                onChange={(e) => onCustomEmailChange({ apiBaseUrl: e.target.value })}
                placeholder="http://103.116.38.76:3000"
                disabled={true}
                fontMono
              />
            </div>

            <div className="space-y-0.5">
              <span className="block font-label-xs text-[10px] text-on-surface-variant">Chỉ đọc mail từ</span>
              <Input
                type="text"
                value={customEmail.senderFilter}
                onChange={(e) => onCustomEmailChange({ senderFilter: e.target.value })}
                placeholder="capcut"
                disabled={true}
                fontMono
              />
            </div>
          </div>

          <p className="font-body-sm text-[11px] text-on-surface-variant">
            Chức năng Custom Domain Mail hiện đang tạm khóa. Vui lòng sử dụng nguồn Email API (Gmail94) hoặc Manual.
          </p>
        </div>
      </div>
    </Panel>
  );
};
