import {
  Copy,
  LayoutGrid,
  Lock,
  Maximize2,
  Play,
  Settings,
  SkipForward,
  Trash,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { DesignerModel } from "../types";
import type { WorkflowContextMenu } from "./types";

interface WorkflowContextMenuProps {
  contextMenu: WorkflowContextMenu | null;
  model: DesignerModel | null;
  selectedNodeIds: Set<string>;
  onClose: () => void;
  onRunStep: (nodeId: string) => void;
  onRunFromHere: (nodeId: string) => void;
  onDuplicateNode: () => void;
  onDeleteNode: () => void;
  onStartReconnect: (wireIndex: number, end: "from" | "to") => void;
  onEditWire: (wireIndex: number) => void;
  onDeleteWire: (wireIndex: number) => void;
  onAutoOrganize: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function WorkflowContextMenuOverlay({
  contextMenu,
  model,
  selectedNodeIds,
  onClose,
  onRunStep,
  onRunFromHere,
  onDuplicateNode,
  onDeleteNode,
  onStartReconnect,
  onEditWire,
  onDeleteWire,
  onAutoOrganize,
  onZoomReset,
  onZoomIn,
  onZoomOut,
}: WorkflowContextMenuProps) {
  if (!contextMenu) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={onClose}>
      <div
        className="absolute bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
        style={{
          top: Math.min(contextMenu.y, window.innerHeight - 200),
          left: Math.min(contextMenu.x, window.innerWidth - 200),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {contextMenu.type === "node" && contextMenu.nodeId ? (
          <>
            {(() => {
              const isTrigger = model?.triggers.some((t) => t.id === contextMenu.nodeId);
              return (
                <>
                  {!isTrigger && (
                    <button
                      onClick={() => {
                        onRunStep(contextMenu.nodeId!);
                        onClose();
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 flex items-center gap-2.5 transition-colors"
                    >
                      <Play className="w-4 h-4 text-emerald-500" />
                      <span>Run Step</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onRunFromHere(contextMenu.nodeId!);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2.5 transition-colors"
                  >
                    <SkipForward className="w-4 h-4 text-indigo-500" />
                    <span>{isTrigger ? "Run from Trigger" : "Run from Here"}</span>
                  </button>
                  <div className="h-px bg-slate-100 my-1" />
                </>
              );
            })()}

            {model?.locked ? (
              <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                <span>Editing locked</span>
              </div>
            ) : (
              <>
                {selectedNodeIds.size > 1 && (
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-500 border-b border-slate-100 flex items-center gap-1.5">
                    <span>{selectedNodeIds.size} nodes selected</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    onDuplicateNode();
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                >
                  <Copy className="w-4 h-4 text-slate-400" />
                  <span>Duplicate{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                    Ctrl+D
                  </span>
                </button>

                <div className="h-px bg-slate-100 my-1" />

                <button
                  onClick={() => {
                    onDeleteNode();
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors group"
                >
                  <Trash className="w-4 h-4 text-red-400 group-hover:text-red-500" />
                  <span>Delete{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium text-red-300 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 group-hover:text-red-500 group-hover:border-red-200">
                    Del
                  </span>
                </button>
              </>
            )}
          </>
        ) : contextMenu.type === "wire" && contextMenu.wireIndex !== undefined ? (
          <>
            {(() => {
              const wire = model?.wires[contextMenu.wireIndex];
              const sourceNode = wire
                ? [...(model?.triggers || []), ...(model?.nodes || [])].find((n) => n.id === wire.from)
                : null;
              const targetNode = wire
                ? [...(model?.triggers || []), ...(model?.nodes || [])].find((n) => n.id === wire.to)
                : null;

              return (
                <>
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    Connection
                  </div>

                  {model?.locked ? (
                    <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Editing locked</span>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onStartReconnect(contextMenu.wireIndex!, "from");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-amber-50 flex items-center gap-2.5 transition-colors"
                      >
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span>Change Source</span>
                        <span className="ml-auto text-[10px] text-slate-400 truncate max-w-[80px]">
                          {sourceNode?.label || wire?.from}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          onStartReconnect(contextMenu.wireIndex!, "to");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-amber-50 flex items-center gap-2.5 transition-colors"
                      >
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span>Change Target</span>
                        <span className="ml-auto text-[10px] text-slate-400 truncate max-w-[80px]">
                          {targetNode?.label || wire?.to}
                        </span>
                      </button>

                      <div className="h-px bg-slate-100 my-1" />

                      <button
                        onClick={() => {
                          onEditWire(contextMenu.wireIndex!);
                          onClose();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                      >
                        <Settings className="w-4 h-4 text-slate-400" />
                        <span>Edit Properties</span>
                      </button>

                      <div className="h-px bg-slate-100 my-1" />

                      <button
                        onClick={() => {
                          onDeleteWire(contextMenu.wireIndex!);
                          onClose();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors group"
                      >
                        <Trash className="w-4 h-4 text-red-400 group-hover:text-red-500" />
                        <span>Delete Connection</span>
                      </button>
                    </>
                  )}
                </>
              );
            })()}
          </>
        ) : (
          <>
            <button
              onClick={() => {
                onAutoOrganize();
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2.5 transition-colors"
            >
              <LayoutGrid className="w-4 h-4 text-indigo-400" />
              <span>Auto Arrange</span>
            </button>

            <button
              onClick={() => {
                onZoomReset();
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
            >
              <Maximize2 className="w-4 h-4 text-slate-400" />
              <span>Fit to Screen</span>
            </button>

            <div className="h-px bg-slate-100 my-1" />

            <button
              onClick={() => {
                onZoomIn();
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
            >
              <ZoomIn className="w-4 h-4 text-slate-400" />
              <span>Zoom In</span>
            </button>

            <button
              onClick={() => {
                onZoomOut();
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
            >
              <ZoomOut className="w-4 h-4 text-slate-400" />
              <span>Zoom Out</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
