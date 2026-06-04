import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ChevronRight, ExternalLink, Loader2, Users, XCircle } from 'lucide-react';
import { ChainOfThoughtStep } from '../../../../../ai-elements/ChainOfThought';
import { Shimmer } from '../../../../../ai-elements/Shimmer';
import { useElapsedSeconds } from '../../../../../../hooks/useSharedTicker';
import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../../utils/text';
import { extractDelegationTasks, normalizeSubagentName, resolveToolName } from '../helpers/delegation';
import { formatDuration } from '../helpers/media';
import { normalizeMarkdownSpacing } from '../helpers/markdown';
import { humanizeToolName } from '../helpers/toolLabels';
import type { AssistantTraceStepData } from '../types';
import { ToolTraceContent } from './ToolTraceContent';

interface DelegationCardProps {
  step: AssistantTraceStepData;
  childSteps: AssistantTraceStepData[];
  isLast: boolean;
}

export const DelegationCard: React.FC<DelegationCardProps> = memo(({ step, childSteps, isLast }) => {
  const tool = step.tool!;
  const status = step.status;
  const tasks = useMemo(() => extractDelegationTasks(tool), [tool]);
  const isRunning = status === 'active' || status === 'pending';
  const isError = status === 'error';
  const isComplete = status === 'complete';

  const toolChildCount = childSteps.filter(c => c.kind === 'tool').length;

  // Auto-expand while running so progress is visible, auto-collapse once done.
  const [expanded, setExpanded] = useState(isRunning || isError);
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning && !isError) {
      setExpanded(false);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, isError]);

  // Live elapsed ticker while running — backed by the shared ticker bus so N
  // running delegation cards share a single interval instead of one each.
  const elapsedSec = useElapsedSeconds(tool.timestamp, isRunning);


  const agentLabel = tasks.length === 1
    ? `${humanizeToolName(tasks[0].subagent)} agent`
    : `${tasks.length} agents`;

  const hasWorkflowTask = tasks.some(t => normalizeSubagentName(t.subagent) === 'workflow');
  // Scan child trace steps for a completed create_workflow OR load_workflow
  // call and surface its workflow id, so "Open in Studio" can deep-link
  // instead of dumping the user on the workflow list. Either tool is a
  // valid signal that the workflow exists on disk and is in session.
  const targetWorkflowId = useMemo<string | null>(() => {
    if (!hasWorkflowTask) return null;
    const readSpecId = (raw: unknown): string | null => {
      if (!raw) return null;
      let val: any = raw;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch { return null; }
      }
      if (typeof val !== 'object' || val === null) return null;
      if (typeof val.workflowId === 'string' && val.workflowId) return val.workflowId;
      if (typeof val.id === 'string' && val.id.startsWith('flow_')) return val.id;
      if (val.spec && typeof val.spec.id === 'string' && val.spec.id) return val.spec.id;
      return null;
    };
    // Walk in reverse so the most-recent create/load wins if the agent did
    // both in one run (e.g. load → modify → create-derivative).
    for (let i = childSteps.length - 1; i >= 0; i--) {
      const c = childSteps[i];
      const t = c.tool;
      if (!t || c.kind !== 'tool') continue;
      const name = resolveToolName(t);
      if (name !== 'create_workflow' && name !== 'load_workflow') continue;
      // Only deep-link once the tool has actually finished — both create
      // and load mutate session/disk in their execute step, so completion
      // is the safe signal that the file is openable.
      if (t.status !== 'completed') continue;
      const fromResult = readSpecId(t.result);
      if (fromResult) return fromResult;
      const fromArgs = t.args?.workflowId || t.args?.spec?.id || t.args?.tool_args?.spec?.id;
      if (typeof fromArgs === 'string' && fromArgs) return fromArgs;
    }
    return null;
  }, [hasWorkflowTask, childSteps]);

  const statusText = isError
    ? 'Failed'
    : isRunning
      ? (toolChildCount > 0 ? `Working · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}` : 'Working…')
      : `Done · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}`;

  const borderColor = isError
    ? 'color-mix(in srgb, var(--destructive) 40%, transparent)'
    : isRunning
      ? 'color-mix(in srgb, var(--primary) 55%, transparent)'
      : 'color-mix(in srgb, var(--foreground-muted) 18%, transparent)';

  return (
    <div className={clsx('w-full', isLast ? 'mb-0' : 'mb-4')}>
      <div
        className="rounded-xl border overflow-hidden transition-colors duration-150"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
          borderColor,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors"
        >
          <div
            className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-md"
            style={{
              backgroundColor: isRunning
                ? 'color-mix(in srgb, var(--primary) 18%, transparent)'
                : 'color-mix(in srgb, var(--sidebar-item-hover) 70%, transparent)',
            }}
          >
            <Users
              className="h-3 w-3"
              style={{
                color: isRunning
                  ? 'color-mix(in srgb, var(--primary) 95%, transparent)'
                  : 'color-mix(in srgb, var(--foreground) 65%, transparent)',
              }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[12px] font-medium"
                style={{ color: 'color-mix(in srgb, var(--foreground) 82%, transparent)' }}
              >
                {isRunning ? (
                  <Shimmer as="span" duration={2} spread={3}>{agentLabel}</Shimmer>
                ) : agentLabel}
              </span>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 85%, transparent)' }}
              >
                {statusText}
                {elapsedSec > 0 ? ` · ${formatDuration(elapsedSec)}` : ''}
              </span>
            </div>
            {tasks.length === 1 && tasks[0].instruction ? (
              <div
                className="mt-0.5 text-[11px] leading-snug line-clamp-2"
                style={{ color: 'color-mix(in srgb, var(--foreground) 58%, transparent)' }}
                title={tasks[0].instruction}
              >
                {tasks[0].instruction}
              </div>
            ) : null}
            {tasks.length > 1 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {tasks.map((t, i) => (
                  <span
                    key={`${t.subagent}-${i}`}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 65%, transparent)',
                      color: 'color-mix(in srgb, var(--foreground) 70%, transparent)',
                    }}
                    title={t.instruction}
                  >
                    {humanizeToolName(t.subagent)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
            {hasWorkflowTask && targetWorkflowId ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  try { window.desktopAPI?.openWorkflows({ workflowId: targetWorkflowId }); } catch {}
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    try { window.desktopAPI?.openWorkflows({ workflowId: targetWorkflowId }); } catch {}
                  }
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)',
                  color: 'color-mix(in srgb, var(--primary) 95%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--primary) 28%, transparent)',
                }}
                title={`Open ${targetWorkflowId} in Workflow Studio`}
              >
                <ExternalLink className="h-3 w-3" />
                Open in Studio
              </span>
            ) : null}
            {isRunning ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                style={{ color: 'color-mix(in srgb, var(--primary) 90%, transparent)' }}
              />
            ) : isError ? (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            ) : isComplete ? (
              <CheckCircle
                className="h-3.5 w-3.5"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 70%, transparent)' }}
              />
            ) : null}
            <ChevronRight
              className={clsx(
                'h-3.5 w-3.5 transition-transform duration-200',
                expanded && 'rotate-90',
              )}
              style={{ color: 'color-mix(in srgb, var(--foreground-muted) 55%, transparent)' }}
            />
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expanded && childSteps.length > 0 ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="border-t px-3 pt-2.5 pb-1"
                style={{ borderColor: 'color-mix(in srgb, var(--foreground-muted) 12%, transparent)' }}
              >
                {childSteps.map((child, idx) => (
                  <ChainOfThoughtStep
                    key={child.id}
                    status={child.status}
                    isLast={idx === childSteps.length - 1}
                    label={
                      child.status === 'active' ? (
                        <Shimmer as="span" duration={2} spread={3}>{child.label}</Shimmer>
                      ) : child.label
                    }
                  >
                    {(child.kind === 'reasoning' || child.kind === 'text') && child.content ? (
                      <div
                        className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[12px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px] prose-strong:font-semibold"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                          color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkMath, remarkGfm]}
                          rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                        >
                          {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(child.content)))}
                        </ReactMarkdown>
                      </div>
                    ) : null}
                    {child.kind === 'tool' && child.tool ? (
                      <ToolTraceContent tool={child.tool} />
                    ) : null}
                  </ChainOfThoughtStep>
                ))}
                {/* Inline steer input removed — running subagents are now nudged
                    via the main composer's steer-target dropdown so there's a
                    single place to talk to delegated agents. */}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});
