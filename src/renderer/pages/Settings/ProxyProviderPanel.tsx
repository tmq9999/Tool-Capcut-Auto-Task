import React from 'react';
import { Globe, Check, AlertCircle, Trash2 } from 'lucide-react';
import { Panel } from '@renderer/components/ui/Panel';
import { Input } from '@renderer/components/ui/Input';
import { Button } from '@renderer/components/ui/Button';
import type { CredentialStatusDTO } from '@shared/schemas/diagnostics.schema';
import type { KnownServiceName, SimpleServiceName, SimpleDraft } from './settingsController';

export interface ProxyProviderPanelProps {
  credentialStatuses: Record<KnownServiceName, CredentialStatusDTO>;
  drafts: {
    kiotproxy: SimpleDraft;
    [key: string]: unknown;
  };
  onSetSimpleDraft: (service: SimpleServiceName, draft: SimpleDraft) => void;
  onTestConnection: (service: KnownServiceName) => void;
  testResult: { service: string; code: string; message: string } | null;
}

export const ProxyProviderPanel: React.FC<ProxyProviderPanelProps> = ({
  credentialStatuses,
  drafts,
  onSetSimpleDraft,
  onTestConnection,
  testResult,
}) => {
  const status = credentialStatuses.kiotproxy;
  const kiotTestResult = testResult?.service === 'kiotproxy' ? testResult : null;
  const keyCount = status?.metadata.lastTestResult?.details?.keyCount;

  const renderStatusBadge = () => {
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

  return (
    <Panel title="PROXY PROVIDER API" icon={<Globe className="w-4 h-4" />} className="flex-1">
      <div className="space-y-md mt-sm">
        <div className="space-y-1">
          <label className="block font-label-md text-label-md text-on-surface-variant">
            KiotProxy Api-token (Quản lý proxy key - Write-only)
          </label>
          <div className="flex items-center gap-sm">
            <Input
              type="password"
              value={drafts.kiotproxy.action === 'replace' ? drafts.kiotproxy.value : ''}
              onChange={(e) =>
                onSetSimpleDraft('kiotproxy', { action: 'replace', value: e.target.value })
              }
              placeholder={status?.isConfigured ? 'Đã lưu: •••••••• (nhập để thay đổi)' : 'Dán token KiotProxy vào đây...'}
              fontMono
            />
            {status?.isConfigured && drafts.kiotproxy.action !== 'clear' && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => onSetSimpleDraft('kiotproxy', { action: 'clear' })}
                className="whitespace-nowrap shrink-0"
              >
                Xóa
              </Button>
            )}
            {drafts.kiotproxy.action === 'clear' && (
              <span className="text-warning text-xs font-label-xs flex items-center px-2">
                Sẽ xóa khi lưu
              </span>
            )}
            <Button
              type="button"
              variant="surface"
              size="md"
              onClick={() => onTestConnection('kiotproxy')}
              className="whitespace-nowrap shrink-0"
            >
              Kiểm tra API
            </Button>
            {renderStatusBadge()}
          </div>

          {drafts.kiotproxy.action === 'replace' ? (
            <span className="text-warning text-xs font-label-xs block">
              Đang nhập token mới (chưa lưu). Bấm &quot;Kiểm tra API&quot; để test trực tiếp token này.
            </span>
          ) : status?.isConfigured ? (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Hệ thống đang lưu token: <span className="text-primary font-mono font-semibold">{status.metadata.maskedHint}</span>. Bấm &quot;Kiểm tra API&quot; để test token đã lưu này.
            </span>
          ) : (
            <span className="text-on-surface-variant text-[11px] font-label-xs block">
              Chưa có token trong máy. Vui lòng nhập token rồi bấm &quot;Lưu cài đặt&quot;.
            </span>
          )}

          <p className="font-body-sm text-[11px] text-on-surface-variant">
            Mỗi luồng chiếm một proxy key và luôn xin IP mới (đối chiếu với IP hiện tại của key). Số key quyết định số luồng chạy song song.
            {typeof keyCount === 'number' && (
              <span className="text-primary"> Hiện có {keyCount} key.</span>
            )}
          </p>

          {kiotTestResult && (
            <div
              className={`mt-1 p-2 rounded font-body-sm text-xs flex items-center gap-1.5 ${
                kiotTestResult.code === 'OK'
                  ? 'bg-success/10 border border-success/20 text-success'
                  : 'bg-surface-container-high border border-panel-border text-on-surface-variant'
              }`}
            >
              {kiotTestResult.code === 'OK' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              <span>[{kiotTestResult.code}] {kiotTestResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
};
