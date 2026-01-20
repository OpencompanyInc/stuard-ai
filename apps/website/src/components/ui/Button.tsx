"use client";

import React, { forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const baseClasses =
  "inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-300 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "text-white gradient-primary hover:shadow-xl hover:scale-[1.02] focus-visible:outline-primary relative overflow-hidden",
  secondary:
    "bg-gray-900 text-white hover:bg-gray-800 focus-visible:outline-gray-900",
  outline:
    "text-primary border-2 border-primary hover:bg-primary hover:text-white focus-visible:outline-primary",
  ghost:
    "text-gray-700 hover:bg-gray-100 focus-visible:outline-primary",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  xl: "h-14 px-7 text-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "lg", isLoading = false, leftIcon, rightIcon, className = "", children, ...props },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={[
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          isLoading ? "pointer-events-none" : "",
          className,
        ].join(" ")}
        {...props}
      >
        {variant === 'primary' && !isLoading && (
          <div className="absolute inset-0 animate-shimmer pointer-events-none" />
        )}
        {isLoading ? (
          <span className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            <span>Loading…</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {leftIcon}
            <span>{children}</span>
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;








