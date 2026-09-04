import React from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  RowSelectionState,
  OnChangeFn,
  Row,
} from '@tanstack/react-table';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface DataGridProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  getRowId?: (originalRow: TData, index: number) => string;
  onRowClick?: (row: Row<TData>) => void;
  isLoading?: boolean;
  emptyText?: string;
  className?: string;
  tableClassName?: string;
  rowClassName?: (row: Row<TData>) => string;
  stickyHeader?: boolean;
  /**
   * Cắt trang ngay trong lưới. Không truyền thì hiện hết `data` như cũ.
   *
   * Audit 04/09/2026: trang Accounts có thanh phân trang nhưng lưới KHÔNG cắt gì
   * (`getPaginationRowModel` chưa từng được thêm) và nhận nguyên mảng đã lọc —
   * bấm ‹ › chỉ đổi nhãn "1-50 trong N", bảng đứng yên.
   */
  pagination?: { pageIndex: number; pageSize: number };
  /**
   * Ref tới chính khung cuộn của lưới. Trang Logs cần nó cho "Auto Scroll":
   * ô tích đó trước đây chỉ đổi state, không có một dòng code cuộn nào.
   */
  scrollRef?: React.Ref<HTMLDivElement>;
}

export function DataGrid<TData>({
  data,
  columns,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  onRowClick,
  isLoading = false,
  emptyText = 'Không có dữ liệu',
  className,
  tableClassName,
  rowClassName,
  stickyHeader = true,
  pagination,
  scrollRef,
}: DataGridProps<TData>): React.JSX.Element {
  const table = useReactTable({
    data,
    columns,
    state: {
      rowSelection: rowSelection ?? {},
      ...(pagination ? { pagination } : {}),
    },
    enableRowSelection: Boolean(onRowSelectionChange),
    onRowSelectionChange,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  return (
    <div
      ref={scrollRef}
      className={twMerge(
        'w-full h-full overflow-auto bg-table-bg relative custom-scrollbar flex flex-col',
        className
      )}
    >
      <table className={twMerge('w-full text-left border-collapse whitespace-nowrap', tableClassName)}>
        <thead
          className={clsx(
            'bg-panel border-b border-panel-border shrink-0',
            stickyHeader && 'sticky top-0 z-10 shadow-[0_1px_0_#29313C]'
          )}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  className="px-sm py-2 font-label-xs text-label-xs text-on-surface-variant font-semibold select-none"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>

        <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-panel-border/70">
          {isLoading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="p-8 text-center text-on-surface-variant font-body-sm"
              >
                Đang tải dữ liệu...
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="p-8 text-center text-on-surface-variant font-body-sm"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => {
              const isSelected = row.getIsSelected();
              const customClass = rowClassName ? rowClassName(row) : '';

              return (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={clsx(
                    'h-[36px] transition-colors bg-table-bg hover:bg-surface-container-low select-none',
                    isSelected && 'bg-primary/10 border-l-2 border-l-primary',
                    onRowClick && 'cursor-pointer',
                    customClass
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-sm py-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
