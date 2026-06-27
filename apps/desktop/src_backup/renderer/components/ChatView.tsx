import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import MessageList from './MessageList';
import { ContextItem, FileNavRef } from './FileNavigator';
import type { ChatMode, ChatModelsConfig } from '../hooks/usePreferences';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { ChatTabs } from './chat-view/ChatTabs';
import { ChatHeaderActions } from './chat-view/ChatHeaderActions';
import { ChatInputArea } from './chat-view/ChatInputArea';
import { FileNavigatorOverlay } from './chat-view/FileNavigatorOverlay';
import { SubAgentsView } from './SubAgentsView';

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

  // Sidebar
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;

  // Input Props
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
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

  // Layout mode for responsive styling
  overlayMode?: 'compact' | 'expanded' | 'sidebar' | 'window';

  // Tabs
  tabs?: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;

  // GenUI
  onSubmitToolOutput?: (id: string, result: any) => void;

  // Pending memory approvals
  pendingMemories?: Array<{
    id: string;
    original_text: string;
    proposed_action: string;
    proposed_key?: string;
    proposed_value: string;
    confidence_reason: string;
    entity_name?: string;
    created_at: string;
    status: string;
  }>;
  onConfirmPendingMemory?: (id: string) => void;
  onRejectPendingMemory?: (id: string) => void;

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
  onToggleSidebar,
  sidebarOpen,
  query,
  setQuery,
  onSend,
  onStop,
  isStreaming,
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
  overlayMode = 'expanded',
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSubmitToolOutput,
  pendingMemories = [],
  onConfirmPendingMemory,
  onRejectPendingMemory,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAttachImages,
  onDrop,
  queueDepth = 0,
  queuedMessages = [],
  translucentMode = false
}) => {
  // Responsive layout based on overlay mode
  const isSidebarMode = overlayMode === 'sidebar';
  const isWindowMode = overlayMode === 'window';
  const selectedModelId: string | 'auto' = (typeof chatMode === 'string' && chatMode.trim()) ? (chatMode.trim() as any) : 'auto';
  const { modelById } = useModelRegistry();
  
  // View Mode State (Chat vs Tasks)
  const [viewMode, setViewMode] = useState<'chat' | 'tasks'>('chat');

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
  const fileNavRef = useRef<FileNavRef>(null);

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
    const margin = 10;
    // Match input width, max 600px
    const width = Math.min(Math.max(320, rect.width), 600);
    
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - width - margin),
    );

    let placement: 'top' | 'bottom' = 'top';
    let top = rect.top - 10;
    if (rect.top < 340) {
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
        ref={fileNavRef}
        showFileNav={showFileNav}
        fileNavOverlay={fileNavOverlay}
        fileNavFilter={fileNavFilter}
        onSelect={handleFileSelect}
        onClose={() => setShowFileNav(false)}
        onNavigate={handleNavigate}
      />
      <div className={clsx(
        "flex flex-col h-full bg-transparent relative font-sans smooth-resize",
        isSidebarMode ? "gap-2" : "gap-4"
      )}>
        {/* Top Card: Header & Messages */}
        <div
          className={clsx(
            "flex-1 flex flex-col overflow-hidden relative transition-all duration-300",
            isSidebarMode ? "rounded-[16px]" : "rounded-[28px]",
            translucentMode
              ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
              : "bg-theme-card border border-theme/50"
          )}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-2 py-2 border-b border-theme/10 bg-theme-hover/40 backdrop-blur-sm">
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
              chatMenuOpen={chatMenuOpen}
              onChatMenuOpenChange={onChatMenuOpenChange}
              conversations={conversations}
              loadingConversations={loadingConversations}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={onDeleteConversation}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          </div>

          {/* Pending memories (overlay-only; compact UI) */}
          {viewMode === 'chat' && Array.isArray(pendingMemories) && pendingMemories.length > 0 && (
            <div className="px-4 py-2 border-b border-theme/10 bg-amber-500/10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[11px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Pending memory
                </div>
                <div className="text-[10px] font-bold text-amber-700/70 dark:text-amber-300/70">
                  {pendingMemories.length} item(s)
                </div>
              </div>
              <div className="space-y-2">
                {pendingMemories.slice(0, 3).map((pm) => (
                  <div key={pm.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-theme-card/70 border border-theme/10">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-theme-fg truncate">
                        {pm.proposed_action}{pm.proposed_key ? `:${pm.proposed_key}` : ''}
                      </div>
                      <div className="text-[11px] text-theme-muted mt-0.5 line-clamp-2">
                        {pm.proposed_value}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 text-[10px] font-black uppercase tracking-widest border border-emerald-500/20"
                        onClick={() => onConfirmPendingMemory?.(pm.id)}
                      >
                        Keep
                      </button>
                      <button
                        className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-[10px] font-black uppercase tracking-widest border border-red-500/20"
                        onClick={() => onRejectPendingMemory?.(pm.id)}
                      >
                        No
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Secondary Header: Context Pills */}
          {viewMode === 'chat' && contextPaths.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-theme-active/20 border-b border-theme/10 overflow-x-auto scrollbar-hidden">
              {contextPaths.map((ctx, idx) => (
                <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-card rounded-full text-[11px] text-theme-fg font-bold border border-theme/10 whitespace-nowrap">
                  <span className="truncate max-w-[120px]">{ctx.name}</span>
                  <button
                    onClick={() => onRemoveContext(idx)}
                    className="hover:bg-theme-hover rounded-full p-0.5 transition-colors"
                  >
                    <X className="w-3 h-3 text-theme-muted" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages or Tasks View */}
          <div className="flex-1 overflow-hidden relative">
            {viewMode === 'tasks' ? (
              <div className="h-full overflow-y-auto custom-scrollbar p-2">
                <SubAgentsView compact parentId={conversations.find(c => c.id === messages[0]?.conversation_id)?.id} />
              </div>
            ) : (
              <MessageList
                messages={messages}
                currentResponse={currentResponse}
                currentReasoning={currentReasoning}
                currentToolCalls={currentToolCalls}
                currentStreamChunks={currentStreamChunks}
                thinkingStartTime={thinkingStartTime}
                className="h-full px-5 py-4 custom-scrollbar"
                onSubmitToolOutput={onSubmitToolOutput}
              />
            )}
          </div>
        </div>

        {/* Bottom Card: Status & Input */}
        <ChatInputArea
          query={query}
          setQuery={setQuery}
          onSend={onSend}
          onStop={onStop}
          isStreaming={isStreaming}
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
          fileNavRef={fileNavRef}
        />
      </div>
    </>
  );
};

export const ChatView = memo(ChatViewInner);
