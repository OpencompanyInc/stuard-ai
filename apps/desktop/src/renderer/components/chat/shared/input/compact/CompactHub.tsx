import React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp, Loader2 } from 'lucide-react';

import { CompactResponsePanel, hasCompactRichContent } from '../CompactResponsePanel';
import {
  COMPACT_OVERLAY_DROPDOWN_GAP,
} from './compactOverlayLayout';

export interface CompactHubTab {
  id: string;
  title: string;
  isWorking: boolean;
  statusText: string;
  userPrompt?: string;
  assistantText?: string;
  isStreaming?: boolean;
}

interface CompactHubProps {
  /** Quick-response panel open above the pill. */
  expanded: boolean;
  /** Collapsed peek strip visible behind the pill. */
  showPeek: boolean;
  backgroundTaskCount?: number;
  tabs: CompactHubTab[];
  activeTabId?: string;
  onPeekClick: () => void;
  onClose: () => void;
  onExpand: () => void;
  userPrompt?: string;
  userAttachments?: readonly import('../../../../../utils/attachments').ChatAttachment[];
  assistantText?: string;
  isStreaming?: boolean;
  isAiWorking?: boolean;
  reasoningText?: string;
  toolCalls?: ReadonlyArray<{ id: string; tool: string; status: 'called' | 'running' | 'completed' | 'error' }>;
  translucentMode?: boolean;
  /** Distance from window edge to input bar — anchors the portaled panel. */
  inputBarHeight?: number;
  /** Where overlays grow from relative to the input bar. */
  placement?: 'top' | 'bottom';
  onQuickResponseHeightChange?: (height: number) => void;
  children: React.ReactNode;
}

const PEEK_HEIGHT = 44;
const PEEK_OVERLAP = 34;

/**
 * Wraps the compact pill — peek strip half-hidden behind it; expand opens the
 * original CompactResponsePanel quick-response card above the input bar.
 */
export const CompactHub: React.FC<CompactHubProps> = ({
  expanded,
  showPeek,
  backgroundTaskCount = 0,
  tabs,
  activeTabId,
  onPeekClick,
  onClose,
  onExpand,
  userPrompt = '',
  userAttachments = [],
  assistantText = '',
  isStreaming = false,
  isAiWorking = false,
  reasoningText = '',
  toolCalls,
  translucentMode = false,
  inputBarHeight = 88,
  placement = 'top',
  onQuickResponseHeightChange,
  children,
}) => {
  const active = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const workingCount = tabs.filter((t) => t.isWorking).length;
  const replyText = assistantText || active?.assistantText || '';
  const richReply = hasCompactRichContent(replyText, toolCalls);

  const peekLabel =
    backgroundTaskCount > 0
      ? `${backgroundTaskCount} active task${backgroundTaskCount === 1 ? '' : 's'}`
      : workingCount > 0
        ? `${workingCount} running`
        : richReply && !isStreaming
          ? 'Interactive reply — open full view'
          : isStreaming
            ? richReply
              ? 'Building UI…'
              : 'View response'
            : active?.title || 'View response';

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 420 }}>
      {/* Quick-response panel — portaled + fixed so it stays centered in the window */}
      {typeof document !== 'undefined' && document.body && createPortal(
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="compact-quick-response"
              className="fixed z-[99999] inset-x-0 flex justify-center no-drag pointer-events-none"
              style={{
                bottom: placement === 'top' ? inputBarHeight : 'auto',
                top: placement === 'bottom' ? inputBarHeight - COMPACT_OVERLAY_DROPDOWN_GAP : 'auto',
                paddingLeft: 10,
                paddingRight: 10,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <motion.div
                className="pointer-events-auto no-drag w-full max-w-[372px]"
                data-compact-hit-area="true"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <CompactResponsePanel
                  userPrompt={userPrompt}
                  userAttachments={userAttachments}
                  assistantText={assistantText}
                  isStreaming={isStreaming}
                  isAiWorking={isAiWorking}
                  reasoningText={reasoningText}
                  toolCalls={toolCalls}
                  onExpand={onExpand}
                  onCollapse={onClose}
                  translucentMode={translucentMode}
                  onMeasuredHeightChange={onQuickResponseHeightChange}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Pill + peek stack */}
      <div className="relative w-full">
        <AnimatePresence initial={false}>
          {showPeek && !expanded && (
            <div
              className="absolute left-1/2 w-1/2 -translate-x-1/2"
              style={{
                bottom: `calc(100% - ${PEEK_OVERLAP}px)`,
                height: PEEK_HEIGHT,
                zIndex: 0,
              }}
            >
              <motion.button
                key="compact-hub-peek"
                type="button"
                onClick={onPeekClick}
                className={clsx(
                  'group w-full h-full flex items-center gap-2 px-3',
                  'rounded-t-[18px] border border-b-0 cursor-pointer',
                  'transition-[color,background-color,border-color] duration-200 ease-out',
                  'hover:bg-pill-fg/[0.03]',
                  (backgroundTaskCount > 0 || workingCount > 0)
                    ? 'hover:border-[#FF383C]/30'
                    : 'hover:border-pill-fg/22',
                )}
                style={{
                  background: 'rgb(var(--compact-pill-bg))',
                  borderColor: 'rgb(var(--compact-pill-fg) / 0.12)',
                  boxShadow: 'var(--compact-pill-shadow)',
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                whileHover={{
                  y: -3,
                  boxShadow:
                    backgroundTaskCount > 0 || workingCount > 0
                      ? '0 -8px 28px rgba(255, 56, 60, 0.18), 0 4px 16px rgba(15, 23, 42, 0.12)'
                      : '0 -6px 22px rgba(15, 23, 42, 0.14), var(--compact-pill-shadow)',
                }}
                whileTap={{ y: -1, scale: 0.985 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                title="View response"
              >
                {(backgroundTaskCount > 0 || workingCount > 0) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF383C] animate-pulse shrink-0 transition-transform duration-200 group-hover:scale-125" />
                )}
                <span className="flex-1 text-[11px] font-medium text-pill-fg/85 truncate transition-colors duration-200 group-hover:text-pill-fg">
                  {peekLabel}
                </span>
                {(active?.isWorking || isStreaming) && (
                  <Loader2 className="w-3 h-3 animate-spin text-[#FF383C] shrink-0" strokeWidth={2.5} />
                )}
                <ChevronUp
                  className={clsx(
                    'w-3.5 h-3.5 shrink-0 transition-all duration-200',
                    'text-pill-fg/50 group-hover:text-[#FF383C]/75 group-hover:-translate-y-0.5',
                  )}
                  strokeWidth={2}
                />
              </motion.button>
            </div>
          )}
        </AnimatePresence>

        <div className="relative" style={{ zIndex: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default CompactHub;

/** Visible strip height when peek is shown (peek height minus overlap). */
export const COMPACT_HUB_PEEK_VISIBLE = PEEK_HEIGHT - PEEK_OVERLAP;
