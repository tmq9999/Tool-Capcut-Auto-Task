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
              placeholder={gmailStatus?.isConfigured ? 'Đã lưu: ••••••••' : 'Chưa thiết lập'}
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
              placeholder={dongvanStatus?.isConfigured ? 'Đã lưu: ••••••••' : 'Chưa thiết lập'}
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
        <div className="space-y-1 pt-2 border-t border-panel-border">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            Custom Domain Mail (domain của bạn - không cần API key)
          </label>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-sm">
            <div className="space-y-0.5">
              <span className="block font-label-xs text-[10px] text-on-surface-variant">Domain</span>
              <Input
                type="text"
                value={customEmail.domain}
                onChange={(e) => onCustomEmailChange({ domain: e.target.value })}
                placeholder="oldevlk.com"
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
                fontMono
              />
            </div>
          </div>

          <p className="font-body-sm text-[11px] text-on-surface-variant">
            Chọn <span className="text-on-surface">Custom</span> ở panel Nguồn Email trên Dashboard để dùng.
            Mỗi luồng tự sinh một địa chỉ <span className="font-code text-primary">&lt;username&gt;@{customEmail.domain || 'domain'}</span>,
            OTP đọc từ <span className="font-code">{(customEmail.apiBaseUrl || '') + '/api/emails/&lt;address&gt;'}</span>.
          </p>
        </div>
      </div>
    </Panel>
  );
};
