import React, { useState } from 'react';
import { Drawer } from '@renderer/components/ui/Drawer';
import { Button } from '@renderer/components/ui/Button';
import { Input } from '@renderer/components/ui/Input';
import { Select } from '@renderer/components/ui/Select';
import { Textarea } from '@renderer/components/ui/Textarea';
import { Account } from '@shared/types/account';

export interface AddAccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAccount: (account: Omit<Account, 'id' | 'stt'>) => void;
}

export const AddAccountDrawer: React.FC<AddAccountDrawerProps> = ({
  isOpen,
  onClose,
  onAddAccount,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [provider, setProvider] = useState('Gmail');
  const [proxy, setProxy] = useState('');
  const [browserProfile, setBrowserProfile] = useState('Multilogin / Auto');
  const [fullData, setFullData] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    onAddAccount({
      email,
      password,
      emailPassword,
      provider,
      proxy,
      browserProfile,
      fullData,
      notes,
      status: 'active',
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: 'Just now',
      credit: 0,
      subscription: 'Free',
    });

    // Reset and close
    setEmail('');
    setPassword('');
    setEmailPassword('');
    setProxy('');
    setFullData('');
    setNotes('');
    onClose();
  };

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={onClose} type="button">
        Hủy
      </Button>
      <Button variant="primary" size="md" onClick={handleSubmit} type="button">
        Thêm tài khoản
      </Button>
    </>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Thêm tài khoản mới"
      subtitle="Nhập thông tin tài khoản và cấu hình proxy/browser"
      footer={footer}
      width="md"
    >
      <form onSubmit={handleSubmit} className="space-y-md">
        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Email (*)</label>
          <Input
            type="email"
            placeholder="example@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-md">
          <div className="space-y-1">
            {/* Cột #2 của bản xuất (AGENTS §21) — trước đây không màn hình nào nhập được. */}
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
            <label className="font-label-xs text-label-xs text-on-surface-variant">Email Provider</label>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="Gmail">Gmail</option>
              <option value="Outlook">Outlook</option>
              <option value="Yahoo">Yahoo</option>
              <option value="Proton">Proton</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="font-label-xs text-label-xs text-on-surface-variant">Browser / Profile</label>
            <Select value={browserProfile} onChange={(e) => setBrowserProfile(e.target.value)}>
              <option value="Multilogin / Auto">Multilogin / Auto</option>
              <option value="GPM / Auto">GPM / Auto</option>
              <option value="Camoufox / Auto">Camoufox / Auto</option>
              <option value="Patchright / Auto">Patchright / Auto</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">
            Proxy (IP:PORT:USER:PASS)
          </label>
          <Input
            placeholder="192.168.1.1:8080:user:pass"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            fontMono
          />
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Full Data (JSON / Cookies)</label>
          <Textarea
            placeholder='{"cookies": "...", "recovery": "..."}'
            value={fullData}
            onChange={(e) => setFullData(e.target.value)}
            className="min-h-[70px]"
          />
        </div>

        <div className="space-y-1">
          <label className="font-label-xs text-label-xs text-on-surface-variant">Ghi chú</label>
          <Input
            placeholder="Ghi chú thêm..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </Drawer>
  );
};
