import React, { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useElapsedSecondsFine } from '../../../../../../hooks/useSharedTicker';
import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../../utils/text';
import { normalizeMarkdownSpacing } from '../helpers/markdown';

interface InlineReasoningBlockProps {
  content: string;
  isStreaming?: boolean;
  isLastReasoning?: boolean; // true if this is the last reasoning chunk (for live timer)
  finalDuration?: number; // For historical messages - final duration in seconds
}

// Inline reasoning block for streamChunks - collapsible with timer, auto-collapses
export const InlineReasoningBlock: React.FC<InlineReasoningBlockProps> = memo(({ content, isStreaming, isLastReasoning, finalDuration }) => {
  const [expanded, setExpanded] = useState(!!isStreaming); // Start collapsed for history
  const [autoCollapsed, setAutoCollapsed] = useState(!isStreaming); // Already collapsed for history
  const contentRef = useRef<HTMLDivElement>(null);
  const mountTimeRef = useRef(Date.now());
  const autoCollapseRef = useRef<NodeJS.Timeout | null>(null);
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(
    finalDuration != null ? finalDuration : null,
  );

  const tickerActive = Boolean(isStreaming && isLastReasoning && finalDuration == null && frozenElapsed == null);
  const liveElapsed = useElapsedSecondsFine(mountTimeRef.current, tickerActive);

  // Once streaming stops, freeze the final elapsed once and stop ticking.
  useEffect(() => {
    if (!isStreaming && isLastReasoning && finalDuration == null && frozenElapsed == null) {
      setFrozenElapsed((Date.now() - mountTimeRef.current) / 1000);
    }
  }, [isStreaming, isLastReasoning, finalDuration, frozenElapsed]);

  const elapsed = finalDuration != null
    ? finalDuration
    : frozenElapsed != null
      ? frozenElapsed
      : liveElapsed;

  // Auto-collapse after 3s once content starts flowing (only during streaming)
  useEffect(() => {
    if (isStreaming && content.length > 20 && expanded && !autoCollapsed) {
      autoCollapseRef.current = setTimeout(() => {
        setExpanded(false);
        setAutoCollapsed(true);
      }, 3000);
    }
    return () => { if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current); };
  }, [content, expanded, autoCollapsed, isStreaming]);

  // Auto-scroll when expanded
  useEffect(() => {
    if (expanded && contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, expanded, isStreaming]);

  const toggle = () => {
    setExpanded(e => !e);
    if (autoCollapseRef.current) {
      clearTimeout(autoCollapseRef.current);
      autoCollapseRef.current = null;
    }
  };

  const formatSec = (s: number) => {
    if (s < 60) return `${Math.floor(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  };

  // Use finalDuration for history, live elapsed for streaming
  const displayDuration = finalDuration || elapsed;
  const durationLabel = displayDuration > 0.5
    ? (isStreaming && isLastReasoning ? `Thinking ${formatSec(displayDuration)}` : `Thought for ${formatSec(displayDuration)}`)
    : (isStreaming && isLastReasoning ? 'Thinking...' : 'Reasoning');

  return (
    <div className="max-w-[85%] md:max-w-[55%] my-1">
      <button
        onClick={toggle}
        className="group flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors select-none"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="italic font-medium">{durationLabel}</span>
        {isStreaming && isLastReasoning && (
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              ref={contentRef}
              className="mt-1.5 pl-3 border-l-2 border-violet-200/60 max-h-36 overflow-y-auto custom-scrollbar"
            >
              <div className="text-[12px] text-neutral-400 leading-relaxed py-1 prose prose-sm max-w-none prose-p:my-1 prose-headings:text-neutral-300 prose-headings:font-bold prose-headings:text-xs prose-code:text-primary prose-code:bg-theme-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-strong:text-neutral-300 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(content)))}
                </ReactMarkdown>
                {isStreaming && isLastReasoning && (
                  <span className="inline-block w-[2px] h-3 bg-violet-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
