/**
 * WorkflowNode - Visual node card for triggers and steps on the canvas
 */
import React from "react";
import { Link2, MoreHorizontal, Play, Check, X, Radio } from "lucide-react";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import type { DesignerNode, DesignerTrigger } from "../types";

export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'error';

/** Tools that support the stream:true toggle (can produce a streamId) */
export const STREAM_CAPABLE_TOOLS = new Set([
  'agent_node', 'ai_inference', 'http_request', 'run_python_script',
  'capture_media',
]);

/** Tools that always produce a streamId (no toggle needed) */
const STREAM_ALWAYS_TOOLS = new Set(['stream_create']);

function formatArgPreview(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v || '""';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map(item =>
      typeof item === 'object' && item !== null ? '{…}' : String(item)
    );
    const preview = items.slice(0, 3).join(', ');
    return v.length > 3 ? `[${preview}, +${v.length - 3}]` : `[${preview}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const preview = keys.slice(0, 3).join(', ');
    return keys.length > 3 ? `{ ${preview}, … }` : `{ ${preview} }`;
  }
  return String(v);
}

interface WorkflowNodeProps {
  node: DesignerNode | DesignerTrigger;
  isTrigger?: boolean;
  selected: boolean;
  multiSelected?: boolean;
  connecting: boolean;
  reconnectTarget?: boolean | null;
  executionStatus?: StepExecutionStatus;
  hasStreamOut?: boolean;
  hasStreamIn?: boolean;
  connectingStreamFrom?: string;
  onSelect: (e?: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onConnect: () => void;
  onStreamConnect?: () => void;
}

export function WorkflowNode({ 
  node, isTrigger, selected, multiSelected, connecting, reconnectTarget, executionStatus,
  hasStreamOut, hasStreamIn, connectingStreamFrom,
  onSelect, onMouseDown, onContextMenu, onConnect, onStreamConnect
}: WorkflowNodeProps) {
  const tool = ('tool' in node ? node.tool : node.type) || '';
  const Icon = getToolIcon(tool, isTrigger);
  const colorKey = getToolColor(tool, isTrigger);
  const styles = CATEGORY_COLORS[colorKey] || CATEGORY_COLORS.slate;

  // A node is a stream producer if it always streams OR if it has stream:true toggled on
  const nodeArgs = ('args' in node ? (node as any).args : undefined) || {};
  const isStreamProducer = STREAM_ALWAYS_TOOLS.has(tool) || (STREAM_CAPABLE_TOOLS.has(tool) && nodeArgs.stream === true);
  
  const getStatusClasses = () => {
    if (executionStatus === 'running') return 'border-emerald-500 ring-4 ring-emerald-100/50 shadow-[0_8px_30px_rgb(16,185,129,0.2)] scale-[1.02] z-10';
    if (executionStatus === 'completed') return 'border-emerald-500/50 shadow-md';
    if (executionStatus === 'error') return 'border-red-500 ring-4 ring-red-100/50 shadow-[0_8px_30px_rgb(239,68,68,0.2)] z-10';
    if (selected) return 'border-blue-500 ring-4 ring-blue-100/50 shadow-[0_8px_30px_rgb(59,130,246,0.15)] translate-y-[-2px] z-10';
    if (multiSelected) return 'border-blue-400 ring-2 ring-blue-100/60 shadow-[0_4px_20px_rgb(59,130,246,0.12)] z-10';
    if (connecting) return 'border-dashed border-blue-300 bg-blue-50/30 shadow-none';
    if (reconnectTarget) return 'border-amber-400 ring-4 ring-amber-100/50 shadow-[0_8px_30px_rgb(245,158,11,0.2)] cursor-pointer z-10 animate-pulse';
    
    // Default state using category color
    return `${styles.border} shadow-sm hover:shadow-[0_4px_20px_-12px_rgba(0,0,0,0.1)] hover:-translate-y-0.5`;
  };

  const getStatusIcon = () => {
    switch (executionStatus) {
      case 'running': return <Play className="w-3 h-3 text-white fill-current animate-pulse" />;
      case 'completed': return <Check className="w-3.5 h-3.5 text-white" />;
      case 'error': return <X className="w-3.5 h-3.5 text-white" />;
      default: return <Icon className={`w-4 h-4 ${styles.text}`} />;
    }
  };

  const getStatusBg = () => {
    switch (executionStatus) {
      case 'running': return 'bg-emerald-500 shadow-emerald-200';
      case 'completed': return 'bg-emerald-500 shadow-emerald-200';
      case 'error': return 'bg-red-500 shadow-red-200';
      default: return `${styles.bg} ${styles.border}`;
    }
  };

  return (
    <div
      className={`absolute w-64 rounded-2xl border bg-white transition-all duration-200 select-none flex flex-col overflow-visible group ${getStatusClasses()}`}
      style={{ left: node.position.x, top: node.position.y }}
      onClick={e => { e.stopPropagation(); onSelect(e); }}
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e); }}
      onContextMenu={e => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e);
        }
      }}
    >
      {/* Inner container — clips content to rounded corners while outer stays overflow-visible for ports */}
      <div className="rounded-2xl overflow-hidden flex flex-col flex-1">
        {/* Header */}
        <div className="px-3 py-2.5 flex items-center gap-3 bg-white border-b border-slate-50">
          <div className={`w-8 h-8 rounded-xl shrink-0 transition-colors duration-300 flex items-center justify-center border shadow-sm ${getStatusBg()}`}>
            {getStatusIcon()}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-slate-700 truncate leading-tight">
              {node.label || tool}
            </div>
            <div className={`text-[10px] truncate font-medium mt-0.5 opacity-60 ${styles.text}`}>
              {tool}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 py-2 space-y-1.5 bg-slate-50/30 flex-1">
          {Object.keys(node.args || {}).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(node.args || {}).slice(0, 3).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[10px] bg-white/50 px-2 py-1 rounded border border-slate-100">
                  <span className="text-slate-400 font-medium truncate max-w-[70px] flex-shrink-0" title={k}>{k}</span>
                  <span className="text-slate-600 truncate flex-1 font-mono">
                    {formatArgPreview(v)}
                  </span>
                </div>
              ))}
              {Object.keys(node.args || {}).length > 3 && (
                <div className="text-[9px] text-slate-400 font-medium pl-1 flex items-center gap-1 pt-0.5">
                  <MoreHorizontal className="w-3 h-3" />
                  {Object.keys(node.args || {}).length - 3} more
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 italic px-1 py-0.5 opacity-50">No configuration</div>
          )}
        </div>
      </div>

      {/* Action Handle - Connect (control wire, right side) */}
      <div 
className={`absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-4 border-white shadow-sm flex items-center justify-center cursor-crosshair transition-all duration-200 z-20
          ${connecting 
            ? 'bg-blue-600 scale-110' 
            : `bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-blue-500 hover:text-white hover:scale-110 ${styles.hover}`
          }`}
        onClick={e => { e.stopPropagation(); onConnect(); }}
        title="Connect"
      >
        <Link2 className="w-3.5 h-3.5" />
      </div>

      {/* Input Handle (visual only, left side) */}
      {!isTrigger && (
        <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${styles.bg} ${styles.border}`} />
      )}

      {/* Stream Output Port (bottom center) — shown for stream producers or when a stream wire is connected out */}
      {(isStreamProducer || hasStreamOut) && (
        <div
          className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-4 border-white shadow-sm flex items-center justify-center cursor-crosshair transition-all duration-200 z-20
            ${connectingStreamFrom === node.id
              ? 'bg-cyan-500 scale-110'
              : hasStreamOut
                ? 'bg-cyan-100 text-cyan-600 border-cyan-200 hover:bg-cyan-500 hover:text-white hover:scale-110'
                : 'bg-cyan-50 text-cyan-400 opacity-0 group-hover:opacity-100 hover:bg-cyan-500 hover:text-white hover:scale-110'
            }`}
          onClick={e => { e.stopPropagation(); onStreamConnect?.(); }}
          title="Stream output — drag to connect stream wire"
        >
          <Radio className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Stream Input Ports (top + bottom center) — shown when a stream wire is connected in
          U-shape routing enters from bottom when source is above/same level, top when source is below */}
      {hasStreamIn && (
        <>
          <div
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm bg-cyan-200 border-cyan-300"
            title="Stream input"
          />
          <div
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm bg-cyan-200 border-cyan-300"
            title="Stream input"
          />
        </>
      )}

      {/* Stream badge — small indicator when node is a stream producer */}
      {isStreamProducer && !hasStreamOut && (
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30" title="Stream producer">
          <Radio className="w-2.5 h-2.5 text-white" />
        </div>
      )}
    </div>
  );
}
