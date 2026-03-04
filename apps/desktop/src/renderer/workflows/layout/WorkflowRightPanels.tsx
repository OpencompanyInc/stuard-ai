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
  return (
    <>
      {rightPanel !== "none" && rightPanel !== "ai" && (
        <div
          className="absolute right-20 top-24 bottom-24 flex z-20 shadow-2xl rounded-xl overflow-hidden bg-white/[0.06] backdrop-blur-2xl border border-white/[0.1] pointer-events-auto"
          style={{ width: manualRightWidth }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/10 transition-colors z-30"
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
          className="absolute right-20 top-24 bottom-24 z-20 bg-white/[0.06] backdrop-blur-2xl border border-white/[0.1] flex flex-col shrink-0 shadow-2xl rounded-xl overflow-hidden pointer-events-auto"
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
              onOpenStuard={onOpenStuard}
            />
          </PanelErrorBoundary>
        </div>
      )}
    </>
  );
}
