/**
 * WorkflowGroupBox — renders a visual node group on the canvas.
 *  - variant "collapsed": a node-sized tile that stands in for hidden members.
 *  - variant "frame":     a labeled frame drawn behind expanded members.
 *
 * Pure presentation over editor-only group state — never touches the model
 * except by asking the parent to offset member positions on drag (onMoveBy).
 */
import React, { useEffect, useRef, useState } from "react";
import { Boxes, Maximize2, Minimize2, Ungroup, GripVertical } from "lucide-react";
import type { GroupBox } from "../utils/groupGeometry";
import type { NodeGroup } from "../hooks/useWorkflowGroups";

interface WorkflowGroupBoxProps {
  group: NodeGroup;
  box: GroupBox;
  variant: "collapsed" | "frame";
  memberCount: number;
  zoom: number;
  selected?: boolean;
  onSelect?: () => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onUngroup: () => void;
  /** Drag committed once on release, in content-space pixels. */
  onMoveBy?: (dx: number, dy: number) => void;
}

export function WorkflowGroupBox({
  group, box, variant, memberCount, zoom, selected,
  onSelect, onToggleCollapse, onRename, onUngroup, onMoveBy,
}: WorkflowGroupBoxProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => { if (!editing) setDraft(group.name); }, [group.name, editing]);

  const commitName = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== group.name) onRename(draft.trim());
  };

  const startDrag = (e: React.PointerEvent) => {
    if (!onMoveBy) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    setDragOffset({ x: 0, y: 0 });

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      setDragOffset({
        x: (ev.clientX - dragRef.current.startX) / zoom,
        y: (ev.clientY - dragRef.current.startY) / zoom,
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRef.current) {
        const dx = (ev.clientX - dragRef.current.startX) / zoom;
        const dy = (ev.clientY - dragRef.current.startY) / zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) onMoveBy(dx, dy);
        else onSelect?.();
      }
      dragRef.current = null;
      setDragOffset(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const nameEl = editing ? (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitName}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitName();
        if (e.key === "Escape") { setEditing(false); setDraft(group.name); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="text-xs font-bold bg-transparent border-b border-current outline-none w-full wf-fg"
    />
  ) : (
    <span
      className="text-xs font-bold truncate wf-fg cursor-text"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Double-click to rename"
    >
      {group.name}
    </span>
  );

  const dragStyle = dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined;
  const accentBorder = selected ? "var(--wf-accent)" : "color-mix(in srgb, var(--wf-accent) 55%, var(--wf-border))";

  if (variant === "frame") {
    return (
      <div
        className="absolute rounded-2xl pointer-events-none"
        style={{
          left: box.x, top: box.y, width: box.w, height: box.h,
          ...dragStyle,
          border: `2px solid ${accentBorder}`,
          background: selected
            ? "color-mix(in srgb, var(--wf-accent) 8%, transparent)"
            : "color-mix(in srgb, var(--wf-accent) 4%, transparent)",
          boxShadow: selected ? "0 0 0 4px color-mix(in srgb, var(--wf-accent) 15%, transparent)" : undefined,
        }}
      >
        {/* Header — drag handle + controls */}
        <div
          className="absolute left-0 top-0 flex items-center gap-2 px-3 h-[32px] rounded-tl-2xl rounded-br-xl pointer-events-auto wf-overlay-chip cursor-grab active:cursor-grabbing"
          style={{ maxWidth: Math.min(box.w, 320) }}
          onPointerDown={startDrag}
          onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
        >
          <GripVertical className="w-3 h-3 shrink-0 wf-fg-faint" />
          <Boxes className="w-3.5 h-3.5 shrink-0 [color:var(--wf-accent)]" />
          <div className="min-w-0 flex-1">{nameEl}</div>
          <span className="text-[10px] font-medium wf-fg-muted shrink-0 tabular-nums">{memberCount}</span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={onToggleCollapse} className="p-1 rounded-md wf-overlay-btn" title="Collapse group">
              <Minimize2 className="w-3 h-3" />
            </button>
            <button onClick={onUngroup} className="p-1 rounded-md wf-overlay-btn" title="Ungroup">
              <Ungroup className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Collapsed tile (node-sized).
  return (
    <div
      className={`absolute rounded-[20px] border-2 shadow-sm transition-shadow select-none wf-node-card ${
        selected ? "ring-4 ring-[color:var(--wf-accent)]/25 z-20" : "wf-border-subtle hover:shadow-md z-10"
      }`}
      style={{
        left: box.x, top: box.y, width: box.w, height: box.h,
        ...dragStyle,
        cursor: dragOffset ? "grabbing" : "grab",
        background: "var(--wf-bg-elevated)",
        borderColor: selected ? "var(--wf-accent)" : undefined,
      }}
      onPointerDown={startDrag}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
    >
      {/* Stacked-cards hint */}
      <div
        className="absolute -top-1.5 left-3 right-3 h-3 rounded-t-xl border wf-border-subtle pointer-events-none"
        style={{ background: "var(--wf-bg-overlay)", zIndex: -1 }}
      />
      <div
        className="absolute -top-3 left-5 right-5 h-2.5 rounded-t-lg border wf-border-subtle pointer-events-none opacity-60"
        style={{ background: "var(--wf-bg-overlay)", zIndex: -2 }}
      />

      <div className="h-full px-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center wf-accent-soft [color:var(--wf-accent)]">
          <Boxes className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="min-w-0">{nameEl}</div>
          <div className="text-[10px] font-medium mt-0.5 wf-fg-muted">{memberCount} steps · grouped</div>
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            className="p-1.5 rounded-lg wf-overlay-btn"
            title="Expand group"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onUngroup(); }}
            className="p-1 rounded-lg wf-overlay-btn opacity-70 hover:opacity-100"
            title="Ungroup"
          >
            <Ungroup className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
