import { ChevronDown, ChevronLeft, Code, FolderOpen, Layout, Lock, Play, Redo2, Rocket, Save, Settings, Sparkles, Square, Undo2, Zap } from "lucide-react";
import type { DesignerModel, DesignerTrigger } from "../types";

interface DeployStatus {
  deployed: boolean;
  running: boolean;
  triggers: string[];
}

interface WorkflowHeaderProps {
  model: DesignerModel | null;
  selectedId: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isRunning: boolean;
  manualTriggers: DesignerTrigger[];
  showRunMenu: boolean;
  setShowRunMenu: (open: boolean) => void;
  deployStatus: DeployStatus | null;
  viewMode: "ai" | "manual";
  rightPanel: "none" | "inspector" | "code" | "ai";
  showWorkspace: boolean;
  onSetViewMode: (mode: "ai" | "manual") => void;
  onToggleInspector: () => void;
  onToggleCode: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRun: (triggerId?: string) => void;
  onStop: () => void;
  onToggleDeployPanel: () => void;
  onToggleWorkspace: () => void;
  onClose?: () => void;
}

export function WorkflowHeader({
  model,
  selectedId,
  dirty,
  canUndo,
  canRedo,
  isRunning,
  manualTriggers,
  showRunMenu,
  setShowRunMenu,
  deployStatus,
  viewMode,
  rightPanel,
  showWorkspace,
  onSetViewMode,
  onToggleInspector,
  onToggleCode,
  onSave,
  onUndo,
  onRedo,
  onRun,
  onStop,
  onToggleDeployPanel,
  onToggleWorkspace,
  onClose,
}: WorkflowHeaderProps) {
  return (
    <div className="drag h-11 bg-white border-b border-slate-200 flex items-center px-3 shrink-0 justify-between z-30 relative">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 select-none shrink-0">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-sky-600 rounded-md flex items-center justify-center text-white">
            <Zap className="w-3 h-3 fill-current" />
          </div>
          <span className="text-[13px] font-bold text-slate-800 tracking-tight font-stuard">Studio</span>
        </div>

        <div className="h-4 w-px bg-slate-200" />

        {model && (
          <div className="flex items-center gap-2 no-drag min-w-0">
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Back to workflows"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <span className="text-[13px] font-medium text-slate-700 truncate">{model.name || selectedId}</span>
            {dirty && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Unsaved changes" />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 no-drag shrink-0">
        {model ? (
          <>
            {model.locked && (
              <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-amber-700 text-[11px] font-medium">
                <Lock className="w-3 h-3" /> Locked
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg">
              <button
                onClick={() => !model.locked && onSetViewMode("ai")}
                disabled={model.locked}
                title={model.locked ? "Not available for locked workflows" : "Design with AI"}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                  model.locked ? "text-slate-300 cursor-not-allowed"
                    : viewMode === "ai" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Sparkles className="w-3 h-3" /> Design
              </button>
              <button
                onClick={() => onSetViewMode("manual")}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                  viewMode === "manual" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Layout className="w-3 h-3" /> Build
              </button>
            </div>

            <div className="h-4 w-px bg-slate-200" />

            {/* Undo/Redo/Save */}
            <div className="flex items-center gap-0.5">
              <button onClick={onUndo} disabled={!canUndo || model.locked} className={`p-1.5 rounded-md transition-all ${canUndo && !model.locked ? "text-slate-600 hover:bg-slate-100" : "text-slate-300"}`} title="Undo">
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onRedo} disabled={!canRedo || model.locked} className={`p-1.5 rounded-md transition-all ${canRedo && !model.locked ? "text-slate-600 hover:bg-slate-100" : "text-slate-300"}`} title="Redo">
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onSave} disabled={!dirty} className={`p-1.5 rounded-md transition-all ${dirty ? "text-slate-600 hover:bg-slate-100" : "text-slate-300"}`} title="Save">
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-4 w-px bg-slate-200" />

            {/* Run / Stop */}
            {isRunning ? (
              <button onClick={onStop} className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded-md flex items-center gap-1.5 text-[11px] font-medium transition-all">
                <Square className="w-3 h-3 fill-current" /> Stop
              </button>
            ) : manualTriggers.length > 1 ? (
              <div className="relative">
                <div className="flex">
                  <button onClick={() => onRun()} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-l-md flex items-center gap-1.5 text-[11px] font-medium transition-all">
                    <Play className="w-3 h-3 fill-current" /> Run
                  </button>
                  <button onClick={() => setShowRunMenu(!showRunMenu)} className="px-1 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-r-md border-l border-emerald-500 transition-all">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                {showRunMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowRunMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[170px]">
                      <div className="px-3 py-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider">Triggers</div>
                      {manualTriggers.map((trigger) => (
                        <button key={trigger.id} onClick={() => onRun(trigger.id)} className="w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                          <Play className="w-3 h-3 text-emerald-500" /> {trigger.label || trigger.id}
                        </button>
                      ))}
                      <div className="border-t border-slate-100 mt-0.5 pt-0.5">
                        <button onClick={() => onRun()} className="w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                          <Zap className="w-3 h-3 text-indigo-500" /> Run All
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button onClick={() => onRun()} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-1.5 text-[11px] font-medium transition-all">
                <Play className="w-3 h-3 fill-current" /> Run
              </button>
            )}

            {/* Deploy */}
            <button
              onClick={onToggleDeployPanel}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all border ${
                deployStatus?.deployed
                  ? "bg-slate-800 text-white border-slate-800 hover:bg-slate-700"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600"
              }`}
            >
              <Rocket className="w-3 h-3" />
              {deployStatus?.deployed ? "Live" : "Deploy"}
              {deployStatus?.running && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />}
            </button>

            <div className="h-4 w-px bg-slate-200" />

            {/* Panel toggles */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={onToggleWorkspace}
                className={`p-1.5 rounded-md transition-colors ${showWorkspace ? "bg-amber-50 text-amber-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                title="Workspace"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              {viewMode === "manual" && (
                <>
                  <button
                    onClick={onToggleInspector}
                    disabled={model.locked}
                    className={`p-1.5 rounded-md transition-colors ${model.locked ? "text-slate-300" : rightPanel === "inspector" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                    title="Details"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onToggleCode}
                    disabled={model.locked}
                    className={`p-1.5 rounded-md transition-colors ${model.locked ? "text-slate-300" : rightPanel === "code" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                    title="JSON"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-slate-400 font-medium">Select a workflow</div>
        )}
      </div>
    </div>
  );
}
