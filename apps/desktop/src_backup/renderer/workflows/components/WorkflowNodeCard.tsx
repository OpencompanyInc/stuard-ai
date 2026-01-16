/**
 * WorkflowNode - Visual node card for triggers and steps on the canvas
 */
import React from "react";
import { Link2, MoreHorizontal, Play, Check, X } from "lucide-react";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import type { DesignerNode, DesignerTrigger } from "../types";

export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'error';

interface WorkflowNodeProps {
  node: DesignerNode | DesignerTrigger;
  isTrigger?: boolean;
  selected: boolean;
  connecting: boolean;
  executionStatus?: StepExecutionStatus;
  onSelect: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onConnect: () => void;
}

export function WorkflowNode({ 
  node, isTrigger, selected, connecting, executionStatus, 
  onSelect, onMouseDown, onContextMenu, onConnect 
}: WorkflowNodeProps) {
  const tool = ('tool' in node ? node.tool : node.type) || '';
  const Icon = getToolIcon(tool, isTrigger);
  const colorKey = getToolColor(tool, isTrigger);
  const styles = CATEGORY_COLORS[colorKey] || CATEGORY_COLORS.slate;
  
  const getStatusClasses = () => {
    if (executionStatus === 'running') return 'border-emerald-500 ring-4 ring-emerald-100/50 shadow-[0_8px_30px_rgb(16,185,129,0.2)] scale-[1.02] z-10';
    if (executionStatus === 'completed') return 'border-emerald-500/50 shadow-md';
    if (executionStatus === 'error') return 'border-red-500 ring-4 ring-red-100/50 shadow-[0_8px_30px_rgb(239,68,68,0.2)] z-10';
    if (selected) return 'border-indigo-500 ring-4 ring-indigo-100/50 shadow-[0_8px_30px_rgb(99,102,241,0.15)] translate-y-[-2px] z-10';
    if (connecting) return 'border-dashed border-indigo-300 bg-indigo-50/30 shadow-none';
    
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
      className={`absolute w-64 rounded-2xl border bg-white transition-all duration-200 select-none flex flex-col overflow-hidden group ${getStatusClasses()}`}
      style={{ left: node.position.x, top: node.position.y }}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e); }}
      onContextMenu={e => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e);
        }
      }}
    >
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
                  {typeof v === 'object' ? '{...}' : String(v)}
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

      {/* Action Handle - Connect */}
      <div 
        className={`absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-4 border-white shadow-sm flex items-center justify-center cursor-crosshair transition-all duration-200 z-20
          ${connecting 
            ? 'bg-indigo-600 scale-110' 
            : `bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-indigo-500 hover:text-white hover:scale-110 ${styles.hover}`
          }`}
        onClick={e => { e.stopPropagation(); onConnect(); }}
        title="Connect"
      >
        <Link2 className="w-3.5 h-3.5" />
      </div>

      {/* Input Handle (visual only) */}
      {!isTrigger && (
        <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${styles.bg} ${styles.border}`} />
      )}
    </div>
  );
}
