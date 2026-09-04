import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Khoá riêng một ô — dùng cho lựa chọn app chưa hỗ trợ. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  /**
   * Khoá cả cụm.
   *
   * Audit 04/09/2026: component không có prop này, nên hai ô "Module" và "Nguồn
   * email" trên Dashboard vẫn bấm được giữa lúc đang chạy — đổi được cấu hình
   * của một lượt đang chạy là đổi sai thứ.
   */
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'sm',
  disabled = false,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      className={twMerge(
        clsx(
          'bg-surface-container-low p-[2px] rounded flex relative border border-panel-border/60 select-none',
          disabled && 'opacity-50',
          className
        )
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const isDisabled = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            disabled={isDisabled}
            aria-disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              onChange(option.value);
            }}
            className={clsx(
              'flex-1 transition-all rounded font-label-xs text-label-xs flex items-center justify-center',
              size === 'sm' ? 'h-[24px] px-2' : 'h-[28px] px-3',
              isDisabled && 'cursor-not-allowed',
              option.disabled && !disabled && 'opacity-50',
              isSelected
                ? 'bg-surface-container-high border border-panel-border text-on-surface shadow-sm font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
