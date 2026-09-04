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
  loadTasks: (accountId: string) => Promise<AccountTasksResponseDTO | null>;
}

/** Tổng số nhiệm vụ của module free credits — dùng để hiện "x/12". */
const CAPCUT_TASK_TOTAL = 12;

function statusVariant(status: number): 'done' | 'waiting' | 'disabled' {
  if (status === CAPCUT_TASK_STATUS.DONE) return 'done';
  if (status === CAPCUT_TASK_STATUS.CLAIMABLE) return 'waiting';
  return 'disabled';
}

/**
 * Bảng tiến độ 12 nhiệm vụ của một account.
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
}) => {
  const [data, setData] = useState<AccountTasksResponseDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !accountId) return;
    let canceled = false;
    setIsLoading(true);
    setError(null);
    void loadTasks(accountId)
      .then((result) => {
        if (canceled) return;
        if (!result) {
          setError('Không đọc được tiến độ nhiệm vụ.');
          setData(null);
          return;
        }
        setData(result);
      })
      .finally(() => {
        if (!canceled) setIsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [isOpen, accountId, loadTasks]);

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
              {data ? data.doneCount : 0}/{CAPCUT_TASK_TOTAL}
            </span>
          </span>
          <span className="text-on-surface-variant">
            Credit đã nhận:{' '}
            <span className="text-on-surface font-semibold">{data ? data.creditsEarned : 0}</span>
          </span>
        </div>

        {error && <p className="font-body-sm text-body-sm text-error">{error}</p>}

        {isLoading && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">Đang đọc tiến độ...</p>
        )}

        {!isLoading && !error && data && data.items.length === 0 && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Account này chưa chạy nhiệm vụ nào nên chưa có tiến độ.
          </p>
        )}

        {!isLoading && data && data.items.length > 0 && (
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
                {data.items.map((item) => (
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
