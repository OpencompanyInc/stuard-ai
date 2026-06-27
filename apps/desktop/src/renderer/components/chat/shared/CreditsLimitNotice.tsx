import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Coins, X } from 'lucide-react';
import { clsx } from 'clsx';

export interface CreditsLimitNoticeProps {
  open: boolean;
  onDismiss: () => void;
  onAddCredits: () => void;
  className?: string;
}

export const CreditsLimitNotice: React.FC<CreditsLimitNoticeProps> = ({
  open,
  onDismiss,
  onAddCredits,
  className,
}) => (
  <AnimatePresence initial={false}>
    {open && (
      <motion.div
        key="credits-limit-notice"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.18 }}
        className={clsx('overflow-hidden', className)}
      >
        <div className="mx-1 mb-1 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 flex items-start gap-2.5">
          <Coins className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" strokeWidth={2} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-rose-300 leading-snug">Out of credits</p>
            <p className="text-[11px] text-theme-muted mt-0.5 leading-snug">
              Add credits to keep chatting. After purchasing, send a message — we&apos;ll refresh your balance automatically.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                type="button"
                onClick={onAddCredits}
                className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-[11px] font-bold text-black transition-colors"
              >
                Add credits
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 p-1 rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/50 transition-colors"
            aria-label="Dismiss out-of-credits notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);
