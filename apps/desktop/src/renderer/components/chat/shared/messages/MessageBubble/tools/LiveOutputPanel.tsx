import React, { useEffect, useRef } from 'react';
import { Terminal, Loader2 } from 'lucide-react';

export const LIVE_OUTPUT_TOOL_NAMES = new Set([
  'run_command',
  'run_python_script',
  'run_node_script',
]);

interface LiveOutputPanelProps {
  output: string;
  toolName: string;
}

export const LiveOutputPanel: React.FC<LiveOutputPanelProps> = ({ output, toolName }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Tail-follow: keep the latest output line visible as new chunks stream in.
    el.scrollTop = el.scrollHeight;
  }, [output]);

  // Cap rendered text — useAgent.ts already trims to ~16KB, but a defensive
  // slice keeps DOM cheap if a future caller forwards a larger payload.
  const display = output.length > 16 * 1024
    ? output.slice(output.length - 16 * 1024)
    : output;

  return (
    <div className="overflow-hidden rounded-md border border-white/5"
      style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 40%, transparent)' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5">
        <Terminal className="h-3 w-3 text-theme-muted" />
        <span className="text-[10px] font-medium text-theme-muted uppercase tracking-wide">
          {toolName === 'run_command' ? 'output' : toolName}
        </span>
        <Loader2 className="ml-auto h-3 w-3 animate-spin text-theme-muted" />
      </div>
      <div
        ref={ref}
        className="scrollbar-thin font-mono text-[10.5px] leading-[1.45] px-2.5 py-1.5 overflow-y-auto whitespace-pre-wrap break-all"
        style={{
          maxHeight: 160,
          color: 'color-mix(in srgb, var(--foreground) 78%, transparent)',
        }}
      >
        {display || <span className="opacity-50">Waiting for output…</span>}
      </div>
    </div>
  );
};
