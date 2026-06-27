/**
 * WorkflowMinimap - A small navigable overview of the whole canvas.
 *
 * Mirrors the n8n/Make minimap: a scaled-down map of every node plus a
 * draggable viewport rectangle. Click or drag inside it to pan the main canvas.
 * Purely a navigation aid — it reads node positions + the scroll container's
 * viewport and never mutates the model.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapIcon, ChevronDown } from "lucide-react";
import type { DesignerModel } from "../types";

const NODE_W = 256;
const NODE_H = 80;

// Inner drawing area of the minimap (px). The outer chrome adds padding.
const MAP_W = 196;
const MAP_H = 128;

interface WorkflowMinimapProps {
  model: DesignerModel;
  size: { w: number; h: number };
  zoom: number;
  canvasRef: React.RefObject<HTMLDivElement>;
}

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function WorkflowMinimap({ model, size, zoom, canvasRef }: WorkflowMinimapProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, w: 0, h: 0 });
  const draggingRef = useRef(false);

  // Scale content-space → minimap-space, preserving aspect ratio.
  const scale = Math.min(MAP_W / Math.max(size.w, 1), MAP_H / Math.max(size.h, 1));
  const drawW = size.w * scale;
  const drawH = size.h * scale;

  // Read the visible region from the scroll container (in content coordinates).
  const syncViewport = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    setViewport({
      x: el.scrollLeft / zoom,
      y: el.scrollTop / zoom,
      w: el.clientWidth / zoom,
      h: el.clientHeight / zoom,
    });
  }, [canvasRef, zoom]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    syncViewport();
    el.addEventListener("scroll", syncViewport, { passive: true });
    window.addEventListener("resize", syncViewport);
    return () => {
      el.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [canvasRef, syncViewport]);

  // Center the main canvas on the point clicked/dragged in the minimap.
  const panTo = useCallback(
    (clientX: number, clientY: number, svgEl: SVGSVGElement) => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = svgEl.getBoundingClientRect();
      const contentX = (clientX - rect.left) / scale;
      const contentY = (clientY - rect.top) / scale;
      const targetLeft = contentX * zoom - el.clientWidth / 2;
      const targetTop = contentY * zoom - el.clientHeight / 2;
      el.scrollLeft = Math.max(0, Math.min(targetLeft, el.scrollWidth - el.clientWidth));
      el.scrollTop = Math.max(0, Math.min(targetTop, el.scrollHeight - el.clientHeight));
    },
    [canvasRef, scale, zoom],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    panTo(e.clientX, e.clientY, e.currentTarget);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    panTo(e.clientX, e.clientY, e.currentTarget);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const allNodes = [
    ...model.triggers.map((n) => ({ id: n.id, position: n.position, isTrigger: true })),
    ...model.nodes.map((n) => ({ id: n.id, position: n.position, isTrigger: false })),
  ];

  return (
    <div className="absolute bottom-6 right-6 z-50 rounded-2xl shadow-lg overflow-hidden wf-overlay-chip select-none">
      {/* Header / collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors wf-overlay-btn"
        title={collapsed ? "Show minimap" : "Hide minimap"}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
          <MapIcon className="w-3 h-3" />
          Map
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} />
      </button>

      {!collapsed && (
        <div className="px-2 pb-2">
          <svg
            width={MAP_W}
            height={MAP_H}
            className="rounded-lg cursor-pointer wf-bg-canvas block"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* Nodes */}
            {allNodes.map((n) => (
              <rect
                key={n.id}
                x={n.position.x * scale}
                y={n.position.y * scale}
                width={Math.max(NODE_W * scale, 2)}
                height={Math.max(NODE_H * scale, 2)}
                rx={1.5}
                fill={n.isTrigger ? "var(--wf-accent)" : "var(--wf-fg)"}
                fillOpacity={n.isTrigger ? 0.85 : 0.35}
              />
            ))}

            {/* Viewport rectangle */}
            <rect
              x={viewport.x * scale}
              y={viewport.y * scale}
              width={Math.min(viewport.w * scale, drawW)}
              height={Math.min(viewport.h * scale, drawH)}
              fill="var(--wf-accent)"
              fillOpacity={0.1}
              stroke="var(--wf-accent)"
              strokeWidth={1.5}
              rx={2}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
