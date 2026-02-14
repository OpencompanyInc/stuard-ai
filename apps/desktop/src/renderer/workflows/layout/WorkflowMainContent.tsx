import React from "react";
import type { ValidationError } from "../builder/compiler";
import { ChatHistory } from "../components/chat/ChatHistory";
import { ChatInput } from "../components/chat/ChatInput";
import { ToolPalette } from "../components/ToolPalette";
import type { DesignerModel } from "../types";
import type { ExecutionState, OpenFileTab, RightPanel, WorkspaceInfo } from "./types";
import { WorkflowCanvasAndPanels } from "./WorkflowCanvasAndPanels";

interface WorkflowMainContentProps {
  selectedId: string;
  model: DesignerModel | null;
  loading: boolean;
  viewMode: "ai" | "manual";
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
  showLogs: boolean;
  workflowChatModelId: string | "auto";
  chat: {
    messages: any[];
    streamItems: any[];
    reasoningText: string;
    showReasoning: boolean;
    setShowReasoning: (show: boolean) => void;
    busy: boolean;
    sendMessage: (text: string) => void;
    stopGeneration: () => void;
  };
  onApplyModel: (model: any) => void;
  onSetWorkflowChatModelId: (id: string | "auto") => void;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
  onToggleLogs: () => void;
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
}

export function WorkflowMainContent({
  selectedId,
  model,
  loading,
  viewMode,
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
  showLogs,
  workflowChatModelId,
  chat,
  onApplyModel,
  onSetWorkflowChatModelId,
  onSetActiveTab,
  onCloseFileTab,
  onToggleLogs,
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
}: WorkflowMainContentProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 relative z-0">
      {selectedId && model ? (
        <div className="flex-1 flex min-h-0">
          {viewMode === "ai" && (
            <>
              <div
                className="bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm relative min-h-0"
                style={{ width: aiLeftWidth }}
              >
                <ChatHistory
                  messages={chat.messages}
                  streamItems={chat.streamItems}
                  reasoningText={chat.reasoningText}
                  showReasoning={chat.showReasoning}
                  setShowReasoning={chat.setShowReasoning}
                  busy={chat.busy}
                  onUndo={onApplyModel}
                  selectedModelId={workflowChatModelId}
                  onSelectModel={onSetWorkflowChatModelId}
                />
              </div>

              <div
                className="w-1 hover:w-1.5 bg-slate-200/50 hover:bg-indigo-400/50 cursor-col-resize shrink-0 transition-all duration-200"
                onMouseDown={onStartResizeAiLeft}
                onDoubleClick={onResetAiLeftWidth}
              />

              <WorkflowCanvasAndPanels
                model={model}
                selectedId={selectedId}
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                connectingFrom={connectingFrom}
                reconnecting={reconnecting}
                executionState={executionState}
                size={size}
                canvasRef={canvasRef}
                alignmentGuides={alignmentGuides}
                zoom={zoom}
                selectedWireIndex={selectedWireIndex}
                selectionBox={selectionBox}
                activeTab={activeTab}
                openTabs={openTabs}
                logs={logs}
                showLogs={showLogs}
                floatingContent={(
                  <div className="absolute bottom-6 left-0 right-0 z-30 px-6 flex justify-center pointer-events-none">
                    <div className="w-full max-w-2xl pointer-events-auto">
                      <ChatInput
                        onSend={chat.sendMessage}
                        busy={chat.busy}
                        onStop={chat.stopGeneration}
                      />
                    </div>
                  </div>
                )}
                rightPanel={rightPanel}
                manualRightWidth={manualRightWidth}
                errors={errors}
                showWorkspace={showWorkspace}
                workspaceInfo={workspaceInfo}
                onSetActiveTab={onSetActiveTab}
                onCloseFileTab={onCloseFileTab}
                onToggleLogs={onToggleLogs}
                onClearLogs={onClearLogs}
                onSendLogsToChat={chat.sendMessage}
                onCanvasMouseDown={onCanvasMouseDown}
                onWheel={onWheel}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onZoomReset={onZoomReset}
                onAutoOrganize={onAutoOrganize}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseLeave}
                onCanvasClick={onCanvasClick}
                onNodeSelect={onNodeSelect}
                onNodeMouseDown={onNodeMouseDown}
                onNodeContextMenu={onNodeContextMenu}
                onNodeConnect={onNodeConnect}
                onWireSelect={onWireSelect}
                onWireDelete={onWireDelete}
                onWireContextMenu={onWireContextMenu}
                onWireReconnect={onWireReconnect}
                onCanvasContextMenu={onCanvasContextMenu}
                onStartResizeManualRight={onStartResizeManualRight}
                onResetManualRightWidth={onResetManualRightWidth}
                onSetSelectedWireIndex={onSetSelectedWireIndex}
                onSetRightPanel={onSetRightPanel}
                onUpdateModel={onUpdateModel}
                onDeleteNode={onDeleteNode}
                onStartReconnect={onStartReconnect}
                onRefreshWorkspace={onRefreshWorkspace}
                onCloseWorkspace={onCloseWorkspace}
                onOpenFile={onOpenFile}
              />
            </>
          )}

          {viewMode === "manual" && (
            <>
              <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 z-10 min-h-0 overflow-hidden shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
                <ToolPalette
                  onDragStart={(e, item) => {
                    e.dataTransfer.setData("text/plain", JSON.stringify(item));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  disabled={model.locked}
                />
              </div>

              <WorkflowCanvasAndPanels
                model={model}
                selectedId={selectedId}
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                connectingFrom={connectingFrom}
                reconnecting={reconnecting}
                executionState={executionState}
                size={size}
                canvasRef={canvasRef}
                alignmentGuides={alignmentGuides}
                zoom={zoom}
                selectedWireIndex={selectedWireIndex}
                selectionBox={selectionBox}
                activeTab={activeTab}
                openTabs={openTabs}
                logs={logs}
                showLogs={showLogs}
                rightPanel={rightPanel}
                manualRightWidth={manualRightWidth}
                errors={errors}
                showWorkspace={showWorkspace}
                workspaceInfo={workspaceInfo}
                onSetActiveTab={onSetActiveTab}
                onCloseFileTab={onCloseFileTab}
                onToggleLogs={onToggleLogs}
                onClearLogs={onClearLogs}
                onSendLogsToChat={(text: string) => {
                  chat.sendMessage(text);
                  onSetRightPanel("ai");
                }}
                onCanvasMouseDown={onCanvasMouseDown}
                onWheel={onWheel}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onZoomReset={onZoomReset}
                onAutoOrganize={onAutoOrganize}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseLeave}
                onCanvasClick={onCanvasClick}
                onNodeSelect={onNodeSelect}
                onNodeMouseDown={onNodeMouseDown}
                onNodeContextMenu={onNodeContextMenu}
                onNodeConnect={onNodeConnect}
                onWireSelect={onWireSelect}
                onWireDelete={onWireDelete}
                onWireContextMenu={onWireContextMenu}
                onWireReconnect={onWireReconnect}
                onCanvasContextMenu={onCanvasContextMenu}
                onStartResizeManualRight={onStartResizeManualRight}
                onResetManualRightWidth={onResetManualRightWidth}
                onSetSelectedWireIndex={onSetSelectedWireIndex}
                onSetRightPanel={onSetRightPanel}
                onUpdateModel={onUpdateModel}
                onDeleteNode={onDeleteNode}
                onStartReconnect={onStartReconnect}
                onRefreshWorkspace={onRefreshWorkspace}
                onCloseWorkspace={onCloseWorkspace}
                onOpenFile={onOpenFile}
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center max-w-sm px-6">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-6" />
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Loading...</h2>
            <p className="text-sm text-slate-500">Getting your workflow ready.</p>
          </div>
        </div>
      )}
    </div>
  );
}
