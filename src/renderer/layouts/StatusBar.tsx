import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import type { CredentialStatusDTO } from '@shared/schemas/diagnostics.schema';

export interface StatusBarProps {
  className?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({ className }) => {
  const [version, setVersion] = useState<string>('v2.4.0');
  const [statuses, setStatuses] = useState<CredentialStatusDTO[]>([]);

  useEffect(() => {
    const api = window.electronAPI;
    if (api?.version) {
      setVersion(`v${api.version}`);
    }

    if (api?.settings?.get) {
      api.settings
        .get()
        .then((res) => {
          if (res.success) {
            setStatuses(res.data.credentials);
          }
        })
        .catch(() => {
          // Keep the neutral placeholders.
        });
    }

    // Connectivity tests in Settings republish statuses; reflect them live.
    return api?.services?.onStatusChanged
      ? api.services.onStatusChanged((next) => setStatuses(next))
      : undefined;
  }, []);

  const findStatus = (serviceName: string): CredentialStatusDTO | null =>
    statuses.find((entry) => entry.serviceName === serviceName) ?? null;

  const multiloginStatus = findStatus('multilogin');
  const emailStatus = findStatus('gmail94') ?? findStatus('dongvanfb');
  const proxyStatus = findStatus('kiotproxy');

  const getStatusDotClass = (status: CredentialStatusDTO | null) => {
    if (!status?.isConfigured) {
      return 'bg-on-surface-variant/40';
    }
    if (status.metadata.lastTestResult) {
      return status.metadata.lastTestResult.code === 'OK' ? 'bg-success' : 'bg-error';
    }
    return 'bg-primary';
  };

  const getStatusLabel = (serviceName: string, status: CredentialStatusDTO | null) => {
    if (!status?.isConfigured) {
      return `${serviceName}: Chưa cấu hình`;
    }
    if (status.metadata.lastTestResult) {
      return status.metadata.lastTestResult.code === 'OK'
        ? `${serviceName}: Connected`
        : `${serviceName}: Lỗi kết nối`;
    }
    return `${serviceName}: Đã cấu hình`;
  };

  return (
    <footer
      className={clsx(
        'fixed bottom-0 left-sidebar right-0 h-control_height_sm bg-panel border-t border-panel-border flex items-center justify-between px-lg z-50 select-none text-label-xs font-label-xs',
        className
      )}
    >
      <div className="flex items-center gap-4">
        {/* Multilogin Status */}
        <span className="text-on-surface flex items-center gap-1.5">
          <span className={clsx('w-2 h-2 rounded-full', getStatusDotClass(multiloginStatus))} />
          <span>{getStatusLabel('Multilogin', multiloginStatus)}</span>
        </span>

        {/* Proxy Status */}
        <span className="text-on-surface flex items-center gap-1.5">
          <span className={clsx('w-2 h-2 rounded-full', getStatusDotClass(proxyStatus))} />
          <span>{getStatusLabel('KiotProxy', proxyStatus)}</span>
        </span>

        {/* Email API Status */}
        <span className="text-on-surface flex items-center gap-1.5">
          <span className={clsx('w-2 h-2 rounded-full', getStatusDotClass(emailStatus))} />
          <span>{getStatusLabel('Email API', emailStatus)}</span>
        </span>
      </div>

      <span className="text-on-surface-variant font-code text-[11px]">{version}</span>
    </footer>
  );
};
