/**
 * WorkflowNode - Visual node card for triggers and steps on the canvas
 */
import React from "react";
import { Link2, MoreHorizontal, Play, Check, X, Radio } from "lucide-react";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import type { DesignerNode, DesignerTrigger } from "../types";
import { useWorkflowTheme } from "../WorkflowThemeContext";

export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'error';

/** Tools that support the stream:true toggle (can produce a streamId) */
export const STREAM_CAPABLE_TOOLS = new Set([
  'agent_node', 'ai_inference', 'http_request', 'run_python_script',
  'capture_media',
  'capture_screen',
  'capture_system_audio',
  'ollama_agent',
  'ollama_chat',
  'ollama_generate',
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

const DARK_CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  slate: { bg: 'bg-black/80', border: 'border-white/[0.12]', text: 'text-white/40' },
  amber: { bg: 'bg-amber-900/30', border: 'border-amber-500/60', text: 'text-amber-400' },
  purple: { bg: 'bg-purple-900/30', border: 'border-purple-500/60', text: 'text-purple-400' },
  blue: { bg: 'bg-blue-900/30', border: 'border-blue-500/60', text: 'text-blue-400' },
  green: { bg: 'bg-green-900/30', border: 'border-green-500/60', text: 'text-green-400' },
  pink: { bg: 'bg-pink-900/30', border: 'border-pink-500/60', text: 'text-pink-400' },
  orange: { bg: 'bg-orange-900/30', border: 'border-orange-500/60', text: 'text-orange-400' },
  yellow: { bg: 'bg-yellow-900/30', border: 'border-yellow-500/60', text: 'text-yellow-400' },
  cyan: { bg: 'bg-cyan-900/30', border: 'border-cyan-500/60', text: 'text-cyan-400' },
  violet: { bg: 'bg-violet-900/30', border: 'border-violet-500/60', text: 'text-violet-400' },
  indigo: { bg: 'bg-indigo-900/30', border: 'border-indigo-500/60', text: 'text-indigo-400' },
  emerald: { bg: 'bg-emerald-900/30', border: 'border-emerald-500/60', text: 'text-emerald-400' },
  fuchsia: { bg: 'bg-fuchsia-900/30', border: 'border-fuchsia-500/60', text: 'text-fuchsia-400' },
  teal: { bg: 'bg-teal-900/30', border: 'border-teal-500/60', text: 'text-teal-400' },
  sky: { bg: 'bg-sky-900/30', border: 'border-sky-500/60', text: 'text-sky-400' },
  rose: { bg: 'bg-rose-900/30', border: 'border-rose-500/60', text: 'text-rose-400' },
  red: { bg: 'bg-red-900/30', border: 'border-red-500/60', text: 'text-red-400' },
  lime: { bg: 'bg-lime-900/30', border: 'border-lime-500/60', text: 'text-lime-400' },
};

export function WorkflowNode({
  node, isTrigger, selected, multiSelected, connecting, reconnectTarget, executionStatus,
  hasStreamOut, hasStreamIn, connectingStreamFrom,
  onSelect, onMouseDown, onContextMenu, onConnect, onStreamConnect
}: WorkflowNodeProps) {
  const { isDark } = useWorkflowTheme();
  const tool = ('tool' in node ? node.tool : node.type) || '';
  const Icon = getToolIcon(tool, isTrigger);
  const colorKey = getToolColor(tool, isTrigger);
  const lightStyles = CATEGORY_COLORS[colorKey] || CATEGORY_COLORS.slate;
  const darkStyles = DARK_CATEGORY_COLORS[colorKey] || DARK_CATEGORY_COLORS.slate;
  const themeStyles = isDark
    ? darkStyles
    : {
      bg: lightStyles.bg,
      border: lightStyles.border,
      text: lightStyles.icon,
    };

  const nodeArgs = ('args' in node ? (node as any).args : undefined) || {};
  const isStreamProducer = STREAM_ALWAYS_TOOLS.has(tool) || (STREAM_CAPABLE_TOOLS.has(tool) && (nodeArgs.stream === true || nodeArgs.mode === 'stream'));

  const getStatusClasses = () => {
    if (executionStatus === 'running') return 'border-emerald-500 ring-4 ring-emerald-500/20 shadow-[0_8px_30px_rgb(16,185,129,0.2)] scale-[1.02] z-10';
    if (executionStatus === 'completed') return 'border-emerald-500/50 shadow-md';
    if (executionStatus === 'error') return 'border-red-500 ring-4 ring-red-500/20 shadow-[0_8px_30px_rgb(239,68,68,0.2)] z-10';
    if (selected) return 'border-blue-500 ring-4 ring-blue-500/20 shadow-[0_8px_30px_rgb(59,130,246,0.15)] translate-y-[-2px] z-10';
    if (multiSelected) return 'border-blue-400 ring-2 ring-blue-400/20 shadow-[0_4px_20px_rgb(59,130,246,0.12)] z-10';
    if (connecting) return 'border-dashed border-blue-500/40 bg-blue-500/5 shadow-none';
    if (reconnectTarget) return 'border-amber-400 ring-4 ring-amber-400/20 shadow-[0_8px_30px_rgb(245,158,11,0.2)] cursor-pointer z-10 animate-pulse';
    return `${themeStyles.border} shadow-sm hover:shadow-md hover:-translate-y-0.5`;
  };

  const getStatusIcon = () => {
    switch (executionStatus) {
      case 'running': return <Play className="w-3 h-3 text-white fill-current animate-pulse" />;
      case 'completed': return <Check className="w-3.5 h-3.5 text-white" />;
      case 'error': return <X className="w-3.5 h-3.5 text-white" />;
      default: return <Icon className={`w-4 h-4 ${themeStyles.text}`} />;
    }
  };

  const getStatusBg = () => {
    switch (executionStatus) {
      case 'running': return 'bg-emerald-500';
      case 'completed': return 'bg-emerald-500';
      case 'error': return 'bg-red-500';
      default: return `${themeStyles.bg} ${themeStyles.border} border`;
    }
  };

  return (
    <div
      className={`absolute w-64 rounded-[20px] border-2 transition-all duration-200 select-none flex flex-col overflow-visible group wf-node-card ${getStatusClasses()}`}
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
      <div className="rounded-[20px] overflow-hidden flex flex-col flex-1">
        {/* Header */}
        <div className="px-3 py-2.5 flex items-center gap-3 border-b wf-node-header">
          <div className={`w-8 h-8 rounded-xl shrink-0 transition-colors duration-300 flex items-center justify-center shadow-sm ${getStatusBg()}`}>
            {getStatusIcon()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold truncate leading-tight wf-node-title">
              {node.label || tool}
            </div>
            <div className={`text-[10px] truncate font-medium mt-0.5 opacity-80 ${themeStyles.text}`}>
              {tool}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 py-2 space-y-1.5 flex-1">
          {Object.keys(node.args || {}).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(node.args || {}).slice(0, 3).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg border wf-node-arg">
                  <span className="font-medium truncate max-w-[70px] flex-shrink-0 wf-node-arg-key" title={k}>{k}</span>
                  <span className="truncate flex-1 font-mono wf-node-arg-value">
                    {formatArgPreview(v)}
                  </span>
                </div>
              ))}
              {Object.keys(node.args || {}).length > 3 && (
                <div className="text-[9px] font-medium pl-1 flex items-center gap-1 pt-0.5 wf-fg-faint">
                  <MoreHorizontal className="w-3 h-3" />
                  {Object.keys(node.args || {}).length - 3} more
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] italic px-1 py-0.5 wf-node-empty">No configuration</div>
          )}
        </div>
      </div>

      {/* Action Handle - Connect (control wire, right side) */}
      <div
        className={`absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-4 wf-node-handle-ring shadow-sm flex items-center justify-center cursor-crosshair transition-all duration-200 z-20
          ${connecting
            ? 'bg-blue-600 text-white scale-110'
            : 'wf-node-handle-idle opacity-0 group-hover:opacity-100 hover:scale-110'
          }`}
        onClick={e => { e.stopPropagation(); onConnect(); }}
        title="Connect"
      >
        <Link2 className="w-3.5 h-3.5" />
      </div>

      {/* Input Handle (visual only, left side) */}
      {!isTrigger && (
        <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 wf-node-handle-ring shadow-sm ${themeStyles.bg}`} />
      )}

      {/* Stream Output Port */}
      {(isStreamProducer || hasStreamOut) && (
        <div
          className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-4 wf-node-handle-ring shadow-sm flex items-center justify-center cursor-crosshair transition-all duration-200 z-20
            ${connectingStreamFrom === node.id
              ? 'bg-cyan-500 scale-110'
              : hasStreamOut
                ? 'bg-cyan-900/60 text-cyan-400 hover:bg-cyan-500 hover:text-white hover:scale-110'
                : 'bg-cyan-900/30 text-cyan-500/50 opacity-0 group-hover:opacity-100 hover:bg-cyan-500 hover:text-white hover:scale-110'
            }`}
          onClick={e => { e.stopPropagation(); onStreamConnect?.(); }}
          title="Stream output — drag to connect stream wire"
        >
          <Radio className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Stream Input Ports */}
      {hasStreamIn && (
        <>
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 wf-node-handle-ring shadow-sm bg-cyan-800 border-cyan-600" title="Stream input" />
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 wf-node-handle-ring shadow-sm bg-cyan-800 border-cyan-600" title="Stream input" />
        </>
      )}

      {/* Stream badge */}
      {isStreamProducer && !hasStreamOut && (
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30" title="Stream producer">
          <Radio className="w-2.5 h-2.5 text-white" />
        </div>
      )}
    </div>
  );
}
