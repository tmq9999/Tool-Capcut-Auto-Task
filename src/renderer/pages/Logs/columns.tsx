import { ColumnDef } from '@tanstack/react-table';
import { RuntimeLog } from '@shared/types/log';
import { Badge } from '@renderer/components/ui/Badge';

export const logsColumns: ColumnDef<RuntimeLog, unknown>[] = [
  {
    accessorKey: 'time',
    header: 'TIME',
    size: 90,
    cell: (info) => (
      <span className="font-code text-on-surface-variant text-[11px]">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'EMAIL',
    size: 240,
    cell: (info) => {
      const email = info.getValue<string>();
      return (
        <span
          className={`font-code text-[11px] select-text ${
            email === 'system' ? 'text-on-surface-variant' : 'text-primary font-medium'
          }`}
        >
          {email}
        </span>
      );
    },
  },
  {
    accessorKey: 'step',
    header: 'STEP',
    size: 140,
    cell: (info) => (
      <span className="font-code text-[11px] text-on-surface font-medium">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'STATUS',
    size: 100,
    cell: (info) => {
      const status = info.getValue<RuntimeLog['status']>();
      const badgeVariant =
        status === 'SUCCESS'
          ? 'done'
          : status === 'ERROR'
          ? 'error'
          : status === 'WAITING' || status === 'WARNING'
          ? 'waiting'
          : status === 'DEBUG'
          ? 'debug'
          : 'info';

      return <Badge variant={badgeVariant} label={status} showIcon={false} />;
    },
  },
  {
    accessorKey: 'message',
    header: 'MESSAGE',
    cell: (info) => {
      const msg = info.getValue<string>();
      return (
        <span className="font-code text-[11px] text-on-surface select-text">
          {msg}
        </span>
      );
    },
  },
];
