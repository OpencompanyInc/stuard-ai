/**
 * WorkflowCanvas - The visual canvas for rendering workflow nodes and wires
 */
import React, { useState } from "react";
import { MousePointer2, ZoomIn, ZoomOut, Maximize2, Trash2, LayoutGrid } from "lucide-react";
import { WorkflowNode } from "./WorkflowNodeCard";
import type { DesignerModel } from "../types";
import type { StepExecutionStatus } from "./WorkflowNodeCard";
import type { AlignmentGuide } from "../utils/alignment";

interface ExecutionState {
  flowId: string;
  isRunning: boolean;
  stepStates: Record<string, StepExecutionStatus>;
  activeWireFrom?: string;
  activeWireTo?: string;
}

interface WorkflowCanvasProps {
  model: DesignerModel;
  selectedId: string;
  selectedNodeId: string;
  connectingFrom: string;
  executionState: ExecutionState | null;
  size: { w: number; h: number };
  canvasRef: React.RefObject<HTMLDivElement>;
  alignmentGuides?: AlignmentGuide[];
  zoom?: number;
  selectedWireIndex?: number | null;
  onWheel?: (e: React.WheelEvent) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onAutoOrganize?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
  onCanvasClick?: () => void;
  onNodeSelect?: (id: string) => void;
  onNodeMouseDown?: (id: string, e: React.MouseEvent) => void;
  onNodeContextMenu?: (id: string, e: React.MouseEvent) => void;
  onNodeConnect?: (id: string) => void;
  onWireSelect?: (index: number) => void;
  onWireDelete?: (index: number) => void;
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
}

export function WorkflowCanvas({
  model, selectedId, selectedNodeId, connectingFrom, executionState, size,
  canvasRef, alignmentGuides = [], zoom = 1, selectedWireIndex, onWheel, onZoomIn, onZoomOut, onZoomReset, onAutoOrganize,
  onDragOver, onDrop, onMouseMove, onMouseUp, onMouseLeave, onCanvasClick,
  onNodeSelect, onNodeMouseDown, onNodeContextMenu, onNodeConnect, onWireSelect, onWireDelete, onCanvasContextMenu
}: WorkflowCanvasProps) {
  const [hoveredWireIndex, setHoveredWireIndex] = useState<number | null>(null);
  const scaledSize = {
    w: size.w * zoom,
    h: size.h * zoom
  };

  const gridSize = 24 * zoom;

  return (
    <div
      ref={canvasRef}
      className="flex-1 overflow-auto scrollbar-minimal bg-slate-50/50 relative cursor-grab active:cursor-grabbing pb-32"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onClick={onCanvasClick}
      onWheel={onWheel}
      onContextMenu={onCanvasContextMenu}
    >
      {/* Dot Grid Background - scales with zoom */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.4]"
        style={{
          width: Math.max(scaledSize.w, 3000),
          height: Math.max(scaledSize.h, 3000),
          backgroundImage: 'radial-gradient(#94a3b8 1.5px, transparent 1.5px)',
          backgroundSize: `${gridSize}px ${gridSize}px`
        }}
      />

      {/* Zoom Controls */}
      <div className="absolute bottom-6 left-6 z-50 flex items-center gap-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-100 p-1.5 transition-all hover:scale-105 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
        <button
          onClick={onZoomOut}
          className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 hover:text-slate-900 transition-colors"
          title="Zoom out (Ctrl + Scroll)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={onZoomReset}
          className="px-2 py-1 rounded-xl hover:bg-slate-50 text-slate-500 hover:text-slate-900 transition-colors text-xs font-bold min-w-[3rem] tabular-nums"
          title="Reset zoom to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={onZoomIn}
          className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 hover:text-slate-900 transition-colors"
          title="Zoom in (Ctrl + Scroll)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-slate-100 mx-0.5" />
        <button
          onClick={onZoomReset}
          className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 hover:text-slate-900 transition-colors"
          title="Fit to screen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        {onAutoOrganize && (
          <>
            <div className="w-px h-4 bg-slate-100 mx-0.5" />
            <button
              onClick={onAutoOrganize}
              className="p-2 rounded-xl hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
              title="Auto-organize layout"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Scaled Content Container */}
      <div
        className="relative origin-top-left"
        style={{
          minWidth: scaledSize.w,
          minHeight: scaledSize.h,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          width: size.w,
          height: size.h,
        }}
      >
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={size.w} height={size.h}>
          {/* Wire animation defs */}
          <defs>
            <marker id="ah" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#cbd5e1" />
            </marker>
            <marker id="ah-active" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#6366f1" />
            </marker>
            <marker id="ah-completed" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#10b981" />
            </marker>
            <marker id="ah-selected" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#ef4444" />
            </marker>

            {/* Animated Gradients */}
            <linearGradient id="flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2">
                <animate attributeName="stop-opacity" values="0.2;1;0.2" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="50%" stopColor="#818cf8">
                <animate attributeName="offset" values="0;1" dur="1s" repeatCount="indefinite" />
              </stop>
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {model.wires.map((w, i) => {
            const all = [...model.triggers, ...model.nodes];
            const f = all.find(n => n.id === w.from);
            const t = all.find(n => n.id === w.to);
            if (!f || !t) return null;

            // Calculate connection points (center-right of source, center-left of target)
            // Node width is ~256px (w-64), header height ~50px
            const x1 = f.position.x + 256;
            const y1 = f.position.y + 40;
            const x2 = t.position.x;
            const y2 = t.position.y + 40;

            // Cubic Bezier control points
            const dist = Math.abs(x2 - x1);
            const cp1x = x1 + Math.max(dist * 0.5, 50);
            const cp1y = y1;
            const cp2x = x2 - Math.max(dist * 0.5, 50);
            const cp2y = y2;

            const isActiveWire = executionState?.flowId === selectedId &&
              executionState?.activeWireFrom === w.from &&
              executionState?.activeWireTo === w.to;

            const sourceStatus = executionState?.stepStates[w.from];
            const targetStatus = executionState?.stepStates[w.to];
            const isCompletedWire = sourceStatus === 'completed' && (targetStatus === 'completed' || targetStatus === 'running');
            const isSelected = selectedWireIndex === i;
            const isHovered = hoveredWireIndex === i;

            // Calculate midpoint for delete button
            const midT = 0.5;
            const midX = Math.pow(1-midT, 3) * x1 + 3 * Math.pow(1-midT, 2) * midT * cp1x + 3 * (1-midT) * Math.pow(midT, 2) * cp2x + Math.pow(midT, 3) * x2;
            const midY = Math.pow(1-midT, 3) * y1 + 3 * Math.pow(1-midT, 2) * midT * cp1y + 3 * (1-midT) * Math.pow(midT, 2) * cp2y + Math.pow(midT, 3) * y2;

            return (
              <g key={i}>
                {/* Invisible wider path for easier clicking */}
                <path
                  d={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                  stroke="transparent"
                  strokeWidth="20"
                  fill="none"
                  className="cursor-pointer"
                  style={{ pointerEvents: 'stroke' }}
                  onMouseEnter={() => setHoveredWireIndex(i)}
                  onMouseLeave={() => setHoveredWireIndex(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onWireSelect?.(i);
                  }}
                />

                {/* Main wire path */}
                <path
                  d={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                  stroke={isSelected ? '#ef4444' : isActiveWire ? '#6366f1' : isCompletedWire ? '#10b981' : isHovered ? '#94a3b8' : '#cbd5e1'}
                  strokeWidth={isSelected ? 3 : isActiveWire ? 3 : isHovered ? 2.5 : 2}
                  fill="none"
                  markerEnd={isSelected ? 'url(#ah-selected)' : isActiveWire ? 'url(#ah-active)' : isCompletedWire ? 'url(#ah-completed)' : 'url(#ah)'}
                  className={`transition-all duration-200 ${isActiveWire ? 'drop-shadow-md' : ''} ${isSelected ? 'drop-shadow-md' : ''}`}
                  style={{ pointerEvents: 'none' }}
                />

                {/* Active particle animation */}
                {isActiveWire && (
                  <circle r="4" fill="#6366f1" className="drop-shadow-lg">
                    <animateMotion
                      dur="1s"
                      repeatCount="indefinite"
                      path={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                      keyPoints="0;1"
                      keyTimes="0;1"
                      calcMode="spline"
                      keySplines="0.4 0 0.2 1"
                    />
                  </circle>
                )}

                {/* Delete button on hover/select */}
                {(isSelected || isHovered) && onWireDelete && (
                  <g
                    transform={`translate(${midX}, ${midY})`}
                    className="cursor-pointer group"
                    style={{ pointerEvents: 'all' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onWireDelete(i);
                    }}
                  >
                    {/* Invisible larger hit area */}
                    <circle r="16" fill="transparent" />
                    {/* Visible button */}
                    <circle r="10" fill="white" stroke={isSelected ? '#ef4444' : '#94a3b8'} strokeWidth="1.5" className="drop-shadow-sm transition-colors group-hover:stroke-red-500" />
                    <g transform="translate(-6, -6)">
                      <path d="M3 6h12M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2m2 0v8a1 1 0 01-1 1H7a1 1 0 01-1-1V6h10"
                        fill="none" stroke={isSelected ? '#ef4444' : '#64748b'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        transform="scale(0.75) translate(2, 2)"
                        className="transition-colors group-hover:stroke-red-500"
                      />
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* Connection Line Preview */}
          {connectingFrom && (
            (() => {
              const all = [...model.triggers, ...model.nodes];
              const source = all.find(n => n.id === connectingFrom);
              if (source) {
                return null;
              }
            })()
          )}

          {/* Alignment Guides */}
          {alignmentGuides.map((guide, i) => (
            <line
              key={`alignment-guide-${i}`}
              x1={guide.type === 'vertical' ? guide.position : guide.start}
              y1={guide.type === 'horizontal' ? guide.position : guide.start}
              x2={guide.type === 'vertical' ? guide.position : guide.end}
              y2={guide.type === 'horizontal' ? guide.position : guide.end}
              stroke="#6366f1"
              strokeWidth="1"
              strokeDasharray="4 2"
              className="pointer-events-none"
            />
          ))}
        </svg>

        {/* Render trigger nodes */}
        {model.triggers.map(n => (
          <WorkflowNode
            key={n.id}
            node={n}
            isTrigger
            selected={selectedNodeId === n.id}
            connecting={connectingFrom === n.id}
            executionStatus={executionState?.flowId === selectedId ? executionState.stepStates[n.id] : undefined}
            onSelect={() => onNodeSelect?.(n.id)}
            onMouseDown={e => onNodeMouseDown?.(n.id, e)}
            onContextMenu={e => onNodeContextMenu?.(n.id, e)}
            onConnect={() => onNodeConnect?.(n.id)}
          />
        ))}

        {/* Render step nodes */}
        {model.nodes.map(n => (
          <WorkflowNode
            key={n.id}
            node={n}
            selected={selectedNodeId === n.id}
            connecting={connectingFrom === n.id}
            executionStatus={executionState?.flowId === selectedId ? executionState.stepStates[n.id] : undefined}
            onSelect={() => onNodeSelect?.(n.id)}
            onMouseDown={e => onNodeMouseDown?.(n.id, e)}
            onContextMenu={e => onNodeContextMenu?.(n.id, e)}
            onConnect={() => onNodeConnect?.(n.id)}
          />
        ))}

        {/* Empty State */}
        {model.triggers.length === 0 && model.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-200">
                <MousePointer2 className="w-6 h-6 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700">Start building</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                Drag tools from the palette or ask the AI to design a workflow for you.
              </p>
            </div>
          </div>
        )}
      </div>

      {connectingFrom && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 animate-in slide-in-from-bottom-centered">
          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
          Select a target node to connect
        </div>
      )}

      {/* Execution overlay indicator */}
      {executionState?.flowId === selectedId && executionState.isRunning && (
        <div className="absolute top-6 right-6 bg-white/90 backdrop-blur border border-emerald-100 text-emerald-700 text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2 z-50">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Running Workflow...
        </div>
      )}
    </div>
  );
}
