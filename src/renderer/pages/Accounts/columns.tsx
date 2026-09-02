import { ColumnDef } from '@tanstack/react-table';
import { Account } from '@shared/types/account';
import { Checkbox } from '@renderer/components/ui/Checkbox';
import { Badge } from '@renderer/components/ui/Badge';
import { Edit2, MoreVertical } from 'lucide-react';

export interface AccountsColumnsOptions {
  onEditAccount: (account: Account) => void;
  onDeleteAccount?: (account: Account) => void;
}

export const createAccountsColumns = (
  options: AccountsColumnsOptions
): ColumnDef<Account, unknown>[] => [
  {
    id: 'select',
    size: 40,
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
        />
      </div>
    ),
  },
  {
    accessorKey: 'stt',
    header: 'STT',
    size: 50,
    cell: (info) => (
      <span className="font-code text-on-surface-variant">
        {info.getValue<number>()}
      </span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: (info) => (
      <span className="font-medium text-on-surface select-text">{info.getValue<string>()}</span>
    ),
  },
  {
    accessorKey: 'password',
    header: 'Password',
    cell: () => <span className="font-code text-on-surface-variant">••••••••</span>,
  },
  {
    accessorKey: 'provider',
    header: 'Provider',
    cell: (info) => <span>{info.getValue<string>() || 'Gmail'}</span>,
  },
  {
    accessorKey: 'fullData',
    header: 'Full Data',
    cell: (info) => {
      const val = info.getValue<string>();
      return (
        <span
          className="text-on-surface-variant font-code text-[11px] truncate max-w-[120px] block"
          title={val}
        >
          {val || '-'}
        </span>
      );
    },
  },
  {
    accessorKey: 'proxy',
    header: 'Proxy',
    cell: (info) => {
      const proxy = info.getValue<string>();
      return (
        <span className="font-code text-[11px] text-on-surface select-text">
          {proxy || '-'}
        </span>
      );
    },
  },
  {
    accessorKey: 'browserProfile',
    header: 'Browser/Profile',
    cell: (info) => (
      <span className="text-on-surface">{info.getValue<string>() || '-'}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Trạng thái',
    size: 120,
    cell: (info) => {
      const status = info.getValue<Account['status']>();
      const badgeVariant =
        status === 'active'
          ? 'active'
          : status === 'processing'
          ? 'processing'
          : status === 'error'
          ? 'error'
          : status === 'disabled'
          ? 'disabled'
          : status === 'waiting'
          ? 'waiting'
          : 'done';

      return <Badge variant={badgeVariant} />;
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Ngày tạo',
    size: 100,
    cell: (info) => (
      <span className="font-code text-[11px] text-on-surface-variant">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: 'Cập nhật',
    size: 90,
    cell: (info) => (
      <span className="text-on-surface-variant text-[11px]">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'notes',
    header: 'Ghi chú',
    cell: (info) => {
      const notes = info.getValue<string>();
      return (
        <span className="text-on-surface-variant truncate max-w-[120px] block" title={notes}>
          {notes || '-'}
        </span>
      );
    },
  },
  {
    id: 'actions',
    header: () => <div className="text-right">Actions</div>,
    size: 80,
    cell: ({ row }) => (
      <div className="flex justify-end items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            options.onEditAccount(row.original);
          }}
          className="p-1 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
          title="Sửa tài khoản"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="p-1 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
  },
];
