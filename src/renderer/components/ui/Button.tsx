import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'surface';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', icon, children, disabled, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-label-md transition-all select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none rounded gap-1.5';

    const sizeStyles = {
      sm: 'h-control_height_sm px-2.5 text-label-xs',
      md: 'h-control_height_md px-3.5 text-label-md',
    };

    const variantStyles = {
      primary: 'bg-primary text-white font-bold hover:brightness-110 active:brightness-90 shadow-sm',
      secondary:
        'bg-transparent border border-outline-variant text-on-surface hover:bg-surface-container-low hover:border-outline',
      surface: 'bg-surface border border-panel-border text-on-surface hover:bg-surface-container-high',
      ghost: 'bg-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low',
      danger:
        'bg-transparent border border-error/40 text-error hover:bg-error/10 hover:border-error/60',
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}
        {...props}
      >
        {icon}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
