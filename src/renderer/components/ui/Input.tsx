import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  controlSize?: 'sm' | 'md';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fontMono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, controlSize = 'md', leftIcon, rightIcon, fontMono = false, ...props }, ref) => {
    const sizeStyles = {
      sm: 'h-control_height_sm text-body-sm px-2.5',
      md: 'h-control_height_md text-body-sm px-3',
    };

    return (
      <div className="relative flex items-center w-full">
        {leftIcon && (
          <div className="absolute left-2.5 flex items-center pointer-events-none text-on-surface-variant">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={twMerge(
            clsx(
              'w-full bg-surface border border-panel-border rounded text-on-surface placeholder:text-on-surface-variant outline-none transition-all',
              'focus:border-primary focus:ring-1 focus:ring-primary',
              fontMono && 'font-code text-code',
              leftIcon && 'pl-8',
              rightIcon && 'pr-8',
              sizeStyles[controlSize],
              className
            )
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-2.5 flex items-center text-on-surface-variant">
            {rightIcon}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
