import React from "react";
import type { ValidationError } from "../builder/compiler";
import { CodePanel } from "../components/CodePanel";
import { InspectorPanel } from "../components/InspectorPanel";
import { WireInspectorPanel } from "../components/WireInspectorPanel";
import { WorkflowDocsPanel } from "../components/WorkflowDocsPanel";
import { WorkflowLogsPanel } from "../components/WorkflowLogsPanel";
import { WorkspaceExplorer } from "../components/WorkspaceExplorer";
import type { DesignerModel } from "../types";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import type { RightPanel, WorkspaceInfo } from "./types";

interface WorkflowRightPanelsProps {
  rightPanel: RightPanel;
  /** True while the floating AI panel is open — docked panels dock to its left. */
  aiOpen: boolean;
  /** Current width of the AI panel, used to offset docked panels beside it. */
  aiLeftWidth: number;
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
  onOpenStuard?: (subPath: string) => void;
  logs: Array<{ ts: string; msg: string }>;
  onClearLogs: () => void;
  onSendLogsToChat: (text: string) => void;
}

export function WorkflowRightPanels({
  rightPanel,
  aiOpen,
  aiLeftWidth,
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
  onOpenStuard,
  logs,
  onClearLogs,
  onSendLogsToChat,
}: WorkflowRightPanelsProps) {
  // The AI panel is pinned to the far right (its right-20 anchor = 80px). When
  // it's open, docked panels and the workspace sit just to its left so both can
  // be visible at once; otherwise they take the far-right slot themselves.
  const FAR_RIGHT = 80;
  const GAP = 12;
  const dockedRight = aiOpen ? FAR_RIGHT + aiLeftWidth + GAP : FAR_RIGHT;
  return (
    <>
      {rightPanel !== "none" && rightPanel !== "ai" && (
        <div
          className="absolute top-24 bottom-24 flex z-20 shadow-2xl rounded-xl overflow-hidden pointer-events-auto border wf-panel"
          style={{ backdropFilter: 'var(--wf-glass-blur)', width: manualRightWidth, right: dockedRight }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize transition-colors z-30 wf-resize-handle"
            onMouseDown={onStartResizeManualRight}
            onDoubleClick={onResetManualRightWidth}
          />
          <div className="flex flex-col shrink-0 min-h-0 relative w-full h-full pl-2">
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

            {rightPanel === "docs" && (
              <PanelErrorBoundary name="Docs">
                <WorkflowDocsPanel onClose={() => onSetRightPanel("none")} />
              </PanelErrorBoundary>
            )}

            {rightPanel === "logs" && (
              <PanelErrorBoundary name="Logs">
                <WorkflowLogsPanel
                  logs={logs}
                  onClear={onClearLogs}
                  onSendToChat={onSendLogsToChat}
                  onClose={() => onSetRightPanel("none")}
                />
              </PanelErrorBoundary>
            )}
          </div>
        </div>
      )}

      {showWorkspace && selectedId && rightPanel === "none" && (
        <div
          className="absolute top-24 bottom-24 z-20 flex flex-col shrink-0 shadow-2xl rounded-xl overflow-hidden pointer-events-auto border wf-panel"
          style={{ backdropFilter: 'var(--wf-glass-blur)', width: 280, right: dockedRight }}
        >
          <PanelErrorBoundary name="Workspace">
            <WorkspaceExplorer
              flowId={selectedId}
              workspaceInfo={workspaceInfo}
              variables={model?.variables}
              onRefresh={onRefreshWorkspace}
              onClose={onCloseWorkspace}
              onOpenFile={onOpenFile}
              onOpenStuard={onOpenStuard}
            />
          </PanelErrorBoundary>
        </div>
      )}
    </>
  );
}
