import React from 'react';
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

  const icons = {
    danger: AlertOctagon,
    warning: AlertTriangle,
    info: Info,
    question: HelpCircle
  };

  const Icon = icons[variant];

  const styles = {
    danger: "bg-red-50 border-red-100",
    warning: "bg-amber-50 border-amber-100",
    info: "bg-blue-50 border-blue-100",
    question: "bg-violet-50 border-violet-100"
  };

  const iconStyles = {
    danger: "bg-red-100 text-red-600",
    warning: "bg-amber-100 text-amber-600",
    info: "bg-blue-100 text-blue-600",
    question: "bg-violet-100 text-violet-600"
  };

  const titleStyles = {
    danger: "text-red-900",
    warning: "text-amber-900",
    info: "text-blue-900",
    question: "text-violet-900"
  };

  const buttonStyles = {
    danger: "bg-red-600 border-red-600 hover:bg-red-700 ring-red-500",
    warning: "bg-amber-500 border-amber-500 hover:bg-amber-600 ring-amber-500",
    info: "bg-blue-600 border-blue-600 hover:bg-blue-700 ring-blue-500",
    question: "bg-violet-600 border-violet-600 hover:bg-violet-700 ring-violet-500"
  };

  return (
    <div className={clsx(
      "w-full max-w-md rounded-xl border overflow-hidden shadow-sm my-3 transition-all",
      styles[variant],
      isDone && "opacity-70 pointer-events-none grayscale-[0.5]"
    )}>
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
            
            <div className="text-sm text-neutral-700 leading-relaxed mb-4 prose-p:my-0">
              <RichText content={message} compact className="text-inherit" />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                disabled={isDone}
                className={clsx(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2",
                  "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 shadow-sm",
                  isCancelled && "bg-neutral-100 ring-2 ring-neutral-200"
                )}
              >
                {isCancelled && <Check className="w-3.5 h-3.5" />}
                {cancelLabel}
              </button>
              
              <button
                onClick={onConfirm}
                disabled={isDone}
                className={clsx(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2 shadow-sm text-white",
                  buttonStyles[variant],
                  isConfirmed && `ring-2 ring-offset-1`
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


