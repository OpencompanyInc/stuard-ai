import React, {
  memo,
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { clsx } from "clsx";
import { Brain } from "lucide-react";
import MessageList from "../../shared/messages/MessageList";
import { ContextItem } from "../../../FileNavigator";
import type {
  ChatMode,
  ChatModelsConfig,
  ModelSourcePreference,
  ReasoningLevel,
} from "../../../../hooks/usePreferences";
import { useModelRegistry } from "../../../../hooks/useModelRegistry";
import { ChatTabs } from "./parts/ChatTabs";
import { ChatHeaderActions } from "./parts/ChatHeaderActions";
import { ChatHeaderMenu } from "./parts/ChatHeaderMenu";
import { ChatInputArea } from "./parts/ChatInputArea";
import { FileNavigatorOverlay } from "./parts/FileNavigatorOverlay";
import { SidebarTabsPanel } from "../../shared/sidebar/SidebarTabsPanel";
import { TasksView, TaskSubTab } from "../../../TasksView";
import { SubagentDashboard } from "./parts/SubagentDashboard";
import { AskUserPrompt } from "@stuardai/chat-ui/AskUserPrompt";
import { useSubagentDashboard } from "../../../../hooks/useSubagentDashboard";
import { buildContextUsageMetrics } from "../../../../utils/contextUsage";
import { useFileNavigator } from "../../../../hooks/useFileNavigator";
import type { TranscriptLine, VoiceModeState, VoiceToolEvent } from "../../../../hooks/useVoiceMode";
import { ActiveProjectBar } from "./parts/ActiveProjectBar";
import type { Project } from "../../../../hooks/useProjects";

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

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
  onSteer?: () => void;
  // Steer target dropdown — list of running delegated subagents in this tab,
  // plus whichever one is currently selected. 'orchestrator' means the steer
  // composer nudges the parent turn instead of any subagent.
  activeSubagents?: Array<{ id: string; kind: string }>;
  steerTarget?: string;
  onSteerTargetChange?: (target: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  isRecording?: boolean;
  onMicClick?: () => void;
  voiceActive?: boolean;
  onToggleVoice?: () => void;
  voiceState?: VoiceModeState;
  voiceAudioLevel?: number;
  voiceMuted?: boolean;
  onVoiceMuteToggle?: () => void;
  voiceTranscripts?: TranscriptLine[];
  voiceActiveTools?: VoiceToolEvent[];

  // Attachments
  attachments?: Array<{ type: "image" | "file"; name: string; mimeType?: string; source?: string }>;
  onRemoveAttachment?: (index: number) => void;
  onAttachFiles?: () => void;
  onAttachImages?: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;

  // Queue
  queueDepth?: number;
  queuedMessages?: any[];
  onCancelQueuedMessage?: (id: string) => void;

  // History Props
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations?: Array<{ id: string; title?: string; created_at?: string }>;
  loadingConversations?: boolean;
  onSelectConversation?: (id: string) => void;

  // Status/Model
  statusText?: string;
  contextUsage?: Record<string, any>;
  contextModelId?: string;
  connectionStatus?: "connected" | "connecting" | "disconnected" | "error";

  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  chatModels?: ChatModelsConfig;
  onChatModelsChange?: (cfg: ChatModelsConfig) => void;
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;

  // Layout mode for responsive styling
  overlayMode?: "compact" | "sidebar" | "window";

  // Tabs
  tabs?: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;

  // GenUI
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;

  // ask_user tool prompts
  askUserPrompts?: Array<{
    id: string;
    tool: string;
    args: any;
    status: string;
  }>;
  onAskUserRespond?: (toolCallId: string, result: any) => void;

  // Edit & Revert
  onEditMessage?: (messageId: string, newText: string) => void;
  onRevertFiles?: (messageId: string) => void;
  onRedoFiles?: (messageId: string) => void;

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

  // Internal Sidebar
  internalSidebarOpen?: boolean;
  internalSidebarWidth?: number;
  activeSidebarTab?: "terminal" | "todo" | "projects";
  onToggleInternalSidebar?: () => void;
  onCloseInternalSidebar?: () => void;
  onSwitchSidebarTab?: (tab: "terminal" | "todo" | "projects") => void;
  onInternalSidebarResize?: (deltaX: number) => void;

  // Project Mode lock-in
  activeProject?: Project | null;
  activeConversationId?: string | null;
  onExitProjectMode?: () => void;
  onOpenProjectHome?: () => void;

  showCreditsLimitNotice?: boolean;
  onDismissCreditsLimitNotice?: () => void;
  onAddCredits?: () => void;
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
  onSteer,
  activeSubagents = [],
  steerTarget,
  onSteerTargetChange,
  onStop,
  isStreaming,
  voiceActive,
  onToggleVoice,
  voiceState,
  voiceAudioLevel,
  voiceMuted,
  onVoiceMuteToggle,
  voiceTranscripts,
  voiceActiveTools,
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations = [],
  loadingConversations = false,
  onSelectConversation = () => {},
  statusText = "Online",
  contextUsage,
  contextModelId,
  connectionStatus = "connected",
  chatMode = "auto",
  onChatModeChange,
  chatModels,
  onChatModelsChange,
  modelSource = "stuard",
  onModelSourceChange,
  reasoningLevel,
  onReasoningLevelChange,
  overlayMode = "compact",
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSubmitToolOutput,
  onGenUIResponse,
  askUserPrompts = [],
  onAskUserRespond,
  onEditMessage,
  onRevertFiles,
  onRedoFiles,
  pendingMemories = [],
  onConfirmPendingMemory,
  onRejectPendingMemory,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAttachImages,
  onPaste,
  onDrop,
  queueDepth = 0,
  queuedMessages = [],
  onCancelQueuedMessage,
  translucentMode = false,

  // Internal Sidebar
  internalSidebarOpen = false,
  internalSidebarWidth = 304,
  activeSidebarTab = "projects",
  onToggleInternalSidebar,
  onCloseInternalSidebar,
  onSwitchSidebarTab,
  onInternalSidebarResize,
  // Project Mode lock-in
  activeProject,
  activeConversationId,
  onExitProjectMode,
  onOpenProjectHome,
  showCreditsLimitNotice = false,
  onDismissCreditsLimitNotice,
  onAddCredits,
}) => {
  // Responsive layout based on overlay mode
  const isSidebarMode = overlayMode === "sidebar";
  const isWindowMode = overlayMode === "window";
  const selectedModelId: string | "auto" =
    typeof chatMode === "string" && chatMode.trim()
      ? (chatMode.trim() as any)
      : "auto";
  const { modelById } = useModelRegistry();

  // View Mode State (Chat vs Tasks)
  const [viewMode, setViewMode] = useState<"chat" | "tasks">("chat");
  const [tasksSubTab, setTasksSubTab] = useState<TaskSubTab>("todo");

  // Subagent Dashboard (pinned panel in chat)
  const activeChatTab =
    tabs.find((tab: any) => tab?.id === activeTabId) || tabs[0];
  const subagentDash = useSubagentDashboard(
    activeChatTab?.serverId || undefined,
  );

  // Merge cloud-ai delegated agents (passed in via props) with running
  // Python local agents (polled from the dashboard) so the composer's steer
  // dropdown can target either. The id namespaces don't collide: cloud-ai
  // uses 'sa-*' and Python uses uuid4 strings, so steer routing on the
  // parent side can dispatch by prefix.
  const combinedActiveSubagents = useMemo(() => {
    const list: Array<{ id: string; kind: string }> = activeSubagents.map(
      (s) => ({ id: s.id, kind: s.kind }),
    );
    const seen = new Set(list.map((s) => s.id));
    for (const task of subagentDash.tasks || []) {
      if (task.status !== "running" || seen.has(task.id)) continue;
      // Python tasks don't carry a kind — fall back to the truncated objective
      // so the user sees something meaningful in the dropdown.
      const objective = (task.objective || "").trim();
      const label =
        objective.length > 0
          ? objective.slice(0, 36) + (objective.length > 36 ? "…" : "")
          : "headless";
      list.push({ id: task.id, kind: label });
      seen.add(task.id);
    }
    return list;
  }, [activeSubagents, subagentDash.tasks]);

  const cloudSubagentIds = useMemo(
    () => new Set(activeSubagents.map((s) => s.id)),
    [activeSubagents],
  );

  const handleSteerFromComposer = useCallback(() => {
    const target = steerTarget || "orchestrator";
    if (target === "orchestrator" || cloudSubagentIds.has(target)) {
      onSteer?.();
      return;
    }

    const localTask = subagentDash.tasks.find(
      (task) => task.id === target && task.status === "running",
    );
    if (!localTask) {
      onSteer?.();
      return;
    }

    const message = query.trim();
    if (!message || attachments.length > 0 || contextPaths.length > 0 || !isStreaming) {
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`${AGENT_HTTP}/v1/subagents/${target}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          console.error(
            "[ChatView] Failed to steer local subagent",
            data?.error || res.statusText,
          );
          return;
        }
        setQuery("");
        subagentDash.refresh();
      } catch (err) {
        console.error("[ChatView] Failed to steer local subagent", err);
      }
    })();
  }, [
    attachments.length,
    cloudSubagentIds,
    contextPaths.length,
    isStreaming,
    onSteer,
    query,
    setQuery,
    steerTarget,
    subagentDash,
  ]);

  // Listen for view mode change events (e.g., from bookmark shortcuts)
  useEffect(() => {
    const handler = (
      _e: any,
      data: { mode: "chat" | "tasks"; subTab?: TaskSubTab },
    ) => {
      if (data?.mode) {
        setViewMode(data.mode);
        if (data.subTab) setTasksSubTab(data.subTab);
      }
    };
    const unsubscribe = (window as any).desktopAPI?.onViewModeChange?.(handler);
    // Also listen via IPC renderer
    const ipcHandler = (event: any, data: any) => {
      if (data?.mode) {
        setViewMode(data.mode);
        if (data.subTab) setTasksSubTab(data.subTab);
      }
    };
    try {
      (window as any)
        .require?.("electron")
        ?.ipcRenderer?.on?.("overlay:view-mode", ipcHandler);
    } catch {}
    return () => {
      unsubscribe?.();
      try {
        (window as any)
          .require?.("electron")
          ?.ipcRenderer?.off?.("overlay:view-mode", ipcHandler);
      } catch {}
    };
  }, []);

  const contextMetrics = useMemo(
    () =>
      buildContextUsageMetrics({
        usage: contextUsage,
        modelId: contextModelId,
        contextWindow: contextUsage?.contextWindow,
        modelById,
      }),
    [contextUsage, contextModelId, modelById],
  );

  // --- File Navigator (@ context) ---
  const {
    showFileNav,
    fileNavFilter,
    fileNavOverlay,
    textareaRef,
    fileNavRef,
    handleFileSelect,
    handleNavigate,
    handleCloseFileNav,
    handleOpenFileNav,
  } = useFileNavigator({ query, setQuery, onAddContext });

  const isLauncherChatLayout =
    overlayMode === "window" || overlayMode === "sidebar";
  const floatingComposerRef = useRef<HTMLDivElement>(null);
  const [composerInset, setComposerInset] = useState(152);
  const pendingAskUserPrompts = askUserPrompts.filter(
    (p) => p.status === "pending" && p.tool === "ask_user",
  );

  useEffect(() => {
    if (!isLauncherChatLayout) return;
    const el = floatingComposerRef.current;
    if (!el) return;
    const measure = () => setComposerInset(el.offsetHeight + 16);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    isLauncherChatLayout,
    viewMode,
    attachments?.length,
    contextPaths.length,
    queueDepth,
    pendingAskUserPrompts.length,
    showCreditsLimitNotice,
    statusText,
  ]);

  const chatInputArea = (
    <ChatInputArea
      launcherSkin={isLauncherChatLayout}
      query={query}
      setQuery={setQuery}
      onSend={onSend}
      onSteer={handleSteerFromComposer}
      activeSubagents={combinedActiveSubagents}
      steerTarget={steerTarget}
      onSteerTargetChange={onSteerTargetChange}
      onStop={onStop}
      isStreaming={isStreaming}
      voiceActive={voiceActive}
      onToggleVoice={onToggleVoice}
      voiceState={voiceState}
      voiceAudioLevel={voiceAudioLevel}
      voiceMuted={voiceMuted}
      onVoiceMuteToggle={onVoiceMuteToggle}
      voiceTranscripts={voiceTranscripts}
      voiceActiveTools={voiceActiveTools}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      onAttachFiles={onAttachFiles}
      onAttachImages={onAttachImages}
      onPaste={onPaste}
      onDrop={onDrop}
      queueDepth={queueDepth}
      queuedMessages={queuedMessages}
      onCancelQueuedMessage={onCancelQueuedMessage}
      statusText={statusText}
      connectionStatus={connectionStatus}
      contextMetrics={contextMetrics}
      translucentMode={translucentMode}
      showFileNav={showFileNav}
      textareaRef={textareaRef}
      selectedModelId={selectedModelId}
      onChatModeChange={onChatModeChange}
      modelSource={modelSource}
      onModelSourceChange={onModelSourceChange}
      reasoningLevel={reasoningLevel}
      onReasoningLevelChange={onReasoningLevelChange}
      fileNavRef={fileNavRef}
      activeTabId={activeTabId}
      contextPaths={contextPaths}
      onRemoveContext={onRemoveContext}
      onOpenFileNav={handleOpenFileNav}
      onCloseFileNav={handleCloseFileNav}
      showCreditsLimitNotice={showCreditsLimitNotice}
      onDismissCreditsLimitNotice={onDismissCreditsLimitNotice}
      onAddCredits={onAddCredits}
      currentToolCalls={currentToolCalls}
    />
  );

  return (
    <>
      <FileNavigatorOverlay
        ref={fileNavRef}
        showFileNav={showFileNav}
        fileNavOverlay={fileNavOverlay}
        fileNavFilter={fileNavFilter}
        onSelect={handleFileSelect}
        onClose={handleCloseFileNav}
        onNavigate={handleNavigate}
      />
      <div className="flex h-full min-w-0 bg-transparent relative font-sans smooth-resize min-h-0">
        {/* Internal Sidebar - outside main container for proper corner rendering */}
        <SidebarTabsPanel
          isOpen={internalSidebarOpen}
          onClose={onCloseInternalSidebar || (() => {})}
          activeTab={activeSidebarTab}
          onSwitchTab={onSwitchSidebarTab || (() => {})}
          translucentMode={translucentMode}
          width={internalSidebarWidth}
          onResize={onInternalSidebarResize}
        />

        {overlayMode === "window" || overlayMode === "sidebar" ? (
          <div
            className={clsx(
              "flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 border border-theme overflow-hidden launcher-compact-skin",
              "p-4 gap-3",
              internalSidebarOpen
                ? "rounded-r-[32px] rounded-l-none border-l-0"
                : "rounded-[32px]",
              translucentMode
                ? "bg-theme-bg backdrop-blur-2xl"
                : "bg-theme-bg",
            )}
            style={{
              ...(translucentMode
                ? {
                    background:
                      "color-mix(in srgb, var(--background) 76%, transparent)",
                  }
                : {}),
              ...(activeProject
                ? { borderColor: `${activeProject.color}22` }
                : {}),
            }}
          >
            {/* Header & Messages — single launcher surface, no nested card */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden relative gap-3">
              {/* Top Header */}
              <div className="flex items-center justify-between px-0.5 shrink-0 w-full min-w-0">
                <div className="flex-1 w-0 min-w-0 overflow-hidden mr-2">
                  <ChatTabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSwitchTab={onSwitchTab}
                    onCloseTab={onCloseTab}
                    onAddTab={onAddTab}
                  />
                </div>
                <ChatHeaderMenu
                  onToggleSidebar={onToggleInternalSidebar}
                  sidebarOpen={internalSidebarOpen}
                  onOpenDashboard={onOpenDashboard}
                  onCollapse={onCollapse}
                  chatMenuOpen={chatMenuOpen}
                  onChatMenuOpenChange={onChatMenuOpenChange}
                  conversations={conversations}
                  loadingConversations={loadingConversations}
                  activeConversationId={activeConversationId}
                  onSelectConversation={onSelectConversation}
                  onNewChat={onNewChat}
                />
              </div>

              {/* Project Mode lock-in bar */}
              {activeProject && (
                <ActiveProjectBar
                  project={activeProject}
                  conversationId={activeConversationId}
                  onExit={onExitProjectMode}
                  onOpenHome={onOpenProjectHome}
                />
              )}

              {/* Pending memories (overlay-only; compact UI) */}
              {viewMode === "chat" &&
                Array.isArray(pendingMemories) &&
                pendingMemories.length > 0 && (
                  <div className="px-4 py-2 border-b border-theme/10 bg-amber-500/10">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                          Pending memory
                        </span>
                      </div>
                      <div className="text-[10px] font-bold text-amber-700/70 dark:text-amber-300/70">
                        {pendingMemories.length} item(s)
                      </div>
                    </div>
                    <div className="space-y-2">
                      {pendingMemories.slice(0, 3).map((pm) => (
                        <div
                          key={pm.id}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl bg-theme-card/70 border border-theme/10"
                        >
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-theme-fg truncate">
                              {pm.proposed_action}
                              {pm.proposed_key ? `:${pm.proposed_key}` : ""}
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

              {/* Messages / tasks — scroll full height; composer floats on top */}
              <div className="flex-1 min-h-0 relative overflow-hidden">
                <div className="absolute inset-0 flex flex-col overflow-hidden px-1">
                  {viewMode === "tasks" ? (
                    <div
                      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
                      style={{ paddingBottom: composerInset }}
                    >
                      <TasksView
                        compact
                        defaultSubTab={tasksSubTab}
                        onSubTabChange={setTasksSubTab}
                      />
                    </div>
                  ) : (
                    <>
                      <SubagentDashboard
                        tasks={subagentDash.tasks}
                        visibleTasks={subagentDash.visibleTasks}
                        activeTask={subagentDash.activeTask}
                        activeTaskId={subagentDash.activeTaskId}
                        setActiveTaskId={subagentDash.setActiveTaskId}
                        collapsed={subagentDash.collapsed}
                        setCollapsed={subagentDash.setCollapsed}
                        dismissed={subagentDash.dismissed}
                        setDismissed={subagentDash.setDismissed}
                        dismissTask={subagentDash.dismissTask}
                        hasRunning={subagentDash.hasRunning}
                        refresh={subagentDash.refresh}
                        loading={subagentDash.loading}
                      />
                      <div className="flex-1 min-h-0">
                        <MessageList
                          messages={messages}
                          currentResponse={currentResponse}
                          currentReasoning={currentReasoning}
                          currentToolCalls={currentToolCalls}
                          currentStreamChunks={currentStreamChunks}
                          thinkingStartTime={thinkingStartTime}
                          className="h-full py-3 scrollbar-hidden min-w-0"
                          scrollInsetBottom={composerInset}
                          onSubmitToolOutput={onSubmitToolOutput}
                          onGenUIResponse={onGenUIResponse}
                          onEditMessage={onEditMessage}
                          onRevertFiles={onRevertFiles}
                          onRedoFiles={onRedoFiles}
                        />
                      </div>
                    </>
                  )}
                </div>

                {viewMode === "chat" && (
                  <div
                    className="chat-floating-input-fade absolute inset-x-0 bottom-0 z-[5]"
                    aria-hidden
                  />
                )}

                <div
                  ref={floatingComposerRef}
                  className="chat-floating-composer absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2"
                >
                  {pendingAskUserPrompts.map((p) => (
                    <AskUserPrompt
                      key={p.id}
                      prompt={p}
                      onRespond={onAskUserRespond!}
                    />
                  ))}
                  {chatInputArea}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Top Card: Header & Messages */}
            <div
              className={clsx(
                "flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden relative transition-all duration-300 shadow-2xl",
                internalSidebarOpen
                  ? isSidebarMode
                    ? "rounded-r-[16px] rounded-l-none"
                    : "rounded-r-[28px] rounded-l-none"
                  : isSidebarMode
                    ? "rounded-[16px]"
                    : "rounded-[28px]",
                translucentMode
                  ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
                  : "bg-theme-card border border-theme/50",
              )}
              style={
                activeProject
                  ? {
                      borderColor: `${activeProject.color}22`,
                    }
                  : undefined
              }
            >
              {/* Top Header */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-theme/30 bg-theme-card/50 backdrop-blur-sm w-full min-w-0">
                <div className="flex-1 w-0 min-w-0 overflow-hidden mr-2">
                  <ChatTabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSwitchTab={onSwitchTab}
                    onCloseTab={onCloseTab}
                    onAddTab={onAddTab}
                  />
                </div>
                <ChatHeaderActions
                  onToggleSidebar={onToggleInternalSidebar}
                  sidebarOpen={internalSidebarOpen}
                  onOpenDashboard={onOpenDashboard}
                  onCollapse={onCollapse}
                  overlayMode={overlayMode}
                  chatMenuOpen={chatMenuOpen}
                  onChatMenuOpenChange={onChatMenuOpenChange}
                  conversations={conversations}
                  loadingConversations={loadingConversations}
                  activeConversationId={activeConversationId}
                  onSelectConversation={onSelectConversation}
                  onNewChat={onNewChat}
                />
              </div>

              {/* Project Mode lock-in bar */}
              {activeProject && (
                <ActiveProjectBar
                  project={activeProject}
                  conversationId={activeConversationId}
                  onExit={onExitProjectMode}
                  onOpenHome={onOpenProjectHome}
                />
              )}

              {/* Pending memories (overlay-only; compact UI) */}
              {viewMode === "chat" &&
                Array.isArray(pendingMemories) &&
                pendingMemories.length > 0 && (
                  <div className="px-4 py-2 border-b border-theme/10 bg-amber-500/10">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                          Pending memory
                        </span>
                      </div>
                      <div className="text-[10px] font-bold text-amber-700/70 dark:text-amber-300/70">
                        {pendingMemories.length} item(s)
                      </div>
                    </div>
                    <div className="space-y-2">
                      {pendingMemories.slice(0, 3).map((pm) => (
                        <div
                          key={pm.id}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl bg-theme-card/70 border border-theme/10"
                        >
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-theme-fg truncate">
                              {pm.proposed_action}
                              {pm.proposed_key ? `:${pm.proposed_key}` : ""}
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

              {/* Messages or Tasks View */}
              <div className="flex-1 min-h-0 overflow-hidden relative">
                {viewMode === "tasks" ? (
                  <div className="h-full overflow-y-auto custom-scrollbar">
                    <TasksView
                      compact
                      defaultSubTab={tasksSubTab}
                      onSubTabChange={setTasksSubTab}
                    />
                  </div>
                ) : (
                  <>
                    {/* Pinned SubAgent Dashboard */}
                    <SubagentDashboard
                      tasks={subagentDash.tasks}
                      visibleTasks={subagentDash.visibleTasks}
                      activeTask={subagentDash.activeTask}
                      activeTaskId={subagentDash.activeTaskId}
                      setActiveTaskId={subagentDash.setActiveTaskId}
                      collapsed={subagentDash.collapsed}
                      setCollapsed={subagentDash.setCollapsed}
                      dismissed={subagentDash.dismissed}
                      setDismissed={subagentDash.setDismissed}
                      dismissTask={subagentDash.dismissTask}
                      hasRunning={subagentDash.hasRunning}
                      refresh={subagentDash.refresh}
                      loading={subagentDash.loading}
                    />
                    <MessageList
                      messages={messages}
                      currentResponse={currentResponse}
                      currentReasoning={currentReasoning}
                      currentToolCalls={currentToolCalls}
                      currentStreamChunks={currentStreamChunks}
                      thinkingStartTime={thinkingStartTime}
                      className="h-full px-5 py-4 scrollbar-hidden overflow-x-hidden"
                      onSubmitToolOutput={onSubmitToolOutput}
                      onGenUIResponse={onGenUIResponse}
                      onEditMessage={onEditMessage}
                      onRevertFiles={onRevertFiles}
                      onRedoFiles={onRedoFiles}
                    />
                  </>
                )}
              </div>
            </div>

            {/* ask_user prompts */}
            {askUserPrompts
              .filter((p) => p.status === "pending" && p.tool === "ask_user")
              .map((p) => (
                <AskUserPrompt
                  key={p.id}
                  prompt={p}
                  onRespond={onAskUserRespond!}
                />
              ))}

            {chatInputArea}
          </>
        )}
      </div>
    </>
  );
};

export const ChatView = memo(ChatViewInner);
