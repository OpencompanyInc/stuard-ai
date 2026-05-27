import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { CheckCircle, Clock, Loader2, Terminal, XCircle } from 'lucide-react';
import type { TerminalOutputStatus } from '../helpers/terminalOutput';

const MAX_DISPLAY_CHARS = 16 * 1024;

interface TerminalOutputPanelProps {
  output: string;
  title?: string;
  isRunning?: boolean;
  status?: TerminalOutputStatus | null;
  placeholder?: string;
}

function StatusBadge({ status }: { status: TerminalOutputStatus }) {
  if (status.timeout) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
        <Clock className="w-3 h-3 text-amber-400" />
        <span className="text-[10px] text-amber-400 font-medium">Timed out</span>
      </div>
    );
  }

  if (status.matched === false) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20">
        <XCircle className="w-3 h-3 text-red-400" />
        <span className="text-[10px] text-red-400 font-medium">No match</span>
      </div>
    );
  }

  if (status.matched === true || status.done === true) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] text-emerald-400 font-medium">
          {typeof status.exitCode === 'number' ? `Exit ${status.exitCode}` : 'Ready'}
        </span>
      </div>
    );
  }

  return null;
}

export const TerminalOutputPanel: React.FC<TerminalOutputPanelProps> = ({
  output,
  title = 'Terminal',
  isRunning = false,
  status,
  placeholder = 'Waiting for output…',
}) => {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output, isRunning]);

  const display = output.length > MAX_DISPLAY_CHARS
    ? output.slice(output.length - MAX_DISPLAY_CHARS)
    : output;

  const showCursor = isRunning && display.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800/80 shadow-sm">
      <div className="bg-neutral-900 px-3 py-2 flex items-center gap-2.5 select-none">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        </div>

        <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5">
          <Terminal className="w-3 h-3 text-neutral-600 shrink-0" />
          <span className="text-[11px] text-neutral-400 font-medium truncate">{title}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status ? <StatusBadge status={status} /> : null}
          {isRunning ? <Loader2 className="w-3 h-3 animate-spin text-neutral-500" /> : null}
        </div>
      </div>

      <pre
        ref={ref}
        className={clsx(
          'px-3 py-2.5 text-[11px] leading-[1.35] font-mono whitespace-pre overflow-auto scrollbar-thin',
          'bg-[#0c0c0c] text-[#d4d4d4] selection:bg-neutral-700 selection:text-white',
        )}
        style={{ maxHeight: 280, minHeight: display ? undefined : 72 }}
      >
        {display || (
          <span className="text-neutral-500">{placeholder}</span>
        )}
        {showCursor ? (
          <span className="inline-block w-[7px] h-[13px] align-[-2px] bg-neutral-400 animate-pulse ml-px" />
        ) : null}
        {isRunning && !display ? (
          <span className="inline-block w-[7px] h-[13px] align-[-2px] bg-neutral-500 animate-pulse ml-px" />
        ) : null}
      </pre>
    </div>
  );
};
