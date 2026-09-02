import React from 'react';
import { Terminal } from 'lucide-react';
import type { CanonicalRuntimeLog } from '@shared/schemas/log.schema';

export interface DockedLiveLogsProps {
  logs: CanonicalRuntimeLog[];
  isStreaming?: boolean;
}

function toClockTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? createdAt : parsed.toTimeString().slice(0, 8);
}

export const DockedLiveLogs: React.FC<DockedLiveLogsProps> = ({ logs, isStreaming = false }) => {
  return (
    <div className="w-full h-full bg-[#0d1117] border border-panel-border rounded-lg flex flex-col overflow-hidden select-none">
      {/* Header */}
      <div className="h-8 px-sm bg-panel border-b border-panel-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="font-label-xs text-label-xs text-on-surface font-semibold">System Logs</span>
        </div>
        <span
          className={`w-2 h-2 rounded-full ${
            isStreaming ? 'bg-primary animate-pulse' : 'bg-on-surface-variant/40'
          }`}
        />
      </div>

      {/* Log Feed */}
      <div className="flex-1 overflow-y-auto p-sm font-code text-[11px] leading-relaxed text-[#c9d1d9] flex flex-col gap-1.5 custom-scrollbar">
        {logs.length === 0 && (
          <span className="text-[#8b949e]">Chưa có log nào. Bấm BẮT ĐẦU để chạy.</span>
        )}

        {logs.map((log) => {
          let statusColor = 'text-[#3b82f6]';
          let rowHighlight = '';

          if (log.status === 'ERROR') {
            statusColor = 'text-[#ef4444]';
          } else if (log.status === 'WAITING' || log.status === 'WARNING') {
            statusColor = 'text-[#f59e0b]';
          } else if (log.status === 'SUCCESS') {
            statusColor = 'text-[#10b981]';
            rowHighlight = 'bg-[#1f2937]/50 -mx-sm px-sm py-0.5 border-l-2 border-[#10b981]';
          } else if (log.status === 'DEBUG') {
            statusColor = 'text-[#a7b6cc]';
          }

          return (
            <div key={log.id} className={rowHighlight}>
              <span className="text-[#8b949e]">[{toClockTime(log.createdAt)}]</span>{' '}
              <span className={`font-semibold ${statusColor}`}>{log.status}:</span>{' '}
              <span className="text-on-surface">{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
