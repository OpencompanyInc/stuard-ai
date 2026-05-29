import React, { useRef, useEffect, useMemo, memo, useState, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle, type Components } from 'react-virtuoso';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import MessageBubble from './MessageBubble/MessageBubble';
import { CornerDownRight } from 'lucide-react';
import type { ToolCall, StreamChunk } from '../../../../hooks/useAgent';
import type { ChatAttachment } from '../../../../utils/attachments';

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

interface MessageListProps {
  messages: Message[];
  currentResponse?: string;
  currentReasoning?: string;
  currentToolCalls?: ToolCall[];
  currentStreamChunks?: StreamChunk[];
  thinkingStartTime?: number;
  className?: string;
  /** Extra space at the bottom so the last messages can scroll above a floating composer. */
  scrollInsetBottom?: number;
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onRevertFiles?: (messageId: string) => void;
  onRedoFiles?: (messageId: string) => void;
}

// Sentinel id used for the live streaming bubble item. Kept stable so
// Virtuoso doesn't unmount/remount it across token ticks.
const STREAMING_ITEM_ID = '__streaming__';

/** Horizontal inset for message rows — Virtuoso ignores scroller padding. */
const CHAT_MESSAGE_GUTTER_PX = 20;

const VirtuosoList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function VirtuosoList({ style, children, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      className={clsx(className, 'box-border')}
      style={{
        ...style,
        paddingLeft: CHAT_MESSAGE_GUTTER_PX,
        paddingRight: CHAT_MESSAGE_GUTTER_PX,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
});

const virtuosoComponents: Components<VirtuosoItem> = {
  List: VirtuosoList,
};

interface VirtuosoItem {
  id: string;
  kind: 'message' | 'streaming';
  message?: Message;
  isSteer?: boolean;
  isNewSteer?: boolean;
}

// Memoized item renderer — Virtuoso calls this for each visible item. We pull
// the heavy MessageBubble work inside, and avoid recreating callbacks per
// render via a stable handlers prop.
interface ItemHandlers {
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onRevertFiles?: (messageId: string) => void;
  onRedoFiles?: (messageId: string) => void;
}

const MessageItem = memo(function MessageItem({
  item,
  streamingProps,
  handlers,
}: {
  item: VirtuosoItem;
  streamingProps?: {
    currentResponse?: string;
    currentReasoning?: string;
    currentToolCalls?: ToolCall[];
    currentStreamChunks?: StreamChunk[];
  };
  handlers: ItemHandlers;
}) {
  if (item.kind === 'streaming') {
    return (
      <MessageBubble
        role="assistant"
        text={streamingProps?.currentResponse || ''}
        reasoning={streamingProps?.currentReasoning}
        toolCalls={streamingProps?.currentToolCalls}
        streamChunks={streamingProps?.currentStreamChunks}
        isStreaming
        onSubmitToolOutput={handlers.onSubmitToolOutput}
        onGenUIResponse={handlers.onGenUIResponse}
      />
    );
  }

  const m = item.message!;
  const bubble = (
    <MessageBubble
      role={m.role}
      text={m.text}
      reasoning={m.reasoning}
      reasoningDuration={m.reasoningDuration}
      toolCalls={m.toolCalls}
      streamChunks={m.streamChunks}
      contextPaths={m.contextPaths}
      attachments={m.attachments}
      onSubmitToolOutput={handlers.onSubmitToolOutput}
      onGenUIResponse={handlers.onGenUIResponse}
      messageId={m.id}
      onEditMessage={handlers.onEditMessage}
      modifiedFiles={m.modifiedFiles}
      checkpointId={m.checkpointId}
      reverted={m.reverted}
      onRevertFiles={handlers.onRevertFiles}
      onRedoFiles={handlers.onRedoFiles}
    />
  );

  if (!item.isSteer) return bubble;

  return (
    <motion.div
      initial={item.isNewSteer ? { opacity: 0, y: 36, scale: 0.96 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={item.isNewSteer
        ? { type: 'spring', stiffness: 380, damping: 28, mass: 0.9 }
        : { duration: 0 }}
    >
      {!m.subagentTarget && (
        <div className="flex justify-end mb-1 pr-1">
          <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-widest text-primary/70">
            <CornerDownRight className="w-3 h-3" />
            Steered
          </span>
        </div>
      )}
      {bubble}
    </motion.div>
  );
}, (prev, next) => {
  // Both items must point at the same logical row.
  if (prev.item.id !== next.item.id) return false;
  if (prev.item.kind !== next.item.kind) return false;

  // Streaming bubble: re-render whenever any of the streaming inputs change,
  // since the assistant is mid-stream and content turns over per token.
  if (next.item.kind === 'streaming') {
    return (
      prev.streamingProps?.currentResponse === next.streamingProps?.currentResponse &&
      prev.streamingProps?.currentReasoning === next.streamingProps?.currentReasoning &&
      prev.streamingProps?.currentToolCalls === next.streamingProps?.currentToolCalls &&
      prev.streamingProps?.currentStreamChunks === next.streamingProps?.currentStreamChunks &&
      prev.handlers === next.handlers
    );
  }

  // Historical message: rely on the immutable Message object identity inside
  // tab.messages — when nothing about this row changed, the reference stays
  // stable and we can skip the bubble's reconciliation entirely.
  return (
    prev.item.message === next.item.message &&
    prev.item.isSteer === next.item.isSteer &&
    prev.item.isNewSteer === next.item.isNewSteer &&
    prev.handlers === next.handlers
  );
});

const MessageList: React.FC<MessageListProps> = ({
  messages,
  currentResponse,
  currentReasoning,
  currentToolCalls,
  currentStreamChunks,
  className,
  scrollInsetBottom = 0,
  onSubmitToolOutput,
  onGenUIResponse,
  onEditMessage,
  onRevertFiles,
  onRedoFiles,
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Track which steering messages have already been rendered so only newly
  // arriving ones fly up; historical steers (e.g. loading a saved
  // conversation) appear instantly.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstMessageId = messages[0]?.id;
  const lastFirstIdRef = useRef<string | undefined>(undefined);
  if (lastFirstIdRef.current !== firstMessageId) {
    seenIdsRef.current = new Set(messages.map(m => m.id));
    lastFirstIdRef.current = firstMessageId;
  }

  // Bundle handlers so MessageItem's memo can compare a single ref.
  const handlers = useMemo<ItemHandlers>(() => ({
    onSubmitToolOutput,
    onGenUIResponse,
    onEditMessage,
    onRevertFiles,
    onRedoFiles,
  }), [onSubmitToolOutput, onGenUIResponse, onEditMessage, onRevertFiles, onRedoFiles]);

  const showStreaming = Boolean(
    currentResponse ||
    currentReasoning ||
    (currentStreamChunks && currentStreamChunks.length > 0),
  );

  const items = useMemo<VirtuosoItem[]>(() => {
    const list: VirtuosoItem[] = messages.map((m) => {
      const isSteer = m.kind === 'steer'
        || (typeof m.id === 'string' && m.id.startsWith('steer-'));
      const isNewSteer = isSteer && !seenIdsRef.current.has(m.id);
      return {
        id: m.id,
        kind: 'message' as const,
        message: m,
        isSteer,
        isNewSteer,
      };
    });
    if (showStreaming) {
      list.push({ id: STREAMING_ITEM_ID, kind: 'streaming' });
    }
    return list;
  }, [messages, showStreaming]);

  // After rendering, mark newly seen ids so they don't replay the animation.
  useEffect(() => {
    messages.forEach((m) => seenIdsRef.current.add(m.id));
  }, [messages]);

  // Keep auto-scroll pinned only while the user stays near the bottom.
  // Virtuoso's atBottomStateChange is our source of truth.
  const handleAtBottomStateChange = useCallback((isAtBottom: boolean) => {
    setAtBottom(isAtBottom);
  }, []);

  const followOutput = useCallback(
    () => (atBottom ? 'auto' as const : false),
    [atBottom],
  );

  const streamingProps = useMemo(
    () => ({ currentResponse, currentReasoning, currentToolCalls, currentStreamChunks }),
    [currentResponse, currentReasoning, currentToolCalls, currentStreamChunks],
  );

  const itemContent = useCallback(
    (_index: number, item: VirtuosoItem) => (
      <div className="pb-1 w-full min-w-0 max-w-full box-border">
        <MessageItem
          item={item}
          streamingProps={item.kind === 'streaming' ? streamingProps : undefined}
          handlers={handlers}
        />
      </div>
    ),
    [streamingProps, handlers],
  );

  const computeItemKey = useCallback(
    (_index: number, item: VirtuosoItem) => item.id,
    [],
  );

  const ScrollFooter = useCallback(() => {
    if (!scrollInsetBottom || scrollInsetBottom <= 0) return null;
    return <div style={{ height: scrollInsetBottom }} aria-hidden />;
  }, [scrollInsetBottom]);

  const listComponents = useMemo<Components<VirtuosoItem>>(() => ({
    ...virtuosoComponents,
    Footer: ScrollFooter,
  }), [ScrollFooter]);

  const scrollerClass = `${className || 'h-full no-drag custom-scrollbar py-2 select-text'} min-w-0 max-w-full box-border overflow-x-clip`;

  return (
    <div className="relative h-full min-w-0 max-w-full overflow-x-clip">
      <Virtuoso
        ref={virtuosoRef}
        data={items}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
        followOutput={followOutput}
        atBottomStateChange={handleAtBottomStateChange}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        overscan={{ main: 600, reverse: 200 }}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        components={listComponents}
        className={scrollerClass}
        style={{
          height: '100%',
          overflowX: 'clip',
          ...(scrollInsetBottom > 0 ? { scrollPaddingBottom: scrollInsetBottom } : {}),
        }}
      />
    </div>
  );
};

export default MessageList;
