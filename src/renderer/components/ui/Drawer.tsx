import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md',
  className,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthStyles = {
    sm: 'w-[320px]',
    md: 'w-[420px]',
    lg: 'w-[520px]',
    xl: 'w-[640px]',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div
          className={twMerge(
            clsx(
              'relative h-full bg-panel border-l border-panel-border shadow-2xl flex flex-col',
              widthStyles[width],
              className
            )
          )}
        >
          {/* Header */}
          <div className="p-md border-b border-panel-border flex items-center justify-between shrink-0 bg-surface-container-low">
            <div>
              {title && (
                <h3 className="font-title-md text-title-md font-semibold text-on-surface">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="font-label-xs text-label-xs text-on-surface-variant mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-md overflow-y-auto flex-1 font-body-sm text-body-sm text-on-surface space-y-md">
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="p-md border-t border-panel-border flex items-center justify-end gap-2 shrink-0 bg-surface-container-low">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
