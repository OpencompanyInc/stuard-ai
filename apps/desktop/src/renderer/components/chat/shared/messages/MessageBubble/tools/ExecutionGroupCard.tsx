import React, { memo, useMemo, useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, ListOrdered, Split, XCircle } from 'lucide-react';
import { useElapsedSecondsFine } from '../../../../../../hooks/useSharedTicker';
import { formatDuration } from '../helpers/media';
import { buildExecutionGroupFallbackChildren, deriveExecutionGroupStatus, getExecutionGroupKind, normalizeExecutionGroupChildren } from '../helpers/delegation';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import type { AssistantTraceStepData, TraceStatus } from '../types';
import { ToolTraceContent } from './ToolTraceContent';

interface ExecutionGroupCardProps {
  step: AssistantTraceStepData;
  childSteps: AssistantTraceStepData[];
  isLast: boolean;
}

/** Compact human hint pulled from a child tool's primary argument. */
function getBranchArgHint(tool?: ToolCall): string {
  if (!tool || !tool.args) return '';
  let args: any = tool.args;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return ''; }
  }
  if (!args || typeof args !== 'object') return '';
  const keys = ['query', 'q', 'search_term', 'url', 'target', 'path', 'file_path', 'command', 'cmd', 'pattern', 'prompt', 'instruction', 'name', 'title'];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) {
      let s = v.trim();
      if ((k === 'url' || k === 'target') && /^https?:\/\//i.test(s)) {
        try { s = new URL(s).hostname.replace(/^www\./, ''); } catch {}
      }
      return s.length > 64 ? `${s.slice(0, 61)}…` : s;
    }
  }
  return '';
}

/** Animated node that sits on the timeline rail of an execution group. */
function BranchStatusNode({ status }: { status: TraceStatus }) {
  const base = 'relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full';

  if (status === 'active') {
    return (
      <span className={base} style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)' }}>
        <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className={base} style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 18%, transparent)' }}>
        <XCircle className="h-3 w-3" style={{ color: 'var(--destructive)' }} />
      </span>
    );
  }
  if (status === 'complete') {
    return (
      <span className={base} style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)' }}>
        <Check className="h-3 w-3" style={{ color: 'color-mix(in srgb, var(--primary) 95%, transparent)' }} />
      </span>
    );
  }
  return (
    <span
      className={clsx(base, 'border')}
      style={{ borderColor: 'color-mix(in srgb, var(--foreground-muted) 35%, transparent)' }}
    >
      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--foreground-muted) 45%, transparent)' }} />
    </span>
  );
}

/** One branch row on the execution rail, with click-to-reveal detail. */
function BranchLane({ child }: { child: AssistantTraceStepData }) {
  const tool = child.tool;
  const isActive = child.status === 'active';
  const argHint = tool ? getBranchArgHint(tool) : '';
  const hasDetail =
    (child.kind === 'tool' && tool && (tool.status === 'completed' || tool.status === 'error')) ||
    ((child.kind === 'reasoning' || child.kind === 'text') && !!child.content);
  const [open, setOpen] = useState(false);
  const elapsedSec = useElapsedSecondsFine(tool?.timestamp, isActive);

  return (
    <div className="relative">
      <div className="flex items-start gap-2.5 py-1">
        <BranchStatusNode status={child.status} />
        <button
          type="button"
          onClick={() => hasDetail && setOpen((v) => !v)}
          className={clsx('group/lane min-w-0 flex-1 text-left', hasDetail ? 'cursor-pointer' : 'cursor-default')}
        >
          <div className="flex items-center gap-2">
            <span
              className="truncate text-[12px] font-medium"
              style={{ color: 'color-mix(in srgb, var(--foreground) 82%, transparent)' }}
            >
              {isActive ? <span className="text-theme-muted/80">{child.label}</span> : child.label}
            </span>
            {argHint ? (
              <span
                className="truncate text-[11px]"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 80%, transparent)' }}
              >
                {argHint}
              </span>
            ) : null}
            {hasDetail ? (
              <ChevronRight
                className={clsx(
                  'h-3 w-3 shrink-0 opacity-0 transition-all duration-150 group-hover/lane:opacity-60',
                  open && 'rotate-90 opacity-60',
                )}
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 70%, transparent)' }}
              />
            ) : null}
          </div>
        </button>
        <span
          className="shrink-0 pt-0.5 text-[10px] tabular-nums"
          style={{ color: 'color-mix(in srgb, var(--foreground-muted) 80%, transparent)' }}
        >
          {isActive ? (elapsedSec > 0 ? formatDuration(elapsedSec) : 'running…') : ''}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && hasDetail ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="ml-[28px] pb-1.5">
              {(child.kind === 'reasoning' || child.kind === 'text') && child.content ? (
                <div
                  className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed break-words whitespace-pre-wrap"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                    color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                  }}
                >
                  {child.content}
                </div>
              ) : null}
              {child.kind === 'tool' && tool ? <ToolTraceContent tool={tool} /> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Rectangle card for run_parallel / run_sequential / loop_executor groups.
 * Parallel shows a fork→branches rail; sequential shows an ordered timeline.
 * Children are linked to this parent via parentToolId so the group stays intact
 * across chat reopen. Mirrors the shared chat-ui GroupTraceCard.
 */
export const ExecutionGroupCard: React.FC<ExecutionGroupCardProps> = memo(({ step, childSteps, isLast }) => {
  const tool = step.tool!;
  const kind = getExecutionGroupKind(tool);
  const displayChildren = useMemo(() => {
    const base = childSteps.length > 0
      ? childSteps
      : buildExecutionGroupFallbackChildren(tool, step.status);
    const groupStatus = deriveExecutionGroupStatus(step.status, base);
    return normalizeExecutionGroupChildren(base, groupStatus);
  }, [childSteps, tool, step.status]);
  const status = deriveExecutionGroupStatus(step.status, displayChildren);
  const isRunning = status === 'active';
  const isError = status === 'error';
  const isComplete = status === 'complete';

  const toolChildren = displayChildren.filter((c) => c.kind === 'tool');
  const doneCount = toolChildren.filter((c) => c.status === 'complete' || c.status === 'error').length;
  const n = toolChildren.length;
  const headerLabel = kind === 'parallel'
    ? (n > 0 ? `${n} step${n === 1 ? '' : 's'} in parallel` : 'Parallel execution')
    : (n > 0 ? `${n} step${n === 1 ? '' : 's'} in sequence` : 'Sequential execution');

  // Stay expanded after completion so branch details remain visible (like delegation).
  const [expanded, setExpanded] = useState(() => isRunning || isError || displayChildren.length > 0);

  const Icon = kind === 'parallel' ? Split : ListOrdered;
  const accent = isError ? 'var(--destructive)' : 'var(--primary)';
  const tinted = (pct: number) => `color-mix(in srgb, ${accent} ${pct}%, transparent)`;
  const isAccented = isRunning || isError;

  const statusText = isError
    ? 'Failed'
    : isRunning
      ? (n > 0 ? `${doneCount}/${n}` : 'Working…')
      : (n > 0 ? `${doneCount}/${n}` : 'Done');

  return (
    <div className={clsx('w-full', isLast ? 'mb-0' : 'mb-3')}>
      <div
        className="overflow-hidden rounded-2xl border border-cot-subtle backdrop-blur-sm transition-colors"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--sidebar-item-hover) 26%, transparent), color-mix(in srgb, var(--sidebar-item-hover) 12%, transparent))',
          borderColor: isAccented ? tinted(30) : undefined,
          boxShadow: isAccented ? `0 0 0 1px ${tinted(8)}` : 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full flex-col gap-0 px-3.5 pb-2.5 pt-2.5 text-left"
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor: isAccented ? tinted(16) : 'color-mix(in srgb, var(--sidebar-item-hover) 70%, transparent)',
                color: isAccented ? tinted(95) : 'color-mix(in srgb, var(--foreground) 60%, transparent)',
              }}
            >
              <Icon className={clsx('h-3.5 w-3.5', kind === 'parallel' && 'rotate-90')} />
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="truncate text-[12.5px] font-semibold tracking-tight"
                style={{ color: 'color-mix(in srgb, var(--foreground) 88%, transparent)' }}
              >
                {isRunning ? (
                  <span className="text-theme-muted/80">{headerLabel}</span>
                ) : headerLabel}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                style={{
                  backgroundColor: isError ? tinted(14) : 'color-mix(in srgb, var(--sidebar-item-hover) 60%, transparent)',
                  color: isError ? tinted(95) : 'color-mix(in srgb, var(--foreground-muted) 95%, transparent)',
                }}
              >
                {statusText}
              </span>
              {isRunning ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tinted(90) }}
                />
              ) : isComplete ? (
                <Check className="h-3.5 w-3.5" style={{ color: 'color-mix(in srgb, var(--primary) 80%, transparent)' }} />
              ) : isError ? (
                <XCircle className="h-3.5 w-3.5" style={{ color: 'var(--destructive)' }} />
              ) : null}
              <ChevronRight
                className={clsx('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-90')}
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 55%, transparent)' }}
              />
            </div>
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expanded && displayChildren.length > 0 ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="border-t border-t-cot-faint px-3.5 pb-2 pt-2"
              >
                <div className="relative">
                  <div
                    className="pointer-events-none absolute bottom-3 left-[8.5px] top-3 w-px"
                    style={{
                      background:
                        'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--foreground-muted) 22%, transparent) 12%, color-mix(in srgb, var(--foreground-muted) 22%, transparent) 88%, transparent)',
                    }}
                  />
                  {displayChildren.map((child) => (
                    <BranchLane key={child.id} child={child} />
                  ))}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});
