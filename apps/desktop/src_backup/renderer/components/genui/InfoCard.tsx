import React from 'react';
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

  const styles = {
    info: "bg-blue-50 border-blue-100 text-blue-900",
    warning: "bg-amber-50 border-amber-100 text-amber-900",
    success: "bg-emerald-50 border-emerald-100 text-emerald-900",
    danger: "bg-red-50 border-red-100 text-red-900",
    tip: "bg-violet-50 border-violet-100 text-violet-900",
    neutral: "bg-neutral-50 border-neutral-200 text-neutral-900"
  };

  const iconStyles = {
    info: "text-blue-500",
    warning: "text-amber-500",
    success: "text-emerald-500",
    danger: "text-red-500",
    tip: "text-violet-500",
    neutral: "text-neutral-500"
  };

  return (
    <div className={clsx(
      "w-full max-w-2xl rounded-xl border p-4 my-3 transition-all",
      styles[variant]
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx("mt-0.5 shrink-0 p-1.5 bg-white rounded-lg shadow-sm border border-transparent", iconStyles[variant])}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1">{title}</h3>
          
          <div className={clsx(
            "text-sm leading-relaxed opacity-90",
            // Inherit text color but allow RichText to style internals
            "prose-p:my-0 prose-p:leading-relaxed"
          )}>
            <RichText content={message} compact className="text-inherit" />
          </div>

          {(actionLabel || footer) && (
            <div className="mt-4 flex items-center justify-between gap-4 pt-3 border-t border-black/5">
              {footer ? (
                <span className="text-xs opacity-70 font-medium tracking-wide uppercase">
                  {footer}
                </span>
              ) : <div />}
              
              {actionLabel && (
                <button
                  onClick={onAction}
                  className={clsx(
                    "text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5",
                    "bg-white shadow-sm border border-black/5 hover:bg-black/5 active:scale-95",
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
