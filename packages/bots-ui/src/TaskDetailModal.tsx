import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, X, Hand, Loader2 } from 'lucide-react';
import {
  EXECUTION_TARGET_LABELS,
  PROACTIVE_MODEL_MODE_LABELS,
  type ExecutionTarget,
  type ProactiveModelMode,
} from './proactive-types';
import type { BotTrigger } from './types';
import { TRIGGER_META } from './constants';
import { Pill } from './primitives';
import { buildLogPreview, formatDuration } from './helpers';

export function TaskDetailModal({
  log,
  firedBy,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  log: any;
  firedBy?: BotTrigger | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      if (e.key === 'ArrowRight' && hasNext) onNext?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const d = new Date(log.startedAt);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateLabel = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const isRunning = !isCompleted && !isFailed;
  const liveText = typeof log.partialResponse === 'string' ? log.partialResponse.trim() : '';

  const duration = formatDuration(log.startedAt, log.completedAt);
  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 200)
    || (isRunning && liveText ? liveText.split(/\n+/)[0].slice(0, 200) : '')
    || buildLogPreview(log);
  const body = log.agentMessage && log.agentMessage.split(/\n+/).slice(1).join('\n').trim();
  // The full stage pipeline fires in the same second on a fast run, so a list of
  // "...0s" pills (with retries re-emitting the same stage) was pure noise. Keep
  // only the current stage, shown as a single live line until output streams in.
  const stageHistory = Array.isArray(log.stageHistory) ? log.stageHistory : [];
  const currentStageLabel = isRunning && stageHistory.length
    ? String(stageHistory[stageHistory.length - 1]?.label || '').trim()
    : '';

  const TriggerIcon = firedBy ? TRIGGER_META[firedBy.type]?.icon : Hand;
  const triggerLabel = firedBy ? (TRIGGER_META[firedBy.type]?.label || firedBy.type) : 'Manual';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="relative w-full max-w-[520px] rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={clsx('text-[12px] font-semibold', statusColor)}>{statusLabel}</span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center leading-tight">
              <div className="text-[14px] font-medium text-theme-fg tabular-nums">{time}</div>
              <div className="text-[11px] text-theme-muted">{dateLabel}</div>
            </div>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 text-[14px] font-medium leading-6 text-theme-fg">{title}</div>
        {body && (
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-theme-fg/85">{body}</p>
        )}
        {!body && isRunning && liveText && (
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-theme-fg/85">
            {liveText}
            <span className="ml-1 inline-block h-3.5 w-[3px] translate-y-0.5 animate-pulse rounded-sm bg-amber-300/80 align-baseline" />
          </p>
        )}
        {!body && !liveText && isRunning && currentStageLabel && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-theme-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {currentStageLabel}
          </p>
        )}
        {log.failureReason && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            {log.failureReason}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Pill>
            <TriggerIcon className="h-3 w-3" />
            {triggerLabel}
          </Pill>
          {log.executionTarget && <Pill>{EXECUTION_TARGET_LABELS[log.executionTarget as ExecutionTarget]?.label || log.executionTarget}</Pill>}
          {log.modelMode && <Pill>{PROACTIVE_MODEL_MODE_LABELS[log.modelMode as ProactiveModelMode]?.label || log.modelMode}</Pill>}
          {duration && <Pill>Execution Time: {duration}</Pill>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
