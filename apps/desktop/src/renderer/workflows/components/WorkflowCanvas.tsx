/**
 * WorkflowCanvas - The visual canvas for rendering workflow nodes and wires
 */
import React, { useState, useMemo } from "react";
import { MousePointer2, ZoomIn, ZoomOut, Maximize2, Trash2, LayoutGrid } from "lucide-react";
import { WorkflowNode } from "./WorkflowNodeCard";
import type { DesignerModel, DesignerWire } from "../types";
import type { StepExecutionStatus } from "./WorkflowNodeCard";
import type { AlignmentGuide } from "../utils/alignment";
import { isBackEdge as isBackEdgeCycle } from "../utils/graphUtils";

// Back edge (cycle) detection is in ../utils/graphUtils.ts

interface ExecutionState {
  flowId: string;
  isRunning: boolean;
  stepStates: Record<string, StepExecutionStatus>;
  activeWireFrom?: string;
  activeWireTo?: string;
  activeStreams?: Set<string>; // Set of "sourceId->consumerId" keys for active stream wires
}

interface WorkflowCanvasProps {
  model: DesignerModel;
  selectedId: string;
  selectedNodeId: string;
  selectedNodeIds: Set<string>;
  connectingFrom: string;
  reconnecting?: { wireIndex: number; end: 'from' | 'to' } | null;
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
  onNodeSelect?: (id: string, e?: React.MouseEvent) => void;
  onNodeMouseDown?: (id: string, e: React.MouseEvent) => void;
  onNodeContextMenu?: (id: string, e: React.MouseEvent) => void;
  onNodeConnect?: (id: string) => void;
  onWireSelect?: (index: number) => void;
  onWireDelete?: (index: number) => void;
  onWireContextMenu?: (index: number, e: React.MouseEvent) => void;
  onWireReconnect?: (index: number, end: 'from' | 'to') => void;
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
  connectingStreamFrom?: string;
  onNodeStreamConnect?: (id: string) => void;
  // Marquee selection
  selectionBox?: { startX: number; startY: number; endX: number; endY: number } | null;
  onCanvasMouseDown?: (e: React.MouseEvent) => void;
}

export function WorkflowCanvas({
  model, selectedId, selectedNodeId, selectedNodeIds, connectingFrom, reconnecting, executionState, size,
  canvasRef, alignmentGuides = [], zoom = 1, selectedWireIndex, onWheel, onZoomIn, onZoomOut, onZoomReset, onAutoOrganize,
  onDragOver, onDrop, onMouseMove, onMouseUp, onMouseLeave, onCanvasClick,
  onNodeSelect, onNodeMouseDown, onNodeContextMenu, onNodeConnect, onWireSelect, onWireDelete, onWireContextMenu, onWireReconnect, onCanvasContextMenu,
  connectingStreamFrom, onNodeStreamConnect,
  selectionBox, onCanvasMouseDown
}: WorkflowCanvasProps) {
  const [hoveredWireIndex, setHoveredWireIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const safeWires: DesignerWire[] = Array.isArray((model as any)?.wires) ? ((model as any).wires as DesignerWire[]) : [];

  // Compute which nodes have stream wires connected (for showing stream ports)
  const streamPortInfo = useMemo(() => {
    const hasStreamOut = new Set<string>();
    const hasStreamIn = new Set<string>();
    for (const w of safeWires) {
      if ((w as any).stream) {
        hasStreamOut.add(w.from);
        hasStreamIn.add(w.to);
      }
    }
    return { hasStreamOut, hasStreamIn };
  }, [safeWires]);

  const scaledSize = {
    w: size.w * zoom,
    h: size.h * zoom
  };

  const gridSize = 24 * zoom;

  return (
    <div className="w-full h-full relative overflow-hidden" data-onboarding="workflow-canvas">
      {/* Scrollable canvas area */}
      <div
        ref={canvasRef}
        className="absolute inset-0 overflow-auto scrollbar-minimal bg-slate-50/50 cursor-grab active:cursor-grabbing"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseMove={(e) => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const cx = (e.clientX - rect.left + (canvasRef.current?.scrollLeft || 0)) / zoom;
            const cy = (e.clientY - rect.top + (canvasRef.current?.scrollTop || 0)) / zoom;
            setMousePos({ x: cx, y: cy });
          }
          onMouseMove?.(e);
        }}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={onCanvasClick}
        onWheel={onWheel}
        onContextMenu={onCanvasContextMenu}
        onMouseDown={(e) => {
          if (e.button === 0 && onCanvasMouseDown) {
            onCanvasMouseDown(e);
          }
        }}
      >
        {/* Spacer div - establishes the correct scrollable area matching zoomed content */}
        <div
          style={{ width: scaledSize.w, height: scaledSize.h, pointerEvents: 'none' }}
          aria-hidden
        />

        {/* Dot Grid Background - scales with zoom, covers full scrollable area */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.4]"
          style={{
            width: scaledSize.w,
            height: scaledSize.h,
            backgroundImage: 'radial-gradient(#94a3b8 1.5px, transparent 1.5px)',
            backgroundSize: `${gridSize}px ${gridSize}px`
          }}
        />

        {/* Scaled Content Container - positioned absolutely over the spacer */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
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
            <marker id="ah-loop" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#f59e0b" />
            </marker>
            <marker id="ah-loop-config" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#a855f7" />
            </marker>
            <marker id="ah-loop-break" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#f97316" />
            </marker>
            <marker id="ah-stream" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#06b6d4" />
            </marker>
            <marker id="ah-callnode" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#14b8a6" />
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
            {/* Stream wire animated gradient - only animate when active via CSS */}
            <linearGradient id="stream-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
            </linearGradient>
          </defs>

          {(() => {

            // Compute which nodes are part of an active streaming pipeline.
            // Walk forward from stream consumer nodes through flow wires so
            // downstream wires (e.g. mediapipe → custom_ui) also get the
            // stream animation when data is flowing.
            const streamingPipelineNodes = new Set<string>();
            if (executionState?.activeStreams?.size) {
              // Seed with consumer nodes of active streams
              for (const key of executionState.activeStreams) {
                const arrow = key.indexOf('->');
                if (arrow > 0) {
                  streamingPipelineNodes.add(key.slice(arrow + 2));
                }
              }
              // BFS forward through flow wires
              const queue = [...streamingPipelineNodes];
              while (queue.length > 0) {
                const nodeId = queue.shift()!;
                for (const wire of safeWires) {
                  if (wire.from === nodeId && !(wire as any).stream && !streamingPipelineNodes.has(wire.to)) {
                    streamingPipelineNodes.add(wire.to);
                    queue.push(wire.to);
                  }
                }
              }
            }
            
            return safeWires.map((w, i) => {
            const all = [...model.triggers, ...model.nodes];
            const f = all.find(n => n.id === w.from);
            const t = all.find(n => n.id === w.to);
            if (!f || !t) return null;

            const isStreamWire = !!(w as any).stream;
            const isCallNodeWire = !!(w as any).callNode;

            // Detect if this wire creates an actual cycle (x→y→...→x)
            const isBackEdge = isBackEdgeCycle(w.from, w.to, safeWires);

            let x1: number, y1: number, x2: number, y2: number;
            let pathD: string;
            let midX: number;
            let midY: number;

            if (isStreamWire) {
              // Stream wire: U-shape orthogonal routing
              // Both source and target connect from the SAME side (bottom or top)
              // with the turn point beyond both nodes — clean U or inverted-U shape
              const nodeW = 256;
              const nodeH = 80;
              const fCx = f.position.x + nodeW / 2;
              const fCy = f.position.y + nodeH / 2;
              const tCx = t.position.x + nodeW / 2;
              const tCy = t.position.y + nodeH / 2;
              const targetBelow = tCy >= fCy;
              const dirX = tCx >= fCx ? 1 : -1; // horizontal direction toward target

              x1 = fCx;
              x2 = tCx;

              const cr = 12; // corner radius
              const arm = 40; // how far the orthogonal arm extends beyond the outermost node

              if (targetBelow) {
                // U-shape below: both ports at bottom, turn below both
                y1 = f.position.y + nodeH; // source bottom
                y2 = t.position.y + nodeH; // target bottom
                const turnY = Math.max(y1, y2) + arm;
                pathD = `M ${x1} ${y1} ` +
                  `L ${x1} ${turnY - cr} ` +
                  `Q ${x1} ${turnY} ${x1 + dirX * cr} ${turnY} ` +
                  `L ${x2 - dirX * cr} ${turnY} ` +
                  `Q ${x2} ${turnY} ${x2} ${turnY - cr} ` +
                  `L ${x2} ${y2}`;
                midX = (x1 + x2) / 2;
                midY = turnY;
              } else {
                // Inverted U-shape above: both ports at top, turn above both
                y1 = f.position.y; // source top
                y2 = t.position.y; // target top
                const turnY = Math.min(y1, y2) - arm;
                pathD = `M ${x1} ${y1} ` +
                  `L ${x1} ${turnY + cr} ` +
                  `Q ${x1} ${turnY} ${x1 + dirX * cr} ${turnY} ` +
                  `L ${x2 - dirX * cr} ${turnY} ` +
                  `Q ${x2} ${turnY} ${x2} ${turnY + cr} ` +
                  `L ${x2} ${y2}`;
                midX = (x1 + x2) / 2;
                midY = turnY;
              }
            } else if (isBackEdge) {
              // Normal wires: center-right → center-left
              x1 = f.position.x + 256;
              y1 = f.position.y + 40;
              x2 = t.position.x;
              y2 = t.position.y + 40;

              // Loop-back wire: goes right, up, left (over nodes), then down to target
              const loopOffset = 60;
              const rightExtend = 40;
              const cornerRadius = 12;
              const topY = Math.min(f.position.y, t.position.y) - loopOffset;
              const rightX = x1 + rightExtend;
              const leftX = x2 - rightExtend;

              pathD = `M ${x1} ${y1} ` +
                `L ${rightX - cornerRadius} ${y1} ` +
                `Q ${rightX} ${y1} ${rightX} ${y1 - cornerRadius} ` +
                `L ${rightX} ${topY + cornerRadius} ` +
                `Q ${rightX} ${topY} ${rightX - cornerRadius} ${topY} ` +
                `L ${leftX + cornerRadius} ${topY} ` +
                `Q ${leftX} ${topY} ${leftX} ${topY + cornerRadius} ` +
                `L ${leftX} ${y2 - cornerRadius} ` +
                `Q ${leftX} ${y2} ${leftX + cornerRadius} ${y2} ` +
                `L ${x2} ${y2}`;
              midX = (rightX + leftX) / 2;
              midY = topY;
            } else {
              // Normal forward wire: center-right → center-left, Cubic Bezier
              x1 = f.position.x + 256;
              y1 = f.position.y + 40;
              x2 = t.position.x;
              y2 = t.position.y + 40;

              const dist = Math.abs(x2 - x1);
              const cp1x = x1 + Math.max(dist * 0.5, 50);
              const cp1y = y1;
              const cp2x = x2 - Math.max(dist * 0.5, 50);
              const cp2y = y2;

              pathD = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

              const midT = 0.5;
              midX = Math.pow(1-midT, 3) * x1 + 3 * Math.pow(1-midT, 2) * midT * cp1x + 3 * (1-midT) * Math.pow(midT, 2) * cp2x + Math.pow(midT, 3) * x2;
              midY = Math.pow(1-midT, 3) * y1 + 3 * Math.pow(1-midT, 2) * midT * cp1y + 3 * (1-midT) * Math.pow(midT, 2) * cp2y + Math.pow(midT, 3) * y2;
            }

            const isActiveWire = executionState?.flowId === selectedId &&
              executionState?.activeWireFrom === w.from &&
              executionState?.activeWireTo === w.to;

            const sourceStatus = executionState?.stepStates[w.from];
            const targetStatus = executionState?.stepStates[w.to];
            const isCompletedWire = sourceStatus === 'completed' && (targetStatus === 'completed' || targetStatus === 'running');
            const isSelected = selectedWireIndex === i;
            const isHovered = hoveredWireIndex === i;
            const isReconnecting = reconnecting?.wireIndex === i;
            
            // Check if this wire has a loop configuration
            const hasLoop = !!(w as any).loop;
            const loopType = (w as any).loop?.type;
            const hasLoopBreak = !!(w as any).loopBreak;
            // Check if this wire is a stream wire
            // (computed earlier for path endpoints)
            
            // Check if this stream wire is currently active (flowing data)
            const isStreamActive = isStreamWire && executionState?.flowId === selectedId &&
              executionState?.activeStreams?.has(`${w.from}->${w.to}`);

            // Check if this flow wire is part of an active streaming pipeline
            // (downstream of a stream consumer that is currently receiving chunks)
            const isInStreamPipeline = !isStreamWire && streamingPipelineNodes.has(w.from) && streamingPipelineNodes.has(w.to);
            
            // Check if source node is inside a loop (for "continue in loop" styling)
            const isInsideLoop = (() => {
              if (hasLoop || hasLoopBreak) return false; // Already handled
              const visited = new Set<string>();
              const checkUpstream = (nodeId: string): boolean => {
                if (visited.has(nodeId)) return false;
                visited.add(nodeId);
                const incoming = (model.wires || []).filter((wire: any) => wire.to === nodeId);
                for (const wire of incoming) {
                  if ((wire as any).loop) return true;
                  if (checkUpstream(wire.from)) return true;
                }
                return false;
              };
              return checkUpstream(w.from);
            })();

            // Special colors for back edges, loop wires, loop breaks, stream wires, and callNode wires
            // Orange = continues in loop, Grey = exits loop (loopBreak), Cyan = stream wire, Teal = callNode wire
            const wireColor = isReconnecting ? '#f59e0b' // Amber for reconnecting wire
              : isSelected ? '#ef4444'
              : isActiveWire ? '#6366f1'
              : isCompletedWire ? '#10b981'
              : isHovered ? '#94a3b8'
              : isCallNodeWire ? '#14b8a6' // Teal for callNode wires
              : isStreamWire ? '#06b6d4' // Cyan for stream wires
              : isInStreamPipeline ? '#06b6d4' // Cyan for downstream pipeline wires
              : isInsideLoop ? '#f97316' // Orange for wires that continue in loop
              : hasLoop ? '#a855f7' // Purple for configured loops (entry)
              : isBackEdge ? '#f59e0b' // Amber for back edges
              : '#cbd5e1'; // Grey for normal and loopBreak

            const markerEnd = isReconnecting ? 'url(#ah-loop)' // Amber marker for reconnecting
              : isSelected ? 'url(#ah-selected)'
              : isActiveWire ? 'url(#ah-active)'
              : isCompletedWire ? 'url(#ah-completed)'
              : isCallNodeWire ? 'url(#ah-callnode)' // Teal marker for callNode wires
              : isStreamWire ? 'url(#ah-stream)' // Cyan marker for stream wires
              : isInStreamPipeline ? 'url(#ah-stream)' // Cyan marker for pipeline wires
              : isInsideLoop ? 'url(#ah-loop-break)' // Reuse orange marker
              : hasLoop ? 'url(#ah-loop-config)'
              : isBackEdge ? 'url(#ah-loop)'
              : 'url(#ah)';

            return (
              <g key={i}>
                {/* Invisible wider path for easier clicking */}
                <path
                  d={pathD}
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onWireContextMenu?.(i, e as any);
                  }}
                />

                {/* Main wire path */}
                <path
                  d={pathD}
                  stroke={(isStreamWire || isInStreamPipeline) && !isSelected ? '#06b6d4' : wireColor}
                  strokeWidth={isReconnecting ? 3 : isSelected ? 3 : isActiveWire ? 3 : isStreamActive ? 3 : isInStreamPipeline ? 2.5 : isStreamWire ? 2.5 : isHovered ? 2.5 : 2}
                  strokeDasharray={isReconnecting ? '8 4' : isCallNodeWire ? '4 3' : (isStreamWire || isInStreamPipeline) ? '6 4' : undefined}
                  fill="none"
                  markerEnd={markerEnd}
                  className={`transition-all duration-200 ${isActiveWire ? 'drop-shadow-md' : ''} ${isSelected ? 'drop-shadow-md' : ''} ${isReconnecting ? 'drop-shadow-md animate-pulse' : ''} ${(isStreamActive || isInStreamPipeline) ? 'drop-shadow-md stream-wire-active' : isStreamWire ? 'drop-shadow-sm' : ''} ${isBackEdge ? 'stroke-dasharray-none' : ''}`}
                  style={{ pointerEvents: 'none', ...((isStreamActive || isInStreamPipeline) ? { animation: 'streamFlow 1.5s linear infinite', filter: 'drop-shadow(0 0 4px rgba(6,182,212,0.6))' } : {}) }}
                />

                {/* Loop indicator icon for configured loops */}
                {hasLoop && !isSelected && !isHovered && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <circle r="10" fill="white" stroke="#a855f7" strokeWidth="1.5" className="drop-shadow-sm" />
                    {loopType === 'forEach' && (
                      // List icon for forEach
                      <g transform="translate(-5, -5)" stroke="#a855f7" strokeWidth="1.5" fill="none">
                        <line x1="2" y1="3" x2="8" y2="3" />
                        <line x1="2" y1="6" x2="8" y2="6" />
                        <line x1="2" y1="9" x2="8" y2="9" />
                      </g>
                    )}
                    {loopType === 'repeat' && (
                      // Repeat icon
                      <text x="0" y="4" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#a855f7">
                        {(w as any).loop?.count || 'N'}
                      </text>
                    )}
                    {loopType === 'while' && (
                      // While loop icon (circular arrow)
                      <path
                        d="M-4 0 A4 4 0 1 1 4 0 M4 0 L2 -2 M4 0 L2 2"
                        fill="none"
                        stroke="#a855f7"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    )}
                  </g>
                )}
                
                {/* Loop indicator icon for back edges (no explicit config) */}
                {isBackEdge && !hasLoop && !isSelected && !isHovered && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <circle r="8" fill="white" stroke="#f59e0b" strokeWidth="1.5" className="drop-shadow-sm" />
                    <path
                      d="M-3 0 A3 3 0 1 1 3 0 M3 0 L1 -2 M3 0 L1 2"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {/* Continue in loop indicator icon (orange) */}
                {isInsideLoop && !isSelected && !isHovered && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <circle r="10" fill="white" stroke="#f97316" strokeWidth="1.5" className="drop-shadow-sm" />
                    {/* Loop arrow icon */}
                    <path
                      d="M-3 0 A3 3 0 1 1 3 0 M3 0 L1 -2 M3 0 L1 2"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {/* Stream wire indicator icon (cyan radio/signal icon) */}
                {isStreamWire && !isSelected && !isHovered && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <circle r="10" fill="white" stroke="#06b6d4" strokeWidth="1.5" className="drop-shadow-sm" />
                    {/* Radio/signal icon - concentric arcs */}
                    <g stroke="#06b6d4" strokeWidth="1.5" fill="none" strokeLinecap="round">
                      <circle cx="0" cy="0" r="2" fill="#06b6d4" />
                      <path d="M-4 -3 A5 5 0 0 1 -4 3" />
                      <path d="M4 -3 A5 5 0 0 0 4 3" />
                    </g>
                  </g>
                )}

                {/* callNode wire indicator icon (teal plug/socket icon) */}
                {isCallNodeWire && !isSelected && !isHovered && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <circle r="10" fill="white" stroke="#14b8a6" strokeWidth="1.5" className="drop-shadow-sm" />
                    {/* Plug icon — vertical prong with socket arc */}
                    <g stroke="#14b8a6" strokeWidth="1.5" fill="none" strokeLinecap="round">
                      <line x1="-2" y1="-5" x2="-2" y2="0" />
                      <line x1="2" y1="-5" x2="2" y2="0" />
                      <path d="M-4 0 A4 4 0 0 0 4 0" />
                      <line x1="0" y1="4" x2="0" y2="6" />
                    </g>
                  </g>
                )}

                {/* Active particle animation */}
                {isActiveWire && (
                  <circle r="4" fill="#6366f1" className="drop-shadow-lg">
                    <animateMotion
                      dur={isBackEdge ? "1.5s" : "1s"}
                      repeatCount="indefinite"
                      path={pathD}
                      keyPoints="0;1"
                      keyTimes="0;1"
                      calcMode="spline"
                      keySplines="0.4 0 0.2 1"
                    />
                  </circle>
                )}

                {/* Delete button on hover/select */}
                {(isSelected || isHovered) && onWireDelete && !isReconnecting && (
                  <g
                    transform={`translate(${midX}, ${midY})`}
                    className="cursor-pointer"
                    style={{ pointerEvents: 'all' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onWireDelete(i);
                    }}
                  >
                    {/* Invisible larger hit area */}
                    <circle r="18" fill="transparent" />
                    {/* Visible button */}
                    <circle 
                      r="12" 
                      fill={isSelected ? '#fef2f2' : 'white'} 
                      stroke={isSelected ? '#ef4444' : '#cbd5e1'} 
                      strokeWidth="2" 
                      className="drop-shadow-md hover:fill-red-50 hover:stroke-red-400 transition-all"
                    />
                    {/* X icon - simple and clean */}
                    <g stroke={isSelected ? '#ef4444' : '#64748b'} strokeWidth="2" strokeLinecap="round" className="hover:stroke-red-500 transition-colors">
                      <line x1="-4" y1="-4" x2="4" y2="4" />
                      <line x1="4" y1="-4" x2="-4" y2="4" />
                    </g>
                  </g>
                )}

                {/* Disconnect handles at endpoints when wire is selected */}
                {isSelected && onWireReconnect && !isReconnecting && (
                  <>
                    {/* Source endpoint disconnect handle */}
                    <g
                      transform={`translate(${x1}, ${y1})`}
                      className="cursor-pointer"
                      style={{ pointerEvents: 'all' }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onWireReconnect(i, 'from');
                      }}
                    >
                      <circle r="14" fill="transparent" />
                      <circle 
                        r="10" 
                        fill="#fef3c7" 
                        stroke="#f59e0b" 
                        strokeWidth="2" 
                        className="drop-shadow-md hover:fill-amber-100 hover:stroke-amber-600 transition-all"
                      />
                      {/* Unplug icon */}
                      <g stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" fill="none">
                        <path d="M-3,-3 L3,3 M-1,-4 L-4,-1 M1,4 L4,1" />
                      </g>
                    </g>

                    {/* Target endpoint disconnect handle */}
                    <g
                      transform={`translate(${x2}, ${y2})`}
                      className="cursor-pointer"
                      style={{ pointerEvents: 'all' }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onWireReconnect(i, 'to');
                      }}
                    >
                      <circle r="14" fill="transparent" />
                      <circle 
                        r="10" 
                        fill="#fef3c7" 
                        stroke="#f59e0b" 
                        strokeWidth="2" 
                        className="drop-shadow-md hover:fill-amber-100 hover:stroke-amber-600 transition-all"
                      />
                      {/* Unplug icon */}
                      <g stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" fill="none">
                        <path d="M-3,-3 L3,3 M-1,-4 L-4,-1 M1,4 L4,1" />
                      </g>
                    </g>
                  </>
                )}
              </g>
            );
          })})()}

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

          {/* Stream connection preview — U-shape orthogonal routing */}
          {connectingStreamFrom && mousePos && (
            (() => {
              const all = [...model.triggers, ...model.nodes];
              const source = all.find(n => n.id === connectingStreamFrom);
              if (!source) return null;
              const nodeW = 256;
              const nodeH = 80;
              const sCx = source.position.x + nodeW / 2;
              const sCy = source.position.y + nodeH / 2;
              const mouseBelow = mousePos.y >= sCy;
              const sx = sCx;
              const sy = mouseBelow ? (source.position.y + nodeH) : source.position.y;
              const ex = mousePos.x;
              const cr = 12;
              const arm = 40;
              const dirX = ex >= sx ? 1 : -1;
              // U-shape: turn beyond both source port and mouse Y
              const turnY = mouseBelow
                ? Math.max(sy, mousePos.y) + arm
                : Math.min(sy, mousePos.y) - arm;
              const vertDir = mouseBelow ? -1 : 1; // cr direction for first vertical
              const d = `M ${sx} ${sy} ` +
                `L ${sx} ${turnY + vertDir * cr} ` +
                `Q ${sx} ${turnY} ${sx + dirX * cr} ${turnY} ` +
                `L ${ex - dirX * cr} ${turnY} ` +
                `Q ${ex} ${turnY} ${ex} ${turnY + vertDir * cr} ` +
                `L ${ex} ${mousePos.y}`;
              return (
                <path
                  d={d}
                  stroke="url(#stream-gradient)"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  fill="none"
                  markerEnd="url(#ah-stream)"
                  className="drop-shadow-sm"
                  style={{ pointerEvents: 'none' }}
                />
              );
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
        {model.triggers.map(n => {
          // Check if this node is a valid reconnect target
          const wire = reconnecting ? model.wires[reconnecting.wireIndex] : null;
          const isReconnectTarget = reconnecting && wire && (
            (reconnecting.end === 'from' && n.id !== wire.to) ||
            (reconnecting.end === 'to' && n.id !== wire.from)
          );
          
          return (
            <WorkflowNode
              key={n.id}
              node={n}
              isTrigger
              selected={selectedNodeId === n.id}
              multiSelected={selectedNodeIds.has(n.id)}
              connecting={connectingFrom === n.id}
              reconnectTarget={isReconnectTarget}
              executionStatus={executionState?.flowId === selectedId ? executionState.stepStates[n.id] : undefined}
              hasStreamOut={model.wires?.some(w => w.from === n.id && !!(w as any).stream)}
              hasStreamIn={model.wires?.some(w => w.to === n.id && !!(w as any).stream)}
              connectingStreamFrom={connectingStreamFrom}
              onSelect={(e) => onNodeSelect?.(n.id, e)}
              onMouseDown={e => onNodeMouseDown?.(n.id, e)}
              onContextMenu={e => onNodeContextMenu?.(n.id, e)}
              onConnect={() => onNodeConnect?.(n.id)}
              onStreamConnect={() => onNodeStreamConnect?.(n.id)}
            />
          );
        })}

        {/* Render step nodes */}
        {model.nodes.map(n => {
          // Check if this node is a valid reconnect target
          const wire = reconnecting ? model.wires[reconnecting.wireIndex] : null;
          const isReconnectTarget = reconnecting && wire && (
            (reconnecting.end === 'from' && n.id !== wire.to) ||
            (reconnecting.end === 'to' && n.id !== wire.from)
          );
          
          return (
            <WorkflowNode
              key={n.id}
              node={n}
              selected={selectedNodeId === n.id}
              multiSelected={selectedNodeIds.has(n.id)}
              connecting={connectingFrom === n.id}
              reconnectTarget={isReconnectTarget}
              executionStatus={executionState?.flowId === selectedId ? executionState.stepStates[n.id] : undefined}
              hasStreamOut={model.wires?.some(w => w.from === n.id && !!(w as any).stream)}
              hasStreamIn={model.wires?.some(w => w.to === n.id && !!(w as any).stream)}
              connectingStreamFrom={connectingStreamFrom}
              onSelect={(e) => onNodeSelect?.(n.id, e)}
              onMouseDown={e => onNodeMouseDown?.(n.id, e)}
              onContextMenu={e => onNodeContextMenu?.(n.id, e)}
              onConnect={() => onNodeConnect?.(n.id)}
              onStreamConnect={() => onNodeStreamConnect?.(n.id)}
            />
          );
        })}

        {/* Marquee Selection Rectangle */}
        {selectionBox && (() => {
          const x = Math.min(selectionBox.startX, selectionBox.endX);
          const y = Math.min(selectionBox.startY, selectionBox.endY);
          const w = Math.abs(selectionBox.endX - selectionBox.startX);
          const h = Math.abs(selectionBox.endY - selectionBox.startY);
          return (
            <div
              className="absolute pointer-events-none border-2 border-blue-400/60 bg-blue-400/10 rounded-sm z-50"
              style={{ left: x, top: y, width: w, height: h }}
            />
          );
        })()}

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
      </div>

      {/* Zoom Controls - non-scrolling overlay */}
      <div className="absolute top-6 left-6 z-50 flex items-center gap-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-100 p-1.5 transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
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

      {connectingFrom && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 pointer-events-none">
          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
          Select a target node to connect
        </div>
      )}

      {/* Reconnecting mode indicator */}
      {reconnecting && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-amber-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 pointer-events-none">
          <div className="w-2 h-2 bg-amber-300 rounded-full animate-pulse" />
          Click a node to reconnect the {reconnecting.end === 'from' ? 'source' : 'target'} • Press Esc to cancel
        </div>
      )}

      {/* Execution overlay indicator */}
      {executionState?.flowId === selectedId && executionState.isRunning && (
        <div className="absolute top-6 right-6 bg-white/90 backdrop-blur border border-emerald-100 text-emerald-700 text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg z-50 pointer-events-none">
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
