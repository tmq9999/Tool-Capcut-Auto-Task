import React from 'react';
import { Modal } from '@renderer/components/ui/Modal';
import { Button } from '@renderer/components/ui/Button';
import { AlertTriangle } from 'lucide-react';

export interface DeleteAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => void;
  selectedCount: number;
  isDeleting?: boolean;
}

export const DeleteAccountDialog: React.FC<DeleteAccountDialogProps> = ({
  isOpen,
  onClose,
  onConfirmDelete,
  selectedCount,
  isDeleting = false,
}) => {
  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={onClose} disabled={isDeleting}>
        Hủy
      </Button>
      <Button
        variant="danger"
        size="md"
        disabled={isDeleting}
        onClick={onConfirmDelete}
      >
        {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Xác nhận xóa tài khoản"
      footer={footer}
      maxWidth="sm"
    >
      <div className="flex items-start gap-3 py-2">
        <div className="p-2 rounded bg-error/10 text-error shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <p className="text-on-surface font-medium">
            Bạn có chắc chắn muốn xóa {selectedCount} tài khoản đã chọn?
          </p>
          <p className="text-on-surface-variant text-xs">
            Hành động này không thể hoàn tác. Dữ liệu tài khoản sẽ bị xóa khỏi danh sách.
          </p>
        </div>
      </div>
    </Modal>
  );
};
