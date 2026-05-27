import React, { useState, useEffect } from 'react';
import clsx from 'clsx';

interface SliderProps {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  value?: number;
  unit?: string;
  onChange?: (value: number) => void;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  min = 0,
  max = 100,
  step = 1,
  defaultValue,
  value,
  unit = '',
  onChange,
  disabled
}) => {
  const [localValue, setLocalValue] = useState(defaultValue ?? value ?? min);

  useEffect(() => {
    if (value !== undefined) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalValue(val);
    onChange?.(val);
  };

  return (
    <div className={clsx("w-full my-3 p-4 border border-theme/20 rounded-xl bg-theme-card", disabled && "opacity-60")}>
      <div className="flex justify-between items-center mb-3">
        {label && <label className="text-sm font-medium text-theme-fg">{label}</label>}
        <span className="text-sm font-mono text-theme-muted bg-theme-hover px-2 py-0.5 rounded">
          {localValue}{unit}
        </span>
      </div>
      <div className="relative w-full h-6 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue}
          onChange={handleChange}
          disabled={disabled}
          className="w-full h-2 bg-theme-hover rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="flex justify-between text-xs text-theme-muted mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
};



