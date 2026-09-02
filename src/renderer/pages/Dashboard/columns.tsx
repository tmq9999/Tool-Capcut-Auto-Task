import { ColumnDef } from '@tanstack/react-table';
import { Square } from 'lucide-react';
import { Checkbox } from '@renderer/components/ui/Checkbox';
import { Badge } from '@renderer/components/ui/Badge';
import type { AccountListItemDTO } from '@shared/schemas/account.schema';

export interface DashboardColumnsOptions {
  /** True while this account still holds a live browser. */
  isThreadRunning: (accountId: string) => boolean;
  /** Stops only this row browser. */
  onStopThread: (accountId: string) => void;
}

const STATUS_TO_BADGE: Record<AccountListItemDTO['status'], 'done' | 'running' | 'waiting' | 'error'> = {
  active: 'done',
  done: 'done',
  processing: 'running',
  waiting: 'waiting',
  error: 'error',
  disabled: 'error',
};

export function createDashboardColumns(
  options: DashboardColumnsOptions
): ColumnDef<AccountListItemDTO, unknown>[] {
  return [
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
    id: 'stt',
    header: 'STT',
    size: 50,
    cell: ({ row }) => (
      <span className="font-code text-on-surface-variant">
        {String(row.index + 1).padStart(2, '0')}
      </span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: (info) => <span className="font-medium text-on-surface">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'hasPasswordCapcut',
    header: 'Password',
    size: 100,
    cell: (info) => (
      <span className="font-code text-on-surface-variant tracking-wider">
        {info.getValue<boolean>() ? '••••••••' : '-'}
      </span>
    ),
  },
  {
    accessorKey: 'hasEmailData',
    header: 'Full Data',
    size: 100,
    cell: (info) => (
      <span className="font-code text-on-surface-variant tracking-wider">
        {info.getValue<boolean>() ? '••••••••' : '-'}
      </span>
    ),
  },
  {
    accessorKey: 'proxy',
    header: 'Proxy',
    cell: (info) => (
      <span className="font-code text-[11px] text-on-surface-variant">
        {info.getValue<string | null>() || '-'}
      </span>
    ),
  },
  {
    id: 'browser',
    header: 'Browser',
    cell: ({ row }) => {
      const label = [row.original.browserProvider, row.original.browserProfileId]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' / ');
      return <span className="text-[11px]">{label || '-'}</span>;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 110,
    cell: (info) => (
      <Badge variant={STATUS_TO_BADGE[info.getValue<AccountListItemDTO['status']>()] ?? 'info'} />
    ),
  },
  {
    accessorKey: 'automationStep',
    header: 'Bước',
    size: 170,
    cell: (info) => {
      const step = info.getValue<string | null>();
      return (
        <span className="text-[11px] text-on-surface-variant truncate block max-w-[160px]" title={step ?? ''}>
          {step || '-'}
        </span>
      );
    },
  },
  {
    id: 'actions',
    header: () => <div className="text-right">Điều khiển</div>,
    size: 90,
    cell: ({ row }) => {
      const isRunning = options.isThreadRunning(row.original.id);
      return (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!isRunning}
            title={
              isRunning
                ? 'Dừng riêng browser của luồng này'
                : 'Luồng này không có browser đang chạy'
            }
            onClick={() => options.onStopThread(row.original.id)}
            className={
              'flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ' +
              (isRunning
                ? 'border-error/30 text-error hover:bg-error/10 cursor-pointer'
                : 'border-panel-border text-on-surface-variant/40 cursor-not-allowed')
            }
          >
            <Square className="w-3 h-3" />
            <span>Dừng</span>
          </button>
        </div>
      );
    },
  },
  ];
}
