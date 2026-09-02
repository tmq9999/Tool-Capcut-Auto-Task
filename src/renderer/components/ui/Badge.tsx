import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, CheckCircle2, AlertCircle, Clock, Bug, Circle } from 'lucide-react';

export type BadgeVariant =
  | 'running'
  | 'waiting'
  | 'done'
  | 'active'
  | 'processing'
  | 'error'
  | 'disabled'
  | 'debug'
  | 'info';

export interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  className?: string;
  showIcon?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant,
  label,
  className,
  showIcon = true,
}) => {
  const configs: Record<
    BadgeVariant,
    { text: string; bg: string; border: string; textColor: string; icon: React.ReactNode }
  > = {
    running: {
      text: 'Running',
      bg: 'bg-primary/20',
      border: 'border-primary/30',
      textColor: 'text-primary',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    processing: {
      text: 'Đang xử lý',
      bg: 'bg-warning/20',
      border: 'border-warning/30',
      textColor: 'text-warning',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    waiting: {
      text: 'Waiting',
      bg: 'bg-warning/20',
      border: 'border-warning/30',
      textColor: 'text-warning',
      icon: <Clock className="w-3 h-3" />,
    },
    done: {
      text: 'Done',
      bg: 'bg-success/20',
      border: 'border-success/30',
      textColor: 'text-success',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    active: {
      text: 'Hoạt động',
      bg: 'bg-success/15',
      border: 'border-success/25',
      textColor: 'text-success',
      icon: <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />,
    },
    error: {
      text: 'Error',
      bg: 'bg-error/20',
      border: 'border-error/30',
      textColor: 'text-error',
      icon: <AlertCircle className="w-3 h-3" />,
    },
    disabled: {
      text: 'Đã tắt',
      bg: 'bg-surface-variant/40',
      border: 'border-outline/40',
      textColor: 'text-on-surface-variant',
      icon: <Circle className="w-2 h-2 text-on-surface-variant fill-on-surface-variant/50" />,
    },
    debug: {
      text: 'DEBUG',
      bg: 'bg-secondary-container/40',
      border: 'border-secondary-container',
      textColor: 'text-on-secondary-container',
      icon: <Bug className="w-3 h-3" />,
    },
    info: {
      text: 'INFO',
      bg: 'bg-primary/15',
      border: 'border-primary/25',
      textColor: 'text-primary',
      icon: <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />,
    },
  };

  const config = configs[variant] || configs.info;
  const displayText = label ?? config.text;

  return (
    <div
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-label-xs text-label-xs select-none',
          config.bg,
          config.border,
          config.textColor,
          className
        )
      )}
    >
      {showIcon && config.icon}
      <span>{displayText}</span>
    </div>
  );
};
