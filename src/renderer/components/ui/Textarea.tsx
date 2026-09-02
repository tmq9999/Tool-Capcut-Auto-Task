import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  fontMono?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, fontMono = true, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={twMerge(
          clsx(
            'w-full p-2.5 bg-surface border border-panel-border rounded text-on-surface resize-none outline-none transition-all',
            'placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary',
            fontMono ? 'font-code text-code' : 'font-body-sm text-body-sm',
            className
          )
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
