import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { clsx } from 'clsx';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => confirmRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onCancel}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-theme/50 dark:border-transparent bg-theme-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              destructive ? 'bg-red-500/10 text-red-400' : 'bg-primary/10 text-primary',
            )}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-stuard text-[15px] font-semibold text-theme-fg">{title}</h3>
            {message && (
              <p className="mt-1 text-[12.5px] leading-snug text-theme-muted">{message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="-mr-1 -mt-1 rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover hover:text-theme-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-theme bg-theme-card px-4 py-1.5 text-[12px] font-medium text-theme-fg transition hover:bg-theme-hover"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={clsx(
              'rounded-full px-4 py-1.5 text-[12px] font-semibold transition',
              destructive
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-primary text-primary-fg hover:opacity-90',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Returns a `confirm` async function that opens a themed dialog and resolves to
 * true/false, plus the dialog element to render somewhere in the tree.
 *
 *   const [confirm, dialog] = useConfirm();
 *   ...
 *   if (await confirm({ title: 'Delete?', destructive: true })) doIt();
 *   return <>{dialog}{...}</>;
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  React.ReactElement | null,
] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setPending(prev => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      open
      {...pending.options}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return [confirm, dialog];
}

export default ConfirmDialog;
