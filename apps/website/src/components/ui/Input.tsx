"use client";

import React, { forwardRef, useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label?: string;
}

const baseInput =
  "w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors bg-white placeholder:text-gray-500";

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, hint, label, id, className = "", ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || props.name || generatedId;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={[baseInput, error ? "border-red-300 focus:ring-red-500" : "", className].join(" ")}
          aria-invalid={!!error}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-gray-500">
            {hint}
          </p>
        )}
        {error && (
          <p className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;








