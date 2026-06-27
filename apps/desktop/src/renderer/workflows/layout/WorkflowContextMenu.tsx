import {
  Boxes,
  Clipboard,
  ClipboardPaste,
  Copy,
  LayoutGrid,
  Lock,
  Maximize2,
  Play,
  Scissors,
  Settings,
  SkipForward,
  Trash,
  Ungroup,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { DesignerModel } from "../types";
import type { WorkflowContextMenu } from "./types";
import { useWorkflowGroupsContext } from "../WorkflowGroupsContext";

interface WorkflowContextMenuProps {
  contextMenu: WorkflowContextMenu | null;
  model: DesignerModel | null;
  selectedNodeIds: Set<string>;
  onClose: () => void;
  onRunStep: (nodeId: string) => void;
  onRunFromHere: (nodeId: string) => void;
  onDuplicateNode: () => void;
  onCopyNodes: () => void;
  onCutNodes: () => void;
  onPasteNodes: () => void;
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
  onCopyNodes,
  onCutNodes,
  onPasteNodes,
  onDeleteNode,
  onStartReconnect,
  onEditWire,
  onDeleteWire,
  onAutoOrganize,
  onZoomReset,
  onZoomIn,
  onZoomOut,
}: WorkflowContextMenuProps) {
  const groups = useWorkflowGroupsContext();
  // Selection forms an existing group exactly? → offer Ungroup instead of Group.
  const existingGroup = groups?.groups.find(
    (g) =>
      selectedNodeIds.size > 0 &&
      g.memberIds.length === selectedNodeIds.size &&
      g.memberIds.every((id) => selectedNodeIds.has(id)),
  );

  if (!contextMenu) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={onClose}>
      <div
        className="absolute rounded-[20px] shadow-2xl py-2 min-w-[200px] animate-in fade-in zoom-in-95 duration-100 overflow-hidden wf-menu"
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
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-500/10 flex items-center gap-2.5 transition-colors wf-menu-item"
                    >
                      <Play className="w-4 h-4 text-emerald-400" />
                      <span>Run Step</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onRunFromHere(contextMenu.nodeId!);
                      onClose();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-500/10 flex items-center gap-2.5 transition-colors wf-menu-item"
                  >
                    <SkipForward className="w-4 h-4 text-indigo-400" />
                    <span>{isTrigger ? "Run from Trigger" : "Run from Here"}</span>
                  </button>
                  <div className="h-px my-1 wf-menu-divider" />
                </>
              );
            })()}

            {model?.locked ? (
              <div className="px-4 py-2.5 text-xs flex items-center gap-2 wf-menu-item-muted">
                <Lock className="w-3.5 h-3.5" />
                <span>Editing locked</span>
              </div>
            ) : (
              <>
                {selectedNodeIds.size > 1 && (
                  <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-blue-500 border-b flex items-center gap-1.5 wf-menu-header">
                    <span>{selectedNodeIds.size} nodes selected</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    onCopyNodes();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                >
                  <Copy className="w-4 h-4 wf-menu-item-muted" />
                  <span>Copy{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                    Ctrl+C
                  </span>
                </button>

                <button
                  onClick={() => {
                    onCutNodes();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                >
                  <Scissors className="w-4 h-4 wf-menu-item-muted" />
                  <span>Cut{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                    Ctrl+X
                  </span>
                </button>

                <button
                  onClick={() => {
                    onPasteNodes();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                >
                  <ClipboardPaste className="w-4 h-4 wf-menu-item-muted" />
                  <span>Paste</span>
                  <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                    Ctrl+V
                  </span>
                </button>

                <button
                  onClick={() => {
                    onDuplicateNode();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                >
                  <Clipboard className="w-4 h-4 wf-menu-item-muted" />
                  <span>Duplicate{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                    Ctrl+D
                  </span>
                </button>

                {groups && selectedNodeIds.size > 1 && !existingGroup && (
                  <button
                    onClick={() => {
                      const id = groups.createGroup(Array.from(selectedNodeIds));
                      if (id) groups.setCollapsed(id, true);
                      onClose();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                  >
                    <Boxes className="w-4 h-4 [color:var(--wf-accent)]" />
                    <span>Group {selectedNodeIds.size} nodes</span>
                    <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                      Ctrl+G
                    </span>
                  </button>
                )}

                {groups && existingGroup && (
                  <button
                    onClick={() => {
                      groups.ungroup(existingGroup.id);
                      onClose();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                  >
                    <Ungroup className="w-4 h-4 wf-menu-item-muted" />
                    <span>Ungroup</span>
                  </button>
                )}

                <div className="h-px my-1 wf-menu-divider" />

                <button
                  onClick={() => {
                    onDeleteNode();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors group wf-menu-item-danger"
                >
                  <Trash className="w-4 h-4 text-red-400 group-hover:text-red-500" />
                  <span>Delete{selectedNodeIds.size > 1 ? ` ${selectedNodeIds.size} nodes` : ""}</span>
                  <span className="ml-auto text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 group-hover:border-red-500/40">
                    Del
                  </span>
                </button>
              </>
            )}
          </>
        ) : contextMenu.type === "wire" && contextMenu.wireIndex !== undefined ? (
          <>
            {(() => {
              const wireIndex = contextMenu.wireIndex;
              const wire = model?.wires[wireIndex];
              const sourceNode = wire
                ? [...(model?.triggers || []), ...(model?.nodes || [])].find((n) => n.id === wire.from)
                : null;
              const targetNode = wire
                ? [...(model?.triggers || []), ...(model?.nodes || [])].find((n) => n.id === wire.to)
                : null;

              return (
                <>
                  <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider wf-menu-header">
                    Connection
                  </div>

                  {model?.locked ? (
                    <div className="px-4 py-2.5 text-xs flex items-center gap-2 wf-menu-item-muted">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Editing locked</span>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onStartReconnect(wireIndex, "from");
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-500/10 flex items-center gap-2.5 transition-colors wf-menu-item"
                      >
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span>Change Source</span>
                        <span className="ml-auto text-[10px] truncate max-w-[80px] wf-menu-item-muted">
                          {sourceNode?.label || wire?.from}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          onStartReconnect(wireIndex, "to");
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-500/10 flex items-center gap-2.5 transition-colors wf-menu-item"
                      >
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span>Change Target</span>
                        <span className="ml-auto text-[10px] truncate max-w-[80px] wf-menu-item-muted">
                          {targetNode?.label || wire?.to}
                        </span>
                      </button>

                      <div className="h-px my-1 wf-menu-divider" />

                      <button
                        onClick={() => {
                          onEditWire(wireIndex);
                          onClose();
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                      >
                        <Settings className="w-4 h-4 wf-menu-item-muted" />
                        <span>Edit Properties</span>
                      </button>

                      <div className="h-px my-1 wf-menu-divider" />

                      <button
                        onClick={() => {
                          onDeleteWire(wireIndex);
                          onClose();
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors group wf-menu-item-danger"
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
            {!model?.locked && (
              <>
                <button
                  onClick={() => {
                    onPasteNodes();
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
                >
                  <ClipboardPaste className="w-4 h-4 wf-menu-item-muted" />
                  <span>Paste</span>
                  <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded wf-menu-shortcut">
                    Ctrl+V
                  </span>
                </button>
                <div className="h-px my-1 wf-menu-divider" />
              </>
            )}

            <button
              onClick={() => {
                onAutoOrganize();
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-500/10 flex items-center gap-2.5 transition-colors wf-menu-item"
            >
              <LayoutGrid className="w-4 h-4 text-indigo-400" />
              <span>Auto Arrange</span>
            </button>

            <button
              onClick={() => {
                onZoomReset();
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
            >
              <Maximize2 className="w-4 h-4 wf-menu-item-muted" />
              <span>Fit to Screen</span>
            </button>

            <div className="h-px my-1 wf-menu-divider" />

            <button
              onClick={() => {
                onZoomIn();
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
            >
              <ZoomIn className="w-4 h-4 wf-menu-item-muted" />
              <span>Zoom In</span>
            </button>

            <button
              onClick={() => {
                onZoomOut();
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors wf-menu-item"
            >
              <ZoomOut className="w-4 h-4 wf-menu-item-muted" />
              <span>Zoom Out</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
