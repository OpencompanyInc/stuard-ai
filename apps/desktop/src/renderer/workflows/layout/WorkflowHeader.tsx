import { BookOpen, ChevronDown, Home, Code, FolderOpen, Layout, Lock, Play, Redo2, Rocket, Save, Settings, Sparkles, Square, Undo2, Zap } from "lucide-react";
import type { DesignerModel, DesignerTrigger } from "../types";
import type { RightPanel } from "./types";

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
  viewMode: "ai" | "manual" | "none";
  rightPanel: RightPanel;
  showWorkspace: boolean;
  onSetViewMode: (mode: "ai" | "manual" | "none") => void;
  onToggleInspector: () => void;
  onToggleDocs: () => void;
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
  onToggleDocs,
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
    <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-30 pointer-events-none">
      <div className="flex items-center gap-4 min-w-0 pointer-events-auto">
        <div className="flex items-center gap-2 rounded-full shadow-lg px-2 py-1.5 border wf-panel" style={{ backdropFilter: 'var(--wf-glass-blur)' }}>
          <div className="flex items-center gap-2 select-none shrink-0 pl-1 pr-2">
            {onClose ? (
              <button
                onClick={onClose}
                className="flex items-center justify-center p-1 rounded-full wf-fg-muted wf-hover-fg transition-colors"
                title="Home"
              >
                <Home className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center justify-center p-1 wf-fg-muted">
                <Home className="w-4 h-4" />
              </div>
            )}
            <div className="h-4 w-px mx-1 wf-border-subtle" style={{ background: 'var(--wf-border)' }} />
            <span className="text-[13px] font-bold tracking-tight wf-fg">{model?.name || selectedId || 'Workflow'}</span>
          </div>

          {model && dirty && (
            <>
              <div className="h-4 w-px mx-1" style={{ background: 'var(--wf-border)' }} />
              <div className="flex items-center gap-2 no-drag min-w-0 pr-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border" style={{ background: 'var(--wf-bg-overlay)', borderColor: 'var(--wf-border)' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" title="Unsaved changes" />
                  <span className="text-[10px] font-medium text-amber-500/80">Unsaved</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 no-drag shrink-0 pointer-events-auto">
        {model && (
          <div className="flex items-center gap-2 rounded-full shadow-lg p-1.5 border wf-panel" style={{ backdropFilter: 'var(--wf-glass-blur)' }}>
            {/* Undo/Redo/Save */}
            <div className="flex items-center gap-0.5 px-1">
              <button onClick={onUndo} disabled={!canUndo || model.locked} className={`p-1.5 rounded-full transition-all ${canUndo && !model.locked ? "wf-fg-muted wf-hover-fg" : "wf-fg-faint opacity-40"}`} title="Undo">
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onRedo} disabled={!canRedo || model.locked} className={`p-1.5 rounded-full transition-all ${canRedo && !model.locked ? "wf-fg-muted wf-hover-fg" : "wf-fg-faint opacity-40"}`} title="Redo">
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onSave} disabled={!dirty} className={`p-1.5 rounded-full transition-all ${dirty ? "wf-fg-muted wf-hover-fg" : "wf-fg-faint opacity-40"}`} title="Save">
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-4 w-px mx-1" style={{ background: 'var(--wf-border)' }} />

            {/* Run / Stop */}
            {isRunning ? (
              <button onClick={onStop} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-full flex items-center gap-1.5 text-[11px] font-medium transition-all border border-red-500/20">
                <Square className="w-3 h-3 fill-current" /> Stop
              </button>
            ) : manualTriggers.length > 1 ? (
              <div className="relative">
                <div className="flex">
                  <button onClick={() => onRun()} className="px-3 py-1.5 rounded-l-full flex items-center gap-1.5 text-[11px] font-medium transition-all wf-header-action-btn">
                    <Play className="w-3 h-3 fill-current" /> Run
                  </button>
                  <button onClick={() => setShowRunMenu(!showRunMenu)} className="px-1.5 py-1.5 rounded-r-full transition-all wf-header-action-btn wf-header-action-btn-split">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                {showRunMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowRunMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-2xl py-1 min-w-[170px] overflow-hidden wf-menu">
                      <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider mb-1 wf-menu-header">Triggers</div>
                      {manualTriggers.map((trigger) => (
                        <button key={trigger.id} onClick={() => onRun(trigger.id)} className="w-full px-4 py-2 text-left text-[12px] flex items-center gap-2 transition-colors wf-menu-item">
                          <Play className="w-3 h-3 text-emerald-400" /> {trigger.label || trigger.id}
                        </button>
                      ))}
                      <div className="mt-1 pt-1 wf-menu-header" style={{ borderBottom: 'none' }}>
                        <button onClick={() => onRun()} className="w-full px-4 py-2 text-left text-[12px] flex items-center gap-2 transition-colors wf-menu-item">
                          <Zap className="w-3 h-3 text-indigo-400" /> Run All
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button onClick={() => onRun()} className="px-3 py-1.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium transition-all wf-header-action-btn">
                <Play className="w-3 h-3 fill-current" /> Run
              </button>
            )}

            {/* Deploy */}
            <button
              onClick={onToggleDeployPanel}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-full transition-all ${deployStatus?.deployed
                ? "border border-emerald-500 text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
                : "wf-primary-btn"
                }`}
            >
              <Rocket className="w-3 h-3" />
              {deployStatus?.deployed ? "Live" : "Deploy"}
              {deployStatus?.running && <span className={`w-1.5 h-1.5 rounded-full animate-pulse ml-0.5 ${deployStatus.deployed ? 'bg-emerald-500' : 'bg-current'}`} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
