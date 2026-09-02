import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  controlSize?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
}

export const NumberStepper: React.FC<NumberStepperProps> = ({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  controlSize = 'md',
  className,
  disabled = false,
}) => {
  const handleDecrement = () => {
    if (value - step >= min) {
      onChange(value - step);
    }
  };

  const handleIncrement = () => {
    if (value + step <= max) {
      onChange(value + step);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed >= min && parsed <= max) {
      onChange(parsed);
    } else if (e.target.value === '') {
      onChange(min);
    }
  };

  const heightClass = controlSize === 'sm' ? 'h-control_height_sm text-xs' : 'h-control_height_md text-sm';
  const btnPadding = controlSize === 'sm' ? 'px-2' : 'px-3';

  return (
    <div
      className={twMerge(
        clsx(
          'flex items-center border border-panel-border rounded overflow-hidden bg-surface transition-all focus-within:border-primary',
          disabled && 'opacity-40 pointer-events-none',
          className
        )
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={handleDecrement}
        className={clsx(
          heightClass,
          btnPadding,
          'bg-surface hover:bg-surface-container-highest transition-colors font-code border-r border-panel-border text-on-surface select-none active:bg-surface-container-high'
        )}
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        min={min}
        max={max}
        className={clsx(
          heightClass,
          'w-full text-center bg-transparent border-none font-code outline-none focus:ring-0 p-0 text-on-surface [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        )}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={handleIncrement}
        className={clsx(
          heightClass,
          btnPadding,
          'bg-surface hover:bg-surface-container-highest transition-colors font-code border-l border-panel-border text-on-surface select-none active:bg-surface-container-high'
        )}
      >
        +
      </button>
    </div>
  );
};
