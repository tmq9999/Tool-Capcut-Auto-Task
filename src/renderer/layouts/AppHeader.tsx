import React from 'react';
import { clsx } from 'clsx';

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  subtitle,
  actions,
  className,
}) => {
  return (
    <header
      className={clsx(
        'h-16 sticky top-0 z-40 border-b border-panel-border bg-panel flex items-center justify-between px-xl shrink-0 select-none',
        className
      )}
    >
      {/* Title and Subtitle */}
      <div>
        <h2 className="font-title-md text-title-md text-primary font-bold tracking-wide uppercase">
          {title}
        </h2>
        {subtitle && (
          <p className="font-label-xs text-label-xs text-on-surface-variant mt-0.5">
            {subtitle}
          </p>
        )}
      </div>

      {/* Page Actions Slot */}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
};
