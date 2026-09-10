import React, { useEffect, useState } from 'react';
import { Modal } from '@renderer/components/ui/Modal';
import { Button } from '@renderer/components/ui/Button';
import { Badge } from '@renderer/components/ui/Badge';
import {
  CAPCUT_TASK_STATUS,
  taskStatusLabel,
  type AccountTasksResponseDTO
} from '@shared/schemas/account-task.schema';

export interface TaskProgressDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string | null;
  email: string;
  loadTasks?: (accountId: string) => Promise<AccountTasksResponseDTO | null>;
  initialData?: AccountTasksResponseDTO | null;
}

function statusVariant(status: number): 'done' | 'waiting' | 'disabled' {
  if (status === CAPCUT_TASK_STATUS.DONE) return 'done';
  if (status === CAPCUT_TASK_STATUS.CLAIMABLE) return 'waiting';
  return 'disabled';
}

function verificationBadgeConfig(state: 'verified' | 'partial' | 'stale' | 'missing'): {
  variant: 'done' | 'waiting' | 'disabled';
  label: string;
} {
  switch (state) {
    case 'verified':
      return { variant: 'done', label: 'Đã xác minh' };
    case 'partial':
      return { variant: 'waiting', label: 'Chưa hoàn tất' };
    case 'stale':
      return { variant: 'disabled', label: 'Chưa xác minh (cũ)' };
    case 'missing':
    default:
      return { variant: 'disabled', label: 'Chưa xác minh' };
  }
}

interface LoadedState {
  accountId: string;
  data: AccountTasksResponseDTO;
}

/**
 * Bảng tiến độ nhiệm vụ của một account.
 *
 * Số liệu là `task_status` do CHÍNH CapCut trả về (`account_tasks`), không phải
 * bộ đếm nội bộ — bản CLI cũ từng báo "7/10" trong khi CapCut ghi nhận ít hơn.
 */
export const TaskProgressDialog: React.FC<TaskProgressDialogProps> = ({
  isOpen,
  onClose,
  accountId,
  email,
  loadTasks,
  initialData = null,
}) => {
  const [loaded, setLoaded] = useState<LoadedState | null>(() =>
    initialData && accountId ? { accountId, data: initialData } : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = React.useRef(0);

  useEffect(() => {
    if (!isOpen || !accountId) {
      setLoaded(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (!loadTasks) {
      setLoaded((prev) => (prev && prev.accountId !== accountId ? null : prev));
      return;
    }

    const token = ++requestTokenRef.current;
    let canceled = false;

    setLoaded(null);
    setError(null);
    setIsLoading(true);

    void loadTasks(accountId)
      .then((result) => {
        if (canceled || token !== requestTokenRef.current) return;
        if (!result) {
          setError('Không đọc được tiến độ nhiệm vụ.');
          setLoaded(null);
          return;
        }
        setLoaded({ accountId, data: result });
      })
      .catch((err: unknown) => {
        if (canceled || token !== requestTokenRef.current) return;
        setError(err instanceof Error ? err.message : 'Không đọc được tiến độ nhiệm vụ.');
        setLoaded(null);
      })
      .finally(() => {
        if (!canceled && token === requestTokenRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [isOpen, accountId, loadTasks]);

  const activeData = loaded && loaded.accountId === accountId ? loaded.data : null;

  const footer = (
    <Button variant="secondary" size="md" onClick={onClose}>
      Đóng
    </Button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Tiến độ nhiệm vụ CapCut"
      subtitle={email}
      footer={footer}
      maxWidth="lg"
    >
      <div className="space-y-md">
        <div className="flex items-center gap-4 font-body-sm text-body-sm">
          <span className="text-on-surface-variant">
            CapCut ghi nhận:{' '}
            <span className="text-on-surface font-semibold">
              {activeData?.verification
                ? `${activeData.verification.serverDone}/${activeData.verification.serverTotal}`
                : `${activeData ? activeData.doneCount : 0}/${activeData ? activeData.items.length : 0}`}
            </span>
          </span>
          <span className="text-on-surface-variant">
            Credit đã nhận:{' '}
            <span className="text-on-surface font-semibold">{activeData ? activeData.creditsEarned : 0}</span>
          </span>
          {activeData && (
            <Badge
              variant={verificationBadgeConfig(activeData.verification?.state ?? 'missing').variant}
              label={verificationBadgeConfig(activeData.verification?.state ?? 'missing').label}
            />
          )}
        </div>

        {error && <p className="font-body-sm text-body-sm text-error">{error}</p>}

        {isLoading && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">Đang đọc tiến độ...</p>
        )}

        {!isLoading && !error && activeData && activeData.items.length === 0 && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Account này chưa chạy nhiệm vụ nào nên chưa có tiến độ.
          </p>
        )}

        {!isLoading && activeData && activeData.items.length > 0 && (
          <div className="border border-panel-border rounded overflow-hidden">
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead className="bg-surface-container-low text-on-surface-variant">
                <tr>
                  <th className="px-sm py-1.5 font-label-xs text-label-xs font-semibold">Nhiệm vụ</th>
                  <th className="px-sm py-1.5 font-label-xs text-label-xs font-semibold">Credit</th>
                  <th className="px-sm py-1.5 font-label-xs text-label-xs font-semibold">Trạng thái</th>
                  <th className="px-sm py-1.5 font-label-xs text-label-xs font-semibold">Bằng chứng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-border/70">
                {activeData.items.map((item) => (
                  <tr key={item.taskKey}>
                    <td className="px-sm py-1 text-on-surface">{item.title || item.taskKey}</td>
                    <td className="px-sm py-1 font-code text-on-surface-variant">{item.reward}</td>
                    <td className="px-sm py-1">
                      <Badge
                        variant={statusVariant(item.status)}
                        label={taskStatusLabel(item.status)}
                      />
                    </td>
                    <td className="px-sm py-1 font-code text-[11px] text-on-surface-variant">
                      {item.provedAt ? item.provedAt.replace('T', ' ').slice(0, 19) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};
