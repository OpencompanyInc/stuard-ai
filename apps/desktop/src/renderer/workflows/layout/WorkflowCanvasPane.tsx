import React from "react";
import { WorkflowCanvas } from "../components/WorkflowCanvas";
import { WorkspaceFileEditor } from "../components/WorkspaceFileEditor";
import type { DesignerModel } from "../types";
import type { ExecutionState, OpenFileTab } from "./types";
import { WorkflowTabs } from "./WorkflowTabs";

interface WorkflowCanvasPaneProps {
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
  floatingContent?: React.ReactNode;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
  /** Breadcrumbs for sub-workflow navigation */
  breadcrumbs?: Array<{ label: string; path: string | null }>;
  /** Current sub-workflow path (null = main) */
  currentSubPath?: string | null;
  /** Navigate back to parent workflow */
  onNavigateBack?: () => void;
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
}

export function WorkflowCanvasPane({
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
  floatingContent,
  onSetActiveTab,
  onCloseFileTab,
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
  breadcrumbs,
  currentSubPath,
  onNavigateBack,
}: WorkflowCanvasPaneProps) {
  const activeFileTab = activeTab !== "canvas" ? openTabs.find((t) => t.filePath === activeTab) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <WorkflowTabs
          openTabs={openTabs}
          activeTab={activeTab}
          onSetActiveTab={onSetActiveTab}
          onCloseFileTab={onCloseFileTab}
          breadcrumbs={breadcrumbs}
          currentSubPath={currentSubPath}
          onNavigateBack={onNavigateBack}
          modelName={model.name || selectedId}
        />
      </div>

      <div className="flex-1 relative h-full" style={{ display: activeTab === "canvas" ? "block" : "none" }}>
        <WorkflowCanvas
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
        />
      </div>

      {activeFileTab && (
        <div className="flex-1 min-h-0 flex h-full">
          <WorkspaceFileEditor
            flowId={selectedId}
            filePath={activeFileTab.filePath}
            fileName={activeFileTab.fileName}
          />
        </div>
      )}

      {floatingContent}
    </div>
  );
}
