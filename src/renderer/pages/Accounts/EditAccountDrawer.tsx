import React, { useState, useEffect } from 'react';
import { Drawer } from '@renderer/components/ui/Drawer';
import { Button } from '@renderer/components/ui/Button';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { Textarea } from '@renderer/components/ui/Textarea';
import { Account, AccountStatus } from '@shared/types/account';

export interface EditAccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  onSaveAccount: (updatedAccount: Account) => Promise<boolean> | void;
}

export const EditAccountDrawer: React.FC<EditAccountDrawerProps> = ({
  isOpen,
  onClose,
  account,
  onSaveAccount,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [provider, setProvider] = useState('Gmail');
  const [proxy, setProxy] = useState('');
  const [browserProfile, setBrowserProfile] = useState('');
  const [status, setStatus] = useState<AccountStatus>('active');
  const [fullData, setFullData] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (account && isOpen) {
      setEmail(account.email || '');
      setPassword(account.password || '');
      setEmailPassword(account.emailPassword || '');
      setProvider(account.provider || 'Gmail');
      setProxy(account.proxy || '');
      setBrowserProfile(account.browserProfile || '');
      setStatus(account.status || 'active');
      setFullData(account.fullData || '');
      setNotes(account.notes || '');
    }
  }, [account, isOpen]);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const outcome = await onSaveAccount({
        ...account,
        email,
        password,
        emailPassword,
        provider,
        proxy,
        browserProfile,
        status,
        fullData,
        notes,
        updatedAt: 'Just now',
      });

      if (outcome !== false) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={handleClose} type="button" disabled={isSubmitting}>
        Hủy
      </Button>
      <Button variant="primary" size="md" onClick={handleSubmit} type="button" disabled={isSubmitting}>
        {isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
      </Button>
    </>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Chỉnh sửa tài khoản"
      subtitle={`Cập nhật thông tin cho ${account?.email || ''}`}
      footer={footer}
      width="md"
    >
      <form onSubmit={handleSubmit} className="space-y-md">
        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-md">
          <div className="space-y-1">
            {/* Cột #2 của bản xuất (AGENTS §21). Để trống = giữ mật khẩu đang lưu. */}
            <label className="font-label-xs text-label-xs text-on-surface-variant">
              Password CapCut
            </label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="font-label-xs text-label-xs text-on-surface-variant">
              Password hộp thư
            </label>
            <Input
              type="password"
              placeholder="••••••••"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-md">
          <div className="space-y-1">
            <label className="font-label-xs text-label-xs text-on-surface-variant">Trạng thái</label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as AccountStatus)}
            >
              <option value="active">Hoạt động</option>
              <option value="processing">Đang xử lý</option>
              <option value="waiting">Waiting</option>
              <option value="done">Done</option>
              <option value="error">Lỗi</option>
              <option value="disabled">Đã tắt</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="font-label-xs text-label-xs text-on-surface-variant">Provider</label>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="Gmail">Gmail</option>
              <option value="Outlook">Outlook</option>
              <option value="Yahoo">Yahoo</option>
              <option value="Proton">Proton</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Browser / Profile</label>
          <Input
            value={browserProfile}
            onChange={(e) => setBrowserProfile(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Proxy</label>
          <Input
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            fontMono
          />
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Full Data</label>
          <Textarea
            value={fullData}
            onChange={(e) => setFullData(e.target.value)}
            className="min-h-[70px]"
          />
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Ghi chú</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </Drawer>
  );
};
