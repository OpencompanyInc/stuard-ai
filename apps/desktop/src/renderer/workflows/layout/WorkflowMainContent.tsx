import React, { useCallback, useRef, useState } from "react";
import type { ModelSourcePreference, ReasoningLevel } from "../../hooks/usePreferences";
import type { ValidationError } from "../builder/compiler";
import { ChatHistory } from "../components/chat/ChatHistory";
import { ChatInput, ChatInputRef } from "../components/chat/ChatInput";
import { DiscoverTips } from "../components/DiscoverTips";
import { ToolPalette, ToolPaletteRef } from "../components/ToolPalette";
import type { DesignerModel } from "../types";
import type { ExecutionState, OpenFileTab, RightPanel, WorkspaceInfo } from "./types";
import { WorkflowCanvasAndPanels } from "./WorkflowCanvasAndPanels";
import { useModelRegistry } from "../../hooks/useModelRegistry";
import { buildContextUsageMetrics } from "../../utils/contextUsage";

// ── Draggable panel hook ──
function useDraggablePanel() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag from buttons or inputs
    if ((e.target as HTMLElement).closest("button, input, textarea, [contenteditable]")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = offsetRef.current.x;
    const origY = offsetRef.current.y;

    const onMove = (ev: MouseEvent) => {
      const newOffset = {
        x: origX + ev.clientX - startX,
        y: origY + ev.clientY - startY,
      };
      offsetRef.current = newOffset;
      setOffset(newOffset);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const reset = useCallback(() => {
    offsetRef.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
  }, []);

  return { offset, onDragStart, reset };
}

interface WorkflowMainContentProps {
  selectedId: string;
  model: DesignerModel | null;
  loading: boolean;
  viewMode: "ai" | "manual" | "none";
  onSetViewMode: (mode: "ai" | "manual" | "none") => void;
  aiLeftWidth: number;
  onStartResizeAiLeft: (e: React.MouseEvent) => void;
  onResetAiLeftWidth: () => void;
  manualRightWidth: number;
  onStartResizeManualRight: (e: React.MouseEvent) => void;
  onResetManualRightWidth: () => void;
  rightPanel: RightPanel;
  onSetRightPanel: (panel: RightPanel) => void;
  showWorkspace: boolean;
  workspaceInfo: WorkspaceInfo | null;
  errors: ValidationError[];
  selectedNodeId: string;
  selectedNodeIds: Set<string>;
  connectingFrom: string;
  reconnecting: { wireIndex: number; end: "from" | "to" } | null;
  executionState: ExecutionState | null;
  size: { w: number; h: number };
  canvasRef: React.RefObject<HTMLDivElement>;
  alignmentGuides: any[];
  zoom: number;
  selectedWireIndex: number | null;
  selectionBox: { startX: number; startY: number; endX: number; endY: number } | null;
  activeTab: string;
  openTabs: OpenFileTab[];
  logs: Array<{ ts: string; msg: string }>;
  workflowChatModelId: string | "auto";
  workflowModelSource: ModelSourcePreference;
  workflowReasoningLevel: ReasoningLevel;
  chat: {
    messages: any[];
    streamItems: any[];
    reasoningText: string;
    showReasoning: boolean;
    setShowReasoning: (show: boolean) => void;
    busy: boolean;
    pendingApprovals?: any[];
    respondToApproval?: (id: string, allow: boolean) => void;
    sendMessage: (text: string) => void;
    stopGeneration: () => void;
    pastSessions: any[];
    showSessionHistory: boolean;
    setShowSessionHistory: (show: boolean) => void;
    newSession: () => void;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    latestUsage?: Record<string, any>;
    latestModelId?: string;
  };
  onApplyModel: (model: any) => void;
  onSetWorkflowChatModelId: (id: string | "auto") => void;
  onSetWorkflowModelSource: (source: ModelSourcePreference) => void;
  onSetWorkflowReasoningLevel: (level: ReasoningLevel) => void;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
  onClearLogs: () => void;
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onAutoOrganize: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onCanvasClick: () => void;
  onNodeSelect: (id: string, e?: React.MouseEvent) => void;
  onNodeMouseDown: (id: string, e: React.MouseEvent) => void;
  onNodeContextMenu: (id: string, e: React.MouseEvent) => void;
  onNodeConnect: (id: string) => void;
  onWireSelect: (i: number) => void;
  onWireDelete: (i: number) => void;
  onWireContextMenu: (wireIndex: number, e: React.MouseEvent) => void;
  onWireReconnect: (wireIndex: number, end: "from" | "to") => void;
  onCanvasContextMenu: (e: React.MouseEvent) => void;
  onSetSelectedWireIndex: (index: number | null) => void;
  onUpdateModel: (model: DesignerModel) => void;
  onDeleteNode: () => void;
  onStartReconnect: (wireIndex: number, end: "from" | "to") => void;
  onRefreshWorkspace: () => void;
  onCloseWorkspace: () => void;
  onOpenFile: (filePath: string, fileName: string) => void;
  onOpenStuard?: (subPath: string) => void;
  chatInputRef?: React.RefObject<ChatInputRef>;
  toolPaletteRef?: React.RefObject<ToolPaletteRef>;
  breadcrumbs?: Array<{ label: string; path: string | null }>;
  currentSubPath?: string | null;
  onNavigateBack?: () => void;
}

export function WorkflowMainContent({
  selectedId,
  model,
  loading,
  viewMode,
  onSetViewMode,
  aiLeftWidth,
  onStartResizeAiLeft,
  onResetAiLeftWidth,
  manualRightWidth,
  onStartResizeManualRight,
  onResetManualRightWidth,
  rightPanel,
  onSetRightPanel,
  showWorkspace,
  workspaceInfo,
  errors,
  selectedNodeId,
  selectedNodeIds,
  connectingFrom,
  reconnecting,
  executionState,
  size,
  canvasRef,
  alignmentGuides,
  zoom,
  selectedWireIndex,
  selectionBox,
  activeTab,
  openTabs,
  logs,
  workflowChatModelId,
  workflowModelSource,
  workflowReasoningLevel,
  chat,
  onApplyModel,
  onSetWorkflowChatModelId,
  onSetWorkflowModelSource,
  onSetWorkflowReasoningLevel,
  onSetActiveTab,
  onCloseFileTab,
  onClearLogs,
  onCanvasMouseDown,
  onWheel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onAutoOrganize,
  onDragOver,
  onDrop,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onCanvasClick,
  onNodeSelect,
  onNodeMouseDown,
  onNodeContextMenu,
  onNodeConnect,
  onWireSelect,
  onWireDelete,
  onWireContextMenu,
  onWireReconnect,
  onCanvasContextMenu,
  onSetSelectedWireIndex,
  onUpdateModel,
  onDeleteNode,
  onStartReconnect,
  onRefreshWorkspace,
  onCloseWorkspace,
  onOpenFile,
  onOpenStuard,
  chatInputRef,
  toolPaletteRef,
  breadcrumbs,
  currentSubPath,
  onNavigateBack,
}: WorkflowMainContentProps) {
  const { modelById } = useModelRegistry();
  const workflowContextMetrics = React.useMemo(() => buildContextUsageMetrics({
    usage: chat.latestUsage,
    modelId: chat.latestModelId || (workflowChatModelId !== 'auto' ? workflowChatModelId : undefined),
    modelById,
  }), [chat.latestModelId, chat.latestUsage, modelById, workflowChatModelId]);

  const chatDrag = useDraggablePanel();
  const paletteDrag = useDraggablePanel();

  const canvasAndPanelsProps = {
    model: model!,
    selectedId,
    selectedNodeId,
    selectedNodeIds,
    connectingFrom,
    reconnecting,
    executionState,
    size,
    canvasRef,
    alignmentGuides,
    zoom,
    selectedWireIndex,
    selectionBox,
    activeTab,
    openTabs,
    logs,
    rightPanel,
    manualRightWidth,
    errors,
    showWorkspace,
    workspaceInfo,
    onSetActiveTab,
    onCloseFileTab,
    onClearLogs,
    onCanvasMouseDown,
    onWheel,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onAutoOrganize,
    onDragOver,
    onDrop,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onCanvasClick,
    onNodeSelect,
    onNodeMouseDown,
    onNodeContextMenu,
    onNodeConnect,
    onWireSelect,
    onWireDelete,
    onWireContextMenu,
    onWireReconnect,
    onCanvasContextMenu,
    onStartResizeManualRight,
    onResetManualRightWidth,
    onSetSelectedWireIndex,
    onSetRightPanel,
    onUpdateModel,
    onDeleteNode,
    onStartReconnect,
    onRefreshWorkspace,
    onCloseWorkspace,
    onOpenFile,
    onOpenStuard,
    breadcrumbs,
    currentSubPath,
    onNavigateBack,
  };

  return (
    <div className="w-full h-full flex flex-col min-w-0 relative z-0">
      {selectedId && model ? (
        <div className="flex-1 relative min-h-0">
          <div className="absolute inset-0 z-0 flex">
            <WorkflowCanvasAndPanels
              {...canvasAndPanelsProps}
              onSendLogsToChat={(text: string) => {
                chat.sendMessage(text);
                if (viewMode !== 'ai') onSetRightPanel("ai");
              }}
            />
          </div>

          {/* Floating AI Chat Panel */}
          {viewMode === "ai" && (
            <div
              id="wf-target-chat"
              className="absolute right-20 top-24 bottom-24 flex flex-col z-20 rounded-[20px] shadow-2xl pointer-events-auto border wf-panel"
              style={{
                width: aiLeftWidth,
                minWidth: 320,
                backdropFilter: 'var(--wf-glass-blur)',
                transform: `translate(${chatDrag.offset.x}px, ${chatDrag.offset.y}px)`,
              }}
            >
              {/* Header — drag handle */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b shrink-0 rounded-t-[20px] z-20 wf-border-subtle cursor-grab active:cursor-grabbing select-none"
                style={{ background: 'var(--wf-bg-overlay)' }}
                onMouseDown={chatDrag.onDragStart}
                onDoubleClick={chatDrag.reset}
              >
                <span className="font-semibold text-sm wf-fg">AI Assistant</span>
                <div className="flex items-center gap-1">
                  <button onClick={chat.newSession} className="p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors" style={{ ['--tw-bg-opacity' as any]: 1 }} title="New Chat">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <button onClick={() => chat.setShowSessionHistory(!chat.showSessionHistory)} className="p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors" title="History">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  </button>
                  <button onClick={() => { onSetViewMode('none'); onSetRightPanel('none'); }} className="p-1.5 rounded-lg wf-fg-faint hover:text-red-400 hover:bg-red-500/20 transition-colors ml-1" title="Close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 relative rounded-b-[20px] overflow-hidden">
                <div className="absolute inset-0 pb-20">
                  <ChatHistory
                    messages={chat.messages}
                    streamItems={chat.streamItems}
                    reasoningText={chat.reasoningText}
                    showReasoning={chat.showReasoning}
                    setShowReasoning={chat.setShowReasoning}
                    busy={chat.busy}
                    onUndo={onApplyModel}
                    pendingApprovals={chat.pendingApprovals}
                    onRespondToApproval={chat.respondToApproval}
                    pastSessions={chat.pastSessions}
                    showSessionHistory={chat.showSessionHistory}
                    setShowSessionHistory={chat.setShowSessionHistory}
                    onNewSession={chat.newSession}
                    onLoadSession={chat.loadSession}
                    onDeleteSession={chat.deleteSession}
                  />
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none z-10">
                  <div className="pointer-events-auto">
                    <ChatInput
                      ref={chatInputRef}
                      onSend={chat.sendMessage}
                      busy={chat.busy}
                      onStop={chat.stopGeneration}
                      contextMetrics={workflowContextMetrics}
                      selectedModelId={workflowChatModelId}
                      onSelectModel={onSetWorkflowChatModelId}
                      modelSource={workflowModelSource}
                      onModelSourceChange={onSetWorkflowModelSource}
                      reasoningLevel={workflowReasoningLevel}
                      onReasoningLevelChange={onSetWorkflowReasoningLevel}
                    />
                  </div>
                </div>
              </div>

              <div
                className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize transition-colors wf-resize-handle"
                onMouseDown={onStartResizeAiLeft}
                onDoubleClick={onResetAiLeftWidth}
              />
            </div>
          )}

          {/* Floating Tool Palette for Manual Mode */}
          {viewMode === "manual" && (
            <div
              id="wf-target-palette"
              className="absolute left-6 top-32 bottom-24 w-64 rounded-xl shadow-2xl flex flex-col shrink-0 z-20 overflow-hidden pointer-events-auto border wf-panel"
              style={{
                backdropFilter: 'var(--wf-glass-blur)',
                transform: `translate(${paletteDrag.offset.x}px, ${paletteDrag.offset.y}px)`,
              }}
            >
              {/* Drag handle strip */}
              <div
                className="flex items-center justify-center py-1 cursor-grab active:cursor-grabbing shrink-0 wf-bg-elevated border-b wf-border-subtle"
                onMouseDown={paletteDrag.onDragStart}
                onDoubleClick={paletteDrag.reset}
              >
                <div className="w-8 h-1 rounded-full opacity-20" style={{ background: 'var(--wf-fg)' }} />
              </div>
              <ToolPalette
                ref={toolPaletteRef}
                workflowId={selectedId}
                onDragStart={(e, item) => {
                  e.dataTransfer.setData("text/plain", JSON.stringify(item));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                disabled={model.locked}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center wf-bg">
          <div className="text-center max-w-xl px-6">
            <div className="w-10 h-10 border-[3px] rounded-full animate-spin mx-auto mb-6" style={{ borderColor: 'var(--wf-border)', borderTopColor: 'var(--wf-accent)' }} />
            <h2 className="text-base font-semibold mb-1.5 wf-fg">Loading workflow…</h2>
            <p className="text-sm mb-5 wf-fg-muted">Getting things ready.</p>
            <DiscoverTips
              compact
              title="Discover while this loads"
              className="text-left"
              tips={[
                {
                  id: "main-ai",
                  title: "Workflows do not have to start visually",
                  description: "You can prompt the AI with the outcome you want, then adjust the generated nodes and wires manually.",
                },
                {
                  id: "main-ui",
                  title: "Custom UI turns workflows into mini apps",
                  description: "Forms, status panels, and small tools can all be layered onto a workflow when interaction matters.",
                },
                {
                  id: "main-path",
                  title: "Good workflows often begin as repeated chat tasks",
                  description: "If you keep asking Stuard to do the same thing, that is usually the best candidate to automate next.",
                },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
