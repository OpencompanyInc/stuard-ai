import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Copy, Check, Terminal, Loader2, CheckCircle, XCircle, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';

export interface TerminalBlockProps {
  command: string;
  output?: string;
  onRun?: (command: string) => Promise<{ ok: boolean; output: string }>;
  autoRun?: boolean;
  title?: string;
  expanded?: boolean;
}

export const TerminalBlock: React.FC<TerminalBlockProps> = ({
  command,
  output: initialOutput,
  onRun,
  autoRun = false,
  title,
  expanded: defaultExpanded = false
}) => {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(initialOutput || '');
  const [exitStatus, setExitStatus] = useState<'success' | 'error' | null>(null);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const outputRef = useRef<HTMLPreElement>(null);
  const hasRun = useRef(false);

  // Stop propagation to prevent triggering parent click handlers
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Auto-run on mount if enabled
  useEffect(() => {
    if (autoRun && onRun && !hasRun.current) {
      hasRun.current = true;
      handleRun();
    }
  }, [autoRun]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleRun = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onRun || running) return;

    setRunning(true);
    setOutput('');
    setExitStatus(null);
    setIsExpanded(true);

    try {
      const result = await onRun(command);
      setOutput(result.output || '');
      setExitStatus(result.ok ? 'success' : 'error');
    } catch (err: any) {
      setOutput(`Error: ${err.message || err}`);
      setExitStatus('error');
    } finally {
      setRunning(false);
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      onClick={handleContainerClick}
      className={clsx(
        "w-full max-w-2xl rounded-xl overflow-hidden my-3 shadow-lg border border-neutral-800 transition-all duration-300",
        isExpanded ? "ring-1 ring-neutral-700" : "shadow-sm"
      )}
    >
      {/* Header */}
      <div className="bg-neutral-900 px-4 py-2.5 flex items-center gap-3 select-none">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-3 h-3 rounded-full bg-red-500/80 shadow-sm" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80 shadow-sm" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80 shadow-sm" />
        </div>

        <div className="flex-1 text-center min-w-0 flex items-center justify-center gap-2">
          <Terminal className="w-3 h-3 text-neutral-600" />
          <span className="text-xs text-neutral-400 font-medium truncate">
            {title || 'Terminal'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {exitStatus === 'success' && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-medium">Success</span>
            </div>
          )}
          {exitStatus === 'error' && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20">
              <XCircle className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-red-400 font-medium">Failed</span>
            </div>
          )}

          <button
            onClick={handleToggleExpand}
            className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Command */}
      <div className="bg-neutral-950 px-4 py-3 flex items-start gap-3 border-t border-neutral-800 relative group">
        <span className="text-emerald-400 font-mono text-sm select-none shrink-0 mt-0.5">$</span>
        <code className="text-sm text-neutral-200 font-mono flex-1 break-all leading-relaxed">
          {command}
        </code>

        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 p-1.5 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-all opacity-0 group-hover:opacity-100"
          title="Copy command"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Output */}
      <AnimatePresence initial={false}>
        {(output || running) && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-neutral-800 bg-[#0d0d0d]"
          >
            <pre
              ref={outputRef}
              className="px-4 py-3 text-xs text-neutral-400 font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto genui-scrollbar leading-relaxed selection:bg-neutral-700 selection:text-white"
            >
              {output}
              {running && (
                <span className="inline-block w-2 h-4 align-middle bg-neutral-500 animate-pulse ml-1" />
              )}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="bg-neutral-900 px-3 py-2 flex items-center gap-2 border-t border-neutral-800">
        <div className="flex-1" />

        {onRun && (
          <button
            onClick={handleRun}
            disabled={running}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shadow-sm",
              running
                ? "bg-amber-500/10 text-amber-500 cursor-wait ring-1 ring-amber-500/30"
                : "bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow hover:-translate-y-0.5 active:translate-y-0"
            )}
          >
            {running ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Command</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};



