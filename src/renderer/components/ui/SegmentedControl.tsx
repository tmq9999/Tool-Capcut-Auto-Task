import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'sm',
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      className={twMerge(
        clsx(
          'bg-surface-container-low p-[2px] rounded flex relative border border-panel-border/60 select-none',
          className
        )
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex-1 transition-all rounded font-label-xs text-label-xs flex items-center justify-center',
              size === 'sm' ? 'h-[24px] px-2' : 'h-[28px] px-3',
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
