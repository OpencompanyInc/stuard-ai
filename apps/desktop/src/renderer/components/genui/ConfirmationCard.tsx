import React, { useCallback } from 'react';
import { Check, X, AlertTriangle, AlertOctagon, Info, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import { RichText } from './RichText';

export interface ConfirmationCardProps {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'question';
  onConfirm: () => void;
  onCancel: () => void;
  isConfirmed?: boolean;
  isCancelled?: boolean;
}

export const ConfirmationCard: React.FC<ConfirmationCardProps> = ({
  title = 'Confirmation Required',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'warning',
  onConfirm,
  onCancel,
  isConfirmed,
  isCancelled
}) => {
  const isDone = isConfirmed || isCancelled;

  // Stop propagation to prevent triggering parent click handlers
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isDone) onConfirm();
  }, [isDone, onConfirm]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isDone) onCancel();
  }, [isDone, onCancel]);

  const icons = {
    danger: AlertOctagon,
    warning: AlertTriangle,
    info: Info,
    question: HelpCircle
  };

  const Icon = icons[variant];

  // Theme-aware styles with dark mode support
  const styles = {
    danger: "bg-red-500/10 border-red-500/20 dark:bg-red-500/15 dark:border-red-500/30",
    warning: "bg-amber-500/10 border-amber-500/20 dark:bg-amber-500/15 dark:border-amber-500/30",
    info: "bg-blue-500/10 border-blue-500/20 dark:bg-blue-500/15 dark:border-blue-500/30",
    question: "bg-violet-500/10 border-violet-500/20 dark:bg-violet-500/15 dark:border-violet-500/30"
  };

  const iconStyles = {
    danger: "bg-red-500/20 text-red-600 dark:text-red-400",
    warning: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
    info: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
    question: "bg-violet-500/20 text-violet-600 dark:text-violet-400"
  };

  const titleStyles = {
    danger: "text-red-700 dark:text-red-300",
    warning: "text-amber-700 dark:text-amber-300",
    info: "text-blue-700 dark:text-blue-300",
    question: "text-violet-700 dark:text-violet-300"
  };

  const buttonStyles = {
    danger: "bg-red-600 border-red-600 hover:bg-red-700 ring-red-500",
    warning: "bg-amber-500 border-amber-500 hover:bg-amber-600 ring-amber-500",
    info: "bg-blue-600 border-blue-600 hover:bg-blue-700 ring-blue-500",
    question: "bg-violet-600 border-violet-600 hover:bg-violet-700 ring-violet-500"
  };

  return (
    <div
      onClick={handleContainerClick}
      className={clsx(
        "w-full max-w-md rounded-xl border overflow-hidden shadow-sm my-3 transition-all",
        styles[variant],
        isDone && "opacity-70 pointer-events-none grayscale-[0.5]"
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={clsx(
            "p-2 rounded-lg shrink-0",
            iconStyles[variant]
          )}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={clsx(
              "font-medium mb-1",
              titleStyles[variant]
            )}>
              {title}
            </h3>

            <div className="text-sm text-theme-fg/80 leading-relaxed mb-4 prose-p:my-0">
              <RichText content={message} compact className="text-inherit" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={isDone}
                className={clsx(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2",
                  "bg-theme-card border-theme/20 text-theme-fg hover:bg-theme-hover hover:border-theme/30 shadow-sm",
                  isCancelled && "bg-theme-active ring-2 ring-theme/30"
                )}
              >
                {isCancelled && <Check className="w-3.5 h-3.5" />}
                {cancelLabel}
              </button>

              <button
                onClick={handleConfirm}
                disabled={isDone}
                className={clsx(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 shadow-sm text-white",
                  buttonStyles[variant],
                  isConfirmed && "ring-2 ring-offset-1 ring-offset-theme-bg"
                )}
              >
                {isConfirmed && <Check className="w-3.5 h-3.5" />}
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};



