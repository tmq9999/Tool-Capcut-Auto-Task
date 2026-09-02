import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'surface' | 'secondary' | 'danger';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = 'md', variant = 'ghost', children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded transition-all select-none active:scale-95 disabled:opacity-40 disabled:pointer-events-none';

    const sizeStyles = {
      sm: 'w-7 h-7 text-[16px]',
      md: 'w-8 h-8 text-[18px]',
    };

    const variantStyles = {
      ghost: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low',
      surface: 'bg-surface border border-panel-border text-on-surface hover:bg-surface-container-high',
      secondary: 'border border-outline-variant text-on-surface hover:bg-surface-container-low',
      danger: 'text-on-surface-variant hover:text-error hover:bg-error/10',
    };

    return (
      <button
        ref={ref}
        className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
