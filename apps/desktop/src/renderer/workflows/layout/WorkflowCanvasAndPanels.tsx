import React from "react";
import type { ValidationError } from "../builder/compiler";
import type { DesignerModel } from "../types";
import type { ExecutionState, OpenFileTab, RightPanel, WorkspaceInfo } from "./types";
import { WorkflowCanvasPane } from "./WorkflowCanvasPane";
import { WorkflowRightPanels } from "./WorkflowRightPanels";

interface WorkflowCanvasAndPanelsProps {
  model: DesignerModel;
  selectedId: string;
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
  floatingContent?: React.ReactNode;
  rightPanel: RightPanel;
  manualRightWidth: number;
  errors: ValidationError[];
  showWorkspace: boolean;
  workspaceInfo: WorkspaceInfo | null;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
  onToggleLogs: () => void;
  onClearLogs: () => void;
  onSendLogsToChat: (text: string) => void;
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
  onStartResizeManualRight: (e: React.MouseEvent) => void;
  onResetManualRightWidth: () => void;
  onSetSelectedWireIndex: (index: number | null) => void;
  onSetRightPanel: (panel: RightPanel) => void;
  onUpdateModel: (model: DesignerModel) => void;
  onDeleteNode: () => void;
  onStartReconnect: (wireIndex: number, end: "from" | "to") => void;
  onRefreshWorkspace: () => void;
  onCloseWorkspace: () => void;
  onOpenFile: (filePath: string, fileName: string) => void;
  onOpenStuard?: (subPath: string) => void;
  /** Breadcrumbs for sub-workflow navigation */
  breadcrumbs?: Array<{ label: string; path: string | null }>;
  /** Current sub-workflow path (null = main) */
  currentSubPath?: string | null;
  /** Navigate back to parent workflow */
  onNavigateBack?: () => void;
}

export function WorkflowCanvasAndPanels({
  model,
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
  showLogs,
  floatingContent,
  rightPanel,
  manualRightWidth,
  errors,
  showWorkspace,
  workspaceInfo,
  onSetActiveTab,
  onCloseFileTab,
  onToggleLogs,
  onClearLogs,
  onSendLogsToChat,
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
}: WorkflowCanvasAndPanelsProps) {
  return (
    <>
      <WorkflowCanvasPane
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
        floatingContent={floatingContent}
        onSetActiveTab={onSetActiveTab}
        onCloseFileTab={onCloseFileTab}
        onToggleLogs={onToggleLogs}
        onClearLogs={onClearLogs}
        onSendLogsToChat={onSendLogsToChat}
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
        breadcrumbs={breadcrumbs}
        currentSubPath={currentSubPath}
        onNavigateBack={onNavigateBack}
      />

      <WorkflowRightPanels
        rightPanel={rightPanel}
        manualRightWidth={manualRightWidth}
        onStartResizeManualRight={onStartResizeManualRight}
        onResetManualRightWidth={onResetManualRightWidth}
        model={model}
        errors={errors}
        selectedNodeId={selectedNodeId}
        selectedWireIndex={selectedWireIndex}
        onSetSelectedWireIndex={onSetSelectedWireIndex}
        onSetRightPanel={onSetRightPanel}
        onUpdateModel={onUpdateModel}
        onDeleteNode={onDeleteNode}
        onStartReconnect={onStartReconnect}
        showWorkspace={showWorkspace}
        selectedId={selectedId}
        workspaceInfo={workspaceInfo}
        onRefreshWorkspace={onRefreshWorkspace}
        onCloseWorkspace={onCloseWorkspace}
        onOpenFile={onOpenFile}
        onOpenStuard={onOpenStuard}
      />
    </>
  );
}
