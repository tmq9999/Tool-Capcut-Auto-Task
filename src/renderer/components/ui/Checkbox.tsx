import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, Minus } from 'lucide-react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, indeterminate = false, disabled, onChange, ...props }, ref) => {
    return (
      <label className={clsx('relative inline-flex items-center justify-center cursor-pointer select-none', disabled && 'opacity-40 cursor-not-allowed')}>
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="sr-only"
          {...props}
        />
        <div
          className={twMerge(
            clsx(
              'w-4 h-4 rounded border transition-colors flex items-center justify-center',
              checked || indeterminate
                ? 'bg-primary border-primary text-white'
                : 'bg-surface border-panel-border hover:border-outline text-transparent',
              className
            )
          )}
        >
          {indeterminate ? (
            <Minus className="w-3 h-3 stroke-[3]" />
          ) : checked ? (
            <Check className="w-3 h-3 stroke-[3]" />
          ) : null}
        </div>
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
