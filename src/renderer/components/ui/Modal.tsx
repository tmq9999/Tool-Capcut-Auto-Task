import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 'md',
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

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Box */}
      <div
        className={twMerge(
          clsx(
            'relative w-full bg-panel border border-panel-border rounded-lg shadow-2xl z-10 flex flex-col max-h-[90vh] overflow-hidden',
            maxWidthStyles[maxWidth],
            className
          )
        )}
      >
        {/* Header */}
        {(title || subtitle) && (
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
        )}

        {/* Content */}
        <div className="p-md overflow-y-auto flex-1 font-body-sm text-body-sm text-on-surface">
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
  );
};
