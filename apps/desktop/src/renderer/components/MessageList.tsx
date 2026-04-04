
import React, { useRef, useLayoutEffect, useState, useEffect, useCallback, useMemo, memo } from 'react';
import SimpleBar from 'simplebar-react';
import MessageBubble from './MessageBubble';
import 'simplebar-react/dist/simplebar.min.css';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import type { ToolCall, StreamChunk } from '../hooks/useAgent';
import { DiscoverTips } from '../workflows/components/DiscoverTips';
import { useDiscovery } from '../hooks/useDiscovery';
import { Shimmer } from './ai-elements/Shimmer';

// Performance constants
const INITIAL_MESSAGES_TO_RENDER = 10; // Start with last 10 messages
const MESSAGES_TO_LOAD_ON_SCROLL = 10; // Load 10 more when scrolling up

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

interface ContextPath {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  reasoningDuration?: number;
  toolCalls?: ToolCall[];
  streamChunks?: StreamChunk[];
  contextPaths?: ContextPath[];
  modifiedFiles?: string[];
  checkpointId?: string;
  reverted?: boolean;
}

interface MessageListProps {
  messages: Message[];
  currentResponse?: string;
  currentReasoning?: string;
  currentToolCalls?: ToolCall[];
  currentStreamChunks?: StreamChunk[];
  thinkingStartTime?: number;
  className?: string;
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onRevertFiles?: (messageId: string) => void;
  onRedoFiles?: (messageId: string) => void;
}

// Format seconds to human readable
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Inline thinking indicator with live timer (memoized for performance)
const ThinkingIndicator: React.FC<{
  startTime?: number;
  reasoning?: string;
}> = memo(({ startTime, reasoning }) => {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true); // Start expanded
  const [autoCollapsed, setAutoCollapsed] = useState(false); // Track if auto-collapsed
  const internalStartRef = useRef<number | null>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const autoCollapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hasReasoning = reasoning && reasoning.trim().length > 0;

  useEffect(() => {
    if (!internalStartRef.current) {
      internalStartRef.current = startTime || Date.now();
    }
    const interval = setInterval(() => {
      const start = internalStartRef.current || Date.now();
      setElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  // Auto-collapse after 4 seconds
  useEffect(() => {
    if (hasReasoning && expanded && !autoCollapsed) {
      autoCollapseTimeoutRef.current = setTimeout(() => {
        setExpanded(false);
        setAutoCollapsed(true);
      }, 4000); // 4 seconds
    }
    return () => {
      if (autoCollapseTimeoutRef.current) {
        clearTimeout(autoCollapseTimeoutRef.current);
      }
    };
  }, [hasReasoning, expanded, autoCollapsed]);

  // Auto-scroll reasoning when expanded
  useEffect(() => {
    if (expanded && reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning, expanded]);

  const toggleExpanded = () => {
    setExpanded(!expanded);
    // Clear any pending auto-collapse timeout when manually toggling
    if (autoCollapseTimeoutRef.current) {
      clearTimeout(autoCollapseTimeoutRef.current);
      autoCollapseTimeoutRef.current = null;
    }
  };

  return (
    <div className="flex flex-col items-start">
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors select-none pl-1"
        disabled={!hasReasoning}
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="inline-flex items-center gap-1.5 italic font-medium">
          <Shimmer as="span" duration={1.8} spread={3}>
            Planning next moves
          </Shimmer>
          <span className="text-neutral-400">{formatDuration(elapsed)}</span>
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
      </button>

      {/* Expanded reasoning preview */}
      <AnimatePresence initial={false}>
        {hasReasoning && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="w-full max-w-[90%] overflow-hidden mt-2 mb-3"
          >
            <div
              ref={reasoningRef}
              className="pl-3 border-l-2 border-violet-200/60 max-h-36 overflow-y-auto custom-scrollbar"
            >
              <div className="text-[12px] text-theme-muted leading-relaxed py-1 prose prose-sm max-w-none prose-p:my-1 prose-headings:text-theme-fg prose-headings:font-bold prose-headings:text-xs prose-code:text-primary prose-code:bg-theme-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-strong:text-theme-fg prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(reasoning || '')))}
                </ReactMarkdown>
                <span className="inline-block w-[2px] h-3 bg-violet-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// Memoized MessageBubble wrapper to prevent unnecessary re-renders
const MemoizedMessageBubble = memo(MessageBubble, (prevProps, nextProps) => {
  // Only re-render if these props actually changed
  return (
    prevProps.text === nextProps.text &&
    prevProps.role === nextProps.role &&
    prevProps.reasoning === nextProps.reasoning &&
    prevProps.reasoningDuration === nextProps.reasoningDuration &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.toolCalls === nextProps.toolCalls &&
    prevProps.streamChunks === nextProps.streamChunks &&
    prevProps.reverted === nextProps.reverted &&
    prevProps.messageId === nextProps.messageId
  );
});

// Load more button component
const LoadMoreButton: React.FC<{
  hiddenCount: number;
  onLoadMore: () => void;
  isLoading?: boolean;
}> = memo(({ hiddenCount, onLoadMore, isLoading }) => (
  <button
    onClick={onLoadMore}
    disabled={isLoading}
    className="flex items-center justify-center gap-2 w-full py-3 px-4 mb-3 rounded-xl bg-theme-hover/50 hover:bg-theme-hover border border-theme/20 text-theme-muted hover:text-theme-fg transition-all text-[12px] font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {isLoading ? (
      <Loader2 className="w-4 h-4 animate-spin" />
    ) : (
      <ChevronUp className="w-4 h-4" />
    )}
    <span>
      {isLoading ? 'Loading...' : `Load ${Math.min(hiddenCount, MESSAGES_TO_LOAD_ON_SCROLL)} more messages`}
    </span>
    {!isLoading && hiddenCount > MESSAGES_TO_LOAD_ON_SCROLL && (
      <span className="text-[10px] opacity-60">({hiddenCount} hidden)</span>
    )}
  </button>
));

const MessageList: React.FC<MessageListProps> = ({
  messages,
  currentResponse,
  currentReasoning,
  currentToolCalls,
  currentStreamChunks,
  thinkingStartTime,
  className,
  onSubmitToolOutput,
  onGenUIResponse,
  onEditMessage,
  onRevertFiles,
  onRedoFiles,
}) => {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topAnchorRef = useRef<HTMLDivElement>(null);

  // Discovery tips for thinking state
  const { getTipsForCarousel } = useDiscovery();
  const thinkingTips = useMemo(() => {
    const tips = getTipsForCarousel(4);
    return tips.map(t => ({ id: t.id, title: t.title, description: t.description }));
  }, []); // Static on mount to avoid reshuffling during thinking

  // Track how many messages to render (start from most recent)
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGES_TO_RENDER);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const prevScrollHeightRef = useRef<number>(0);
  const isLoadingMoreRef = useRef(false);

  // Calculate which messages to show (last N messages)
  const { visibleMessages, hiddenCount, startIndex } = useMemo(() => {
    const total = messages.length;
    const count = Math.min(visibleCount, total);
    const start = Math.max(0, total - count);
    return {
      visibleMessages: messages.slice(start),
      hiddenCount: start,
      startIndex: start,
    };
  }, [messages, visibleCount]);

  // Reset visible count when switching conversations (detected by message IDs changing)
  const firstMessageId = messages[0]?.id;
  useEffect(() => {
    setVisibleCount(INITIAL_MESSAGES_TO_RENDER);
    setUserHasScrolledUp(false);
  }, [firstMessageId]);

  // Load more messages handler
  const handleLoadMore = useCallback(() => {
    if (isLoadingMoreRef.current || hiddenCount === 0) return;

    setIsLoadingMore(true);
    isLoadingMoreRef.current = true;

    // Store current scroll height before loading more
    const scrollEl = scrollContainerRef.current?.querySelector('.simplebar-content-wrapper');
    if (scrollEl) {
      prevScrollHeightRef.current = scrollEl.scrollHeight;
    }

    // Small delay to show loading state
    requestAnimationFrame(() => {
      setVisibleCount(prev => prev + MESSAGES_TO_LOAD_ON_SCROLL);
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    });
  }, [hiddenCount]);

  // Preserve scroll position when loading more messages
  useEffect(() => {
    if (prevScrollHeightRef.current > 0) {
      const scrollEl = scrollContainerRef.current?.querySelector('.simplebar-content-wrapper');
      if (scrollEl) {
        const newScrollHeight = scrollEl.scrollHeight;
        const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
        scrollEl.scrollTop += scrollDiff;
        prevScrollHeightRef.current = 0;
      }
    }
  }, [visibleMessages.length]);

  // Detect when user scrolls up (to show load more)
  useEffect(() => {
    const scrollEl = scrollContainerRef.current?.querySelector('.simplebar-content-wrapper');
    if (!scrollEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl as HTMLElement;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

      // User has scrolled up if not at bottom
      if (!isAtBottom && scrollTop < 100 && hiddenCount > 0) {
        setUserHasScrolledUp(true);
      } else if (isAtBottom) {
        setUserHasScrolledUp(false);
      }
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [hiddenCount]);

  // Auto-scroll to bottom on new messages or streaming response (only if user hasn't scrolled up)
  useLayoutEffect(() => {
    if (!userHasScrolledUp) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages.length, currentResponse, currentReasoning, userHasScrolledUp]);

  // Also auto-scroll when new message arrives (last message changes)
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!userHasScrolledUp && lastMessageId) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [lastMessageId, userHasScrolledUp]);

  const isThinking = !!(currentReasoning && !currentResponse);

  return (
    <div className="relative h-full" ref={scrollContainerRef}>
      <SimpleBar className={className || "h-full no-drag custom-scrollbar px-3 py-2 select-text"}>
        <div className="flex flex-col pb-4 space-y-1">
          {/* Load more button when there are hidden messages */}
          {hiddenCount > 0 && (
            <LoadMoreButton
              hiddenCount={hiddenCount}
              onLoadMore={handleLoadMore}
              isLoading={isLoadingMore}
            />
          )}

          {/* Anchor for scroll position preservation */}
          <div ref={topAnchorRef} className="h-px" />

          {/* Only render visible messages */}
          {visibleMessages.map((m) => (
            <MemoizedMessageBubble
              key={m.id}
              role={m.role}
              text={m.text}
              reasoning={m.reasoning}
              reasoningDuration={m.reasoningDuration}
              toolCalls={m.toolCalls}
              streamChunks={m.streamChunks}
              contextPaths={m.contextPaths}
              onSubmitToolOutput={onSubmitToolOutput}
              onGenUIResponse={onGenUIResponse}
              messageId={m.id}
              onEditMessage={onEditMessage}
              modifiedFiles={m.modifiedFiles}
              checkpointId={m.checkpointId}
              reverted={m.reverted}
              onRevertFiles={onRevertFiles}
              onRedoFiles={onRedoFiles}
            />
          ))}
          {/* Streaming response with interleaved content */}
          {(currentResponse || (currentStreamChunks && currentStreamChunks.length > 0)) && (
            <MessageBubble
              key="streaming-response"
              role="assistant"
              text={currentResponse || ''}
              reasoning={currentReasoning}
              toolCalls={currentToolCalls}
              streamChunks={currentStreamChunks}
              isStreaming
              onSubmitToolOutput={onSubmitToolOutput}
              onGenUIResponse={onGenUIResponse}
            />
          )}
          {/* Thinking indicator when reasoning but no response/chunks yet */}
          {isThinking && !(currentStreamChunks && currentStreamChunks.length > 0) && (
            <div className="flex w-full justify-start mb-5">
              <div className="max-w-[90%] px-1">
                <ThinkingIndicator
                  startTime={thinkingStartTime}
                  reasoning={currentReasoning}
                />
                {/* Discovery tips while AI is thinking */}
                {thinkingTips.length > 0 && (
                  <div className="mt-3">
                    <DiscoverTips
                      tips={thinkingTips}
                      title="Did you know?"
                      compact
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={endRef} className="h-px" />
        </div>
      </SimpleBar>
    </div>
  );
};

export default MessageList;
