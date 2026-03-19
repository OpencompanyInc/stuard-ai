import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import MessageList from '../MessageList';
import { ContextItem } from '../FileNavigator';
import type { ChatMode, ChatModelsConfig } from '../../hooks/usePreferences';
import { useModelRegistry } from '../../hooks/useModelRegistry';
import { ChatTabs } from './ChatTabs';
import { ChatHeaderActions } from './ChatHeaderActions';
import { ChatInputArea } from './ChatInputArea';
import { FileNavigatorOverlay } from './FileNavigatorOverlay';

interface ChatViewProps {
  messages: any[];
  currentResponse?: string;
  currentReasoning?: string;
  currentToolCalls?: any[];
  currentStreamChunks?: any[];
  thinkingStartTime?: number;
  contextPaths: ContextItem[];
  onRemoveContext: (index: number) => void;
  onAddContext?: (item: ContextItem) => void;
  onCollapse: () => void;
  onOpenDashboard: () => void;
  onNewChat: () => void;

  overlayMode?: 'compact' | 'sidebar' | 'window';

  // Sidebar
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;

  // Input Props
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  isRecording?: boolean;
  onMicClick?: () => void;

  // Attachments
  attachments?: Array<{ type: 'image' | 'file'; name: string }>;
  onRemoveAttachment?: (index: number) => void;
  onAttachFiles?: () => void;
  onAttachImages?: () => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;

  // Queue
  queueDepth?: number;
  queuedMessages?: any[];

  // History Props
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  onDeleteConversation?: (id: string) => void;

  // Status/Model
  statusText?: string;
  modelName?: string;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';

  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  chatModels?: ChatModelsConfig;
  onChatModelsChange?: (cfg: ChatModelsConfig) => void;

  // Tabs
  tabs?: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;

  // GenUI
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;

  // Translucent mode
  translucentMode?: boolean;
}

const ChatViewInner: React.FC<ChatViewProps> = ({
  messages,
  currentResponse,
  currentReasoning,
  currentToolCalls,
  currentStreamChunks,
  thinkingStartTime,
  contextPaths,
  onRemoveContext,
  onAddContext,
  onCollapse,
  onOpenDashboard,
  onNewChat,
  overlayMode = 'compact',
  onToggleSidebar,
  sidebarOpen,
  query,
  setQuery,
  onSend,
  isRecording,
  onMicClick,
  conversations,
  loadingConversations,
  onSelectConversation,
  chatMenuOpen,
  onChatMenuOpenChange,
  onDeleteConversation,
  statusText = 'Online',
  modelName = '',
  connectionStatus = 'connected',
  chatMode = 'auto',
  onChatModeChange,
  chatModels,
  onChatModelsChange,
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSubmitToolOutput,
  onGenUIResponse,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAttachImages,
  onDrop,
  queueDepth = 0,
  queuedMessages = [],
  translucentMode = false
}) => {
  const selectedModelId: string | 'auto' = (typeof chatMode === 'string' && chatMode.trim()) ? (chatMode.trim() as any) : 'auto';
  const { modelById } = useModelRegistry();

  const selectedModelLabel = (() => {
    if (selectedModelId === 'auto') return 'Auto';
    const m = modelById.get(selectedModelId);
    return m ? m.name : selectedModelId;
  })();

  const displayModelName = (() => {
    const serverChosen = (modelName || '').trim();
    if (selectedModelId === 'auto') {
      if (serverChosen) return `Auto • ${serverChosen}`;
      return 'Auto';
    }
    return selectedModelLabel;
  })();

  // --- File Navigator State (@ context) ---
  const [showFileNav, setShowFileNav] = useState(false);
  const [fileNavFilter, setFileNavFilter] = useState("");
  const fileNavDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [fileNavOverlay, setFileNavOverlay] = useState<null | {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
    width: number;
  }>(null);

  const updateFileNavOverlayPos = useCallback(() => {
    if (!showFileNav) return;
    const el = textareaRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = 320;
    const margin = 10;
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - width - margin),
    );

    let placement: 'top' | 'bottom' = 'top';
    let top = rect.top - 10;
    if (rect.top < 320) {
      placement = 'bottom';
      top = rect.bottom + 10;
    }

    setFileNavOverlay({ left, top, placement, width });
  }, [showFileNav]);

  useEffect(() => {
    if (fileNavDebounceRef.current) {
      clearTimeout(fileNavDebounceRef.current);
    }

    fileNavDebounceRef.current = setTimeout(() => {
      const lastAt = query.lastIndexOf("@");
      if (lastAt === -1) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      const afterAt = query.substring(lastAt + 1);
      if (afterAt.length === 0) {
        const charBefore = lastAt > 0 ? query[lastAt - 1] : " ";
        if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
          setShowFileNav(true);
          setFileNavFilter("");
        } else {
          setShowFileNav(false);
          setFileNavFilter("");
        }
        return;
      }
      if (/\s/.test(afterAt)) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      const charBefore = lastAt > 0 ? query[lastAt - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
        setShowFileNav(true);
        setFileNavFilter(afterAt);
      } else {
        setShowFileNav(false);
        setFileNavFilter("");
      }
    }, 100);

    return () => {
      if (fileNavDebounceRef.current) {
        clearTimeout(fileNavDebounceRef.current);
      }
    };
  }, [query]);

  const handleFileSelect = useCallback((item: ContextItem) => {
    const lastAt = query.lastIndexOf("@");
    if (lastAt >= 0) {
      setQuery(query.substring(0, lastAt).trimEnd());
    }
    onAddContext?.(item);
    setShowFileNav(false);
    setFileNavFilter("");
  }, [query, setQuery, onAddContext]);

  const handleNavigate = useCallback((path: string) => {
    const lastAt = query.lastIndexOf("@");
    if (lastAt >= 0) {
      setQuery(query.substring(0, lastAt + 1) + path);
    }
  }, [query, setQuery]);

  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();

    const handler = () => updateFileNavOverlayPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [showFileNav, updateFileNavOverlayPos]);

  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();
  }, [showFileNav, fileNavFilter, updateFileNavOverlayPos]);

  return (
    <>
      <FileNavigatorOverlay
        showFileNav={showFileNav}
        fileNavOverlay={fileNavOverlay}
        fileNavFilter={fileNavFilter}
        onSelect={handleFileSelect}
        onClose={() => setShowFileNav(false)}
        onNavigate={handleNavigate}
      />
      <div className="flex flex-col h-full bg-transparent gap-4 relative font-sans">
        {/* Top Card: Header & Messages */}
        <div
          className={clsx(
            "flex-1 flex flex-col rounded-[28px] overflow-hidden relative transition-all duration-300",
            translucentMode
              ? "bg-white/25 backdrop-blur-2xl border border-white/20"
              : "bg-[#E3E3E3]"
          )}
          style={translucentMode ? undefined : { background: 'var(--stuard-card-bg, #E3E3E3)' }}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-2 py-2 border-b border-black/5 bg-white/40 backdrop-blur-sm">
            <ChatTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onSwitchTab={onSwitchTab}
              onCloseTab={onCloseTab}
              onAddTab={onAddTab}
            />
            <ChatHeaderActions
              onToggleSidebar={onToggleSidebar}
              sidebarOpen={sidebarOpen}
              onOpenDashboard={onOpenDashboard}
              onCollapse={onCollapse}
              overlayMode={overlayMode}
              chatMenuOpen={chatMenuOpen}
              onChatMenuOpenChange={onChatMenuOpenChange}
              conversations={conversations}
              loadingConversations={loadingConversations}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={onDeleteConversation}
            />
          </div>

          {/* Secondary Header: Context Pills */}
          {contextPaths.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-white/20 border-b border-black/5 overflow-x-auto scrollbar-hidden">
              {contextPaths.map((ctx, idx) => (
                <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 bg-white/60 rounded-full shadow-sm text-[11px] text-neutral-700 border border-black/5 whitespace-nowrap">
                  <span className="truncate max-w-[120px]">{ctx.name}</span>
                  <button
                    onClick={() => onRemoveContext(idx)}
                    className="hover:bg-black/5 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3 text-neutral-500" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-hidden relative">
            <MessageList
              messages={messages}
              currentResponse={currentResponse}
              currentReasoning={currentReasoning}
              currentToolCalls={currentToolCalls}
              currentStreamChunks={currentStreamChunks}
              thinkingStartTime={thinkingStartTime}
              className="h-full px-5 py-4 scrollbar-hidden"
              onSubmitToolOutput={onSubmitToolOutput}
              onGenUIResponse={onGenUIResponse}
            />
          </div>
        </div>

        {/* Bottom Card: Status & Input */}
        <ChatInputArea
          query={query}
          setQuery={setQuery}
          onSend={onSend}
          isRecording={isRecording}
          onMicClick={onMicClick}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onAttachFiles={onAttachFiles}
          onAttachImages={onAttachImages}
          onDrop={onDrop}
          queueDepth={queueDepth}
          queuedMessages={queuedMessages}
          statusText={statusText}
          connectionStatus={connectionStatus}
          displayModelName={displayModelName}
          translucentMode={translucentMode}
          showFileNav={showFileNav}
          textareaRef={textareaRef}
          selectedModelId={selectedModelId}
          onChatModeChange={onChatModeChange}
          activeTabId={activeTabId}
        />
      </div>
    </>
  );
};

export const ChatView = memo(ChatViewInner);

