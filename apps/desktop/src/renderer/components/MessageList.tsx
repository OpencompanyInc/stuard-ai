
import React, { useRef, useLayoutEffect, useState, useEffect, useCallback, useMemo, memo } from 'react';
import SimpleBar from 'simplebar-react';
import { motion } from 'framer-motion';
import MessageBubble from './MessageBubble';
import 'simplebar-react/dist/simplebar.min.css';
import { ChevronUp, CornerDownRight, Loader2, Sparkles } from 'lucide-react';
import type { ToolCall, StreamChunk } from '../hooks/useAgent';
import { Shimmer } from './ai-elements/Shimmer';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from './ai-elements/ChainOfThought';
import type { ChatAttachment } from '../utils/attachments';

// Performance constants
const INITIAL_MESSAGES_TO_RENDER = 10; // Start with last 10 messages
const MESSAGES_TO_LOAD_ON_SCROLL = 10; // Load 10 more when scrolling up
const AUTO_SCROLL_BOTTOM_THRESHOLD = 80;

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
  attachments?: ChatAttachment[];
  modifiedFiles?: string[];
  checkpointId?: string;
  reverted?: boolean;
  kind?: 'message' | 'steer';
  subagentTarget?: { id: string; kind: string };
}

const humanizeSubagentKind = (kind: string) =>
  String(kind || 'subagent')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

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

// Chain-of-thought thinking indicator (matches window mode format)
const ThinkingIndicator: React.FC<{
  startTime?: number;
  reasoning?: string;
}> = memo(({ startTime, reasoning }) => {
  const [elapsed, setElapsed] = useState(0);
  const internalStartRef = useRef<number | null>(null);

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

  return (
    <ChainOfThought defaultOpen className="mb-3 mr-auto w-full max-w-[85%] md:max-w-[60%]">
      <ChainOfThoughtHeader>
        <Shimmer as="span" className="text-[13px] text-theme-muted" duration={1.8} spread={3}>
          Thinking… {formatDuration(elapsed)}
        </Shimmer>
      </ChainOfThoughtHeader>
      {hasReasoning && (
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            label={
              <Shimmer as="span" duration={2} spread={3}>Reasoning</Shimmer>
            }
            status="active"
            isLast
          >
            <div
              className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
              }}
            >
              {reasoning}
              <span className="inline-block w-[2px] h-3 bg-violet-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
            </div>
          </ChainOfThoughtStep>
        </ChainOfThoughtContent>
      )}
    </ChainOfThought>
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
    prevProps.attachments === nextProps.attachments &&
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

  // Track how many messages to render (start from most recent)
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGES_TO_RENDER);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
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
    setShouldAutoScroll(true);
  }, [firstMessageId]);

  // Track which steering messages have already been rendered so only newly arriving
  // ones fly up — historical steers (e.g. when loading a saved conversation) appear instantly.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastFirstIdRef = useRef<string | undefined>(undefined);
  if (lastFirstIdRef.current !== firstMessageId) {
    seenIdsRef.current = new Set(messages.map(m => m.id));
    lastFirstIdRef.current = firstMessageId;
  }
  useEffect(() => {
    visibleMessages.forEach(m => seenIdsRef.current.add(m.id));
  });

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

  // Keep auto-scroll pinned only while the user stays near the bottom.
  useEffect(() => {
    const scrollEl = scrollContainerRef.current?.querySelector('.simplebar-content-wrapper');
    if (!scrollEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl as HTMLElement;
      const isNearBottom =
        scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD;
      setShouldAutoScroll(isNearBottom);
    };

    handleScroll();
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll on new content only while the user is still following the live output.
  useLayoutEffect(() => {
    if (shouldAutoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [
    messages.length,
    currentResponse,
    currentReasoning,
    currentToolCalls,
    currentStreamChunks,
    shouldAutoScroll,
  ]);

  // Also auto-scroll when new message arrives (last message changes)
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (shouldAutoScroll && lastMessageId) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [lastMessageId, shouldAutoScroll]);

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
          {visibleMessages.map((m) => {
            const isSteer = m.kind === 'steer'
              || (typeof m.id === 'string' && m.id.startsWith('steer-'));
            const bubble = (
              <MemoizedMessageBubble
                role={m.role}
                text={m.text}
                reasoning={m.reasoning}
                reasoningDuration={m.reasoningDuration}
                toolCalls={m.toolCalls}
                streamChunks={m.streamChunks}
                contextPaths={m.contextPaths}
                attachments={m.attachments}
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
            );
            if (!isSteer) {
              return <React.Fragment key={m.id}>{bubble}</React.Fragment>;
            }
            const isNewSteer = !seenIdsRef.current.has(m.id);
            return (
              <motion.div
                key={m.id}
                initial={isNewSteer ? { opacity: 0, y: 36, scale: 0.96 } : false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={isNewSteer
                  ? { type: 'spring', stiffness: 380, damping: 28, mass: 0.9 }
                  : { duration: 0 }}
              >
                <div className="flex justify-end mb-1 pr-1">
                  {m.subagentTarget ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[9.5px] font-black uppercase tracking-widest border border-violet-500/15">
                      <Sparkles className="w-3 h-3" strokeWidth={2.5} />
                      Steered {humanizeSubagentKind(m.subagentTarget.kind)} agent
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-widest text-primary/70">
                      <CornerDownRight className="w-3 h-3" />
                      Steered
                    </span>
                  )}
                </div>
                {bubble}
              </motion.div>
            );
          })}
          {/* Streaming response with interleaved content (also triggers on reasoning for chain-of-thought) */}
          {(currentResponse || currentReasoning || (currentStreamChunks && currentStreamChunks.length > 0)) && (
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
          <div ref={endRef} className="h-px" />
        </div>
      </SimpleBar>
    </div>
  );
};

export default MessageList;
