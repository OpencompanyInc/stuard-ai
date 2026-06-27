import React, { useCallback } from 'react';
import { Info, AlertTriangle, CheckCircle, AlertOctagon, Lightbulb, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { RichText } from './RichText';

export interface InfoCardProps {
  title: string;
  message: string;
  variant?: 'info' | 'warning' | 'success' | 'danger' | 'tip' | 'neutral';
  actionLabel?: string;
  onAction?: () => void;
  footer?: string;
}

const iconMap = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
  danger: AlertOctagon,
  tip: Lightbulb,
  neutral: Info
};

export const InfoCard: React.FC<InfoCardProps> = ({
  title,
  message,
  variant = 'info',
  actionLabel,
  onAction,
  footer
}) => {
  const Icon = iconMap[variant];

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleAction = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAction?.();
  }, [onAction]);

  // Theme-aware styles with dark mode support
  const styles = {
    info: "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300",
    warning: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300",
    success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    danger: "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300",
    tip: "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-300",
    neutral: "bg-theme-hover border-theme/20 text-theme-fg"
  };

  const iconStyles = {
    info: "text-blue-500",
    warning: "text-amber-500",
    success: "text-emerald-500",
    danger: "text-red-500",
    tip: "text-violet-500",
    neutral: "text-theme-muted"
  };

  return (
    <div
      onClick={handleContainerClick}
      className={clsx(
        "w-full max-w-2xl rounded-xl border p-4 my-3 transition-all",
        styles[variant]
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx("mt-0.5 shrink-0 p-1.5 bg-theme-card rounded-lg shadow-sm border border-theme/10", iconStyles[variant])}>
          <Icon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1">{title}</h3>

          <div className={clsx(
            "text-sm leading-relaxed opacity-90",
            "prose-p:my-0 prose-p:leading-relaxed"
          )}>
            <RichText content={message} compact className="text-inherit" />
          </div>

          {(actionLabel || footer) && (
            <div className="mt-4 flex items-center justify-between gap-4 pt-3 border-t border-theme/10">
              {footer ? (
                <span className="text-xs opacity-70 font-medium tracking-wide uppercase">
                  {footer}
                </span>
              ) : <div />}

              {actionLabel && (
                <button
                  onClick={handleAction}
                  className={clsx(
                    "text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5",
                    "bg-theme-card shadow-sm border border-theme/10 hover:bg-theme-hover active:scale-95",
                    iconStyles[variant]
                  )}
                >
                  {actionLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
