import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  controlSize?: 'sm' | 'md';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, controlSize = 'md', children, ...props }, ref) => {
    const sizeStyles = {
      sm: 'h-control_height_sm text-body-sm pl-2.5 pr-7 py-0',
      md: 'h-control_height_md text-body-sm pl-3 pr-8 py-0',
    };

    return (
      <div className="relative flex items-center w-full">
        <select
          ref={ref}
          className={twMerge(
            clsx(
              'w-full bg-surface border border-panel-border rounded text-on-surface appearance-none outline-none cursor-pointer transition-all',
              'focus:border-primary focus:ring-1 focus:ring-primary',
              sizeStyles[controlSize],
              className
            )
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2 w-4 h-4 text-on-surface-variant pointer-events-none" />
      </div>
    );
  }
);

Select.displayName = 'Select';
