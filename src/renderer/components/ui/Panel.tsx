import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, title, icon, headerAction, noPadding = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          clsx(
            'bg-panel border border-panel-border rounded-lg flex flex-col',
            !noPadding && 'p-md',
            className
          )
        )}
        {...props}
      >
        {(title || headerAction) && (
          <div className="flex items-center justify-between gap-2 mb-sm pb-1 shrink-0">
            {title && (
              <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2 font-semibold">
                {icon && <span className="text-primary flex items-center">{icon}</span>}
                <span>{title}</span>
              </h3>
            )}
            {headerAction && <div className="flex items-center gap-2">{headerAction}</div>}
          </div>
        )}
        {children}
      </div>
    );
  }
);

Panel.displayName = 'Panel';
