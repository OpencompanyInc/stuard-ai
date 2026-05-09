import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import SimpleBar from 'simplebar-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';

function normalizeMarkdownSpacing(input: string): string {
  const raw = String(input || '').replace(/\r\n/g, '\n');
  const parts = raw.split('```');
  const normalized = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    return part
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  });
  return normalized.join('```');
}

interface ReasoningEntry {
  id: string;
  text: string;
  isStreaming?: boolean;
  duration?: number; // in seconds
}

interface ReasoningPanelProps {
  isOpen: boolean;
  onClose: () => void;
  entries: ReasoningEntry[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  streamingText?: string;
  isCurrentlyThinking?: boolean;
  thinkingStartTime?: number;
}

// Format seconds to human readable
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

export const ReasoningPanel: React.FC<ReasoningPanelProps> = ({
  isOpen,
  onClose,
  entries,
  currentIndex,
  onNavigate,
  streamingText,
  isCurrentlyThinking,
  thinkingStartTime,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Track elapsed time
  useEffect(() => {
    if (!isCurrentlyThinking) return;
    const start = thinkingStartTime || Date.now();
    const interval = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isCurrentlyThinking, thinkingStartTime]);

  // Auto-scroll when streaming
  useEffect(() => {
    if (streamingText && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingText]);

  const currentEntry = entries[currentIndex];
  const displayText = streamingText || currentEntry?.text || '';
  const totalCount = streamingText && !entries.find(e => e.isStreaming) ? entries.length + 1 : entries.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - subtle click-away */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="absolute top-0 right-0 bottom-0 w-80 z-50 flex flex-col bg-[#1a1a1e]/95 backdrop-blur-xl border-l border-white/[0.08] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] italic text-white/50">
                  {isCurrentlyThinking 
                    ? `Thinking for ${formatDuration(elapsed)}`
                    : currentEntry?.duration 
                      ? `Thought for ${formatDuration(currentEntry.duration)}`
                      : 'Reasoning'
                  }
                </span>
                {isCurrentlyThinking && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Navigation - show if there are multiple entries */}
            {totalCount > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] bg-white/[0.02]">
                <button
                  onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="p-1 rounded hover:bg-white/[0.08] text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-[11px] font-medium text-white/40">
                  {currentIndex + 1} of {totalCount}
                </span>
                <button
                  onClick={() => onNavigate(Math.min(totalCount - 1, currentIndex + 1))}
                  disabled={currentIndex >= totalCount - 1}
                  className="p-1 rounded hover:bg-white/[0.08] text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            {/* Content - greyed out text */}
            <SimpleBar className="flex-1 min-h-0">
              <div ref={scrollRef} className="p-4">
                {displayText ? (
                  <div className="text-[12px] text-white/40 leading-relaxed font-light prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px] prose-strong:text-white/60 prose-em:text-white/50">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    >
                      {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(displayText)))}
                    </ReactMarkdown>
                    {isCurrentlyThinking && (
                      <span className="inline-block w-[2px] h-3.5 bg-white/40 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle" />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-white/20">
                    <span className="text-xs italic">No reasoning available</span>
                  </div>
                )}
              </div>
            </SimpleBar>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * Inline thinking indicator with elapsed time - shows in message flow
 */
export const ThinkingIndicator: React.FC<{
  isThinking: boolean;
  onClick: () => void;
  startTime?: number;
  text?: string;
}> = ({ isThinking, onClick, startTime, text }) => {
  const [elapsed, setElapsed] = useState(0);
  const internalStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isThinking) return;
    if (!internalStartRef.current) {
      internalStartRef.current = startTime || Date.now();
    }
    const interval = setInterval(() => {
      const start = internalStartRef.current || Date.now();
      setElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isThinking, startTime]);

  if (!isThinking) return null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      onClick={onClick}
      className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/50 transition-colors cursor-pointer select-none"
    >
      <span className="italic">Thinking for {formatDuration(elapsed)}</span>
      <span className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />
    </motion.button>
  );
};

export default ReasoningPanel;
