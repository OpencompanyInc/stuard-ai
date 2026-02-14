import React from "react";
import type { ValidationError } from "../builder/compiler";
import { CodePanel } from "../components/CodePanel";
import { InspectorPanel } from "../components/InspectorPanel";
import { WireInspectorPanel } from "../components/WireInspectorPanel";
import { WorkspaceExplorer } from "../components/WorkspaceExplorer";
import type { DesignerModel } from "../types";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import type { RightPanel, WorkspaceInfo } from "./types";

interface WorkflowRightPanelsProps {
  rightPanel: RightPanel;
  manualRightWidth: number;
  onStartResizeManualRight: (e: React.MouseEvent) => void;
  onResetManualRightWidth: () => void;
  model: DesignerModel;
  errors: ValidationError[];
  selectedNodeId: string;
  selectedWireIndex: number | null;
  onSetSelectedWireIndex: (value: number | null) => void;
  onSetRightPanel: (value: RightPanel) => void;
  onUpdateModel: (model: DesignerModel) => void;
  onDeleteNode: () => void;
  onStartReconnect: (wireIndex: number, end: "from" | "to") => void;
  showWorkspace: boolean;
  selectedId: string;
  workspaceInfo: WorkspaceInfo | null;
  onRefreshWorkspace: () => void;
  onCloseWorkspace: () => void;
  onOpenFile: (filePath: string, fileName: string) => void;
}

export function WorkflowRightPanels({
  rightPanel,
  manualRightWidth,
  onStartResizeManualRight,
  onResetManualRightWidth,
  model,
  errors,
  selectedNodeId,
  selectedWireIndex,
  onSetSelectedWireIndex,
  onSetRightPanel,
  onUpdateModel,
  onDeleteNode,
  onStartReconnect,
  showWorkspace,
  selectedId,
  workspaceInfo,
  onRefreshWorkspace,
  onCloseWorkspace,
  onOpenFile,
}: WorkflowRightPanelsProps) {
  return (
    <>
      {rightPanel !== "none" && (
        <>
          <div
            className="w-1 hover:w-1.5 bg-slate-200/50 hover:bg-indigo-400/50 cursor-col-resize shrink-0 transition-all duration-200"
            onMouseDown={onStartResizeManualRight}
            onDoubleClick={onResetManualRightWidth}
          />
          <div
            className="bg-white border-l border-slate-200 flex flex-col shrink-0 z-20 shadow-xl relative transition-all duration-300 min-h-0 overflow-hidden"
            style={{ width: manualRightWidth }}
          >
            {rightPanel === "inspector" && (
              <PanelErrorBoundary name="Inspector">
                {selectedWireIndex !== null ? (
                  <WireInspectorPanel
                    model={model}
                    wireIndex={selectedWireIndex}
                    onUpdate={onUpdateModel}
                    onDelete={() => {
                      onUpdateModel({ ...model, wires: model.wires.filter((_, j) => j !== selectedWireIndex) });
                      onSetSelectedWireIndex(null);
                    }}
                    onClose={() => {
                      onSetRightPanel("none");
                      onSetSelectedWireIndex(null);
                    }}
                    onReconnect={(end) => onStartReconnect(selectedWireIndex, end)}
                  />
                ) : (
                  <InspectorPanel
                    model={model}
                    selectedNodeId={selectedNodeId}
                    onUpdate={onUpdateModel}
                    onDelete={onDeleteNode}
                    onClose={() => onSetRightPanel("none")}
                  />
                )}
              </PanelErrorBoundary>
            )}

            {rightPanel === "code" && (
              <PanelErrorBoundary name="Code">
                <CodePanel model={model} errors={errors} onClose={() => onSetRightPanel("none")} onUpdateModel={onUpdateModel} />
              </PanelErrorBoundary>
            )}
          </div>
        </>
      )}

      {showWorkspace && selectedId && (
        <div
          className="bg-white border-l border-slate-200 flex flex-col shrink-0 z-20 shadow-xl relative transition-all duration-300 min-h-0 overflow-hidden"
          style={{ width: 280 }}
        >
          <PanelErrorBoundary name="Workspace">
            <WorkspaceExplorer
              flowId={selectedId}
              workspaceInfo={workspaceInfo}
              variables={model?.variables}
              onRefresh={onRefreshWorkspace}
              onClose={onCloseWorkspace}
              onOpenFile={onOpenFile}
            />
          </PanelErrorBoundary>
        </div>
      )}
    </>
  );
}
