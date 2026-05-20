import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Archive } from 'lucide-react';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '../../../../../ai-elements/ChainOfThought';
import { Shimmer } from '../../../../../ai-elements/Shimmer';
import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../../utils/text';
import type { ToolCall, StreamChunk } from '../../../../../../hooks/useAgent';
import { GENUI_TOOL_NAMES, HIDDEN_TOOL_NAMES } from '../constants';
import {
  assignDelegationChildrenToTasks,
  buildDelegationTaskStep,
  extractDelegationTasks,
  isDelegationToolCall,
} from '../helpers/delegation';
import { normalizeMarkdownSpacing } from '../helpers/markdown';
import { formatDuration } from '../helpers/media';
import { getToolStepLabel } from '../helpers/toolStepLabel';
import {
  SUBAGENT_REPLY_FALLBACK,
  compactReasoningTraceSteps,
  isDelegatedToolCall,
  isTopLevelDuplicateOfNestedTool,
  mapTraceStatus,
  summarizeReasoningLabel,
} from '../helpers/trace';
import type { AssistantTraceStepData } from '../types';
import { CollapsibleToolGroup } from './CollapsibleToolGroup';
import { DelegationCard } from './DelegationCard';
import { StatusTraceMeta } from './StatusTraceMeta';
import { ToolTraceContent } from './ToolTraceContent';

interface AssistantTracePanelProps {
  reasoning?: string;
  reasoningDuration?: number;
  toolCalls?: ToolCall[];
  streamChunks?: StreamChunk[];
  isStreaming?: boolean;
  defaultOpen?: boolean;
}

export const AssistantTracePanel: React.FC<AssistantTracePanelProps> = ({
  reasoning,
  reasoningDuration,
  toolCalls,
  streamChunks,
  isStreaming,
  defaultOpen,
}) => {
  const traceSteps = useMemo<AssistantTraceStepData[]>(() => {
    const steps: AssistantTraceStepData[] = [];

    if (streamChunks && streamChunks.length > 0) {
      const lastReasoningIndex = streamChunks.reduce((lastIndex, chunk, index) => (
        chunk.type === 'reasoning' ? index : lastIndex
      ), -1);
      const lastNestedTextIndex = streamChunks.reduce((lastIndex, chunk, index) => (
        chunk.type === 'text' && chunk.nested ? index : lastIndex
      ), -1);

      streamChunks.forEach((chunk, index) => {
        if (chunk.type === 'reasoning') {
          steps.push({
            id: `reasoning-${index}`,
            kind: 'reasoning',
            label: summarizeReasoningLabel(chunk.content),
            status: isStreaming && index === lastReasoningIndex ? 'active' : 'complete',
            content: chunk.content,
            nested: chunk.nested,
            subagentId: chunk.subagentId,
          });
          return;
        }

        // Nested text = a delegated subagent's narration to the orchestrator.
        // Render it inside the chain-of-thought with a live summary of the
        // subagent's prose as the label (mirroring how reasoning/thought tokens
        // display), rather than a static "Subagent reply" tag.
        if (chunk.type === 'text' && chunk.nested) {
          steps.push({
            id: `nested-text-${index}`,
            kind: 'text',
            label: summarizeReasoningLabel(chunk.content, SUBAGENT_REPLY_FALLBACK),
            status: isStreaming && index === lastNestedTextIndex ? 'active' : 'complete',
            content: chunk.content,
            nested: true,
            subagentId: chunk.subagentId,
          });
          return;
        }

        if (chunk.type === 'tool') {
          const tc = chunk.tool;
          if (isTopLevelDuplicateOfNestedTool(tc, streamChunks)) return;
          if (HIDDEN_TOOL_NAMES.has(tc.tool) || GENUI_TOOL_NAMES.has(tc.tool)) return;

          steps.push({
            id: tc.id || `tool-${index}`,
            kind: 'tool',
            label: getToolStepLabel(tc),
            status: mapTraceStatus(tc, isStreaming),
            tool: tc,
            nested: isDelegatedToolCall(tc),
            subagentId: tc.subagentId,
          });
          return;
        }

        if (chunk.type === 'status') {
          steps.push({
            id: chunk.id || `status-${index}`,
            kind: 'status',
            label: chunk.label,
            status: chunk.state === 'error' ? 'error' : chunk.state === 'active' ? 'active' : 'complete',
            nested: chunk.nested,
            subagentId: chunk.subagentId,
            subagentKind: typeof chunk.meta?.subagentKind === 'string' ? chunk.meta.subagentKind : undefined,
            statusVariant: chunk.variant,
            statusMeta: chunk.meta,
          });
        }
      });

      return compactReasoningTraceSteps(steps);
    }

    if (reasoning && reasoning.trim().length > 0) {
      steps.push({
        id: 'reasoning-fallback',
        kind: 'reasoning',
        label: summarizeReasoningLabel(reasoning),
        status: 'complete',
        content: reasoning,
      });
    }

    (toolCalls || [])
      .filter((tool) => !HIDDEN_TOOL_NAMES.has(tool.tool) && !GENUI_TOOL_NAMES.has(tool.tool))
      .forEach((tool, index) => {
        steps.push({
          id: tool.id || `tool-fallback-${index}`,
          kind: 'tool',
          label: getToolStepLabel(tool),
          status: mapTraceStatus(tool, isStreaming),
          tool,
          nested: isDelegatedToolCall(tool),
          subagentId: tool.subagentId,
        });
      });

    return compactReasoningTraceSteps(steps);
  }, [isStreaming, reasoning, streamChunks, toolCalls]);

  // Build the display tree out of traceSteps in a useMemo so that streaming
  // ticks (which flip `isStreaming`/timer state in ancestors) don't re-walk
  // the O(N) DisplayItem/nestGroups graph on every render. Only traceSteps
  // identity actually controls structure here.
  const renderedTraceTree = useMemo(() => {
          // Build display items: group consecutive same-tool calls, separate nested vs orchestrator,
          // and wrap delegation tool calls with their subagent children into a single rectangle card.
          type DisplayItem =
            | { type: 'step'; step: AssistantTraceStepData; idx: number; nested: boolean }
            | { type: 'tool-group'; toolName: string; steps: { step: AssistantTraceStepData; idx: number }[]; nested: boolean }
            | { type: 'delegation'; step: AssistantTraceStepData; idx: number; children: AssistantTraceStepData[]; lastChildIdx: number };

          const items: DisplayItem[] = [];
          const consumedNestedIndexes = new Set<number>();
          let i = 0;
          while (i < traceSteps.length) {
            if (consumedNestedIndexes.has(i)) {
              i++;
              continue;
            }
            const step = traceSteps[i];
            const isNested = Boolean(step.nested);

            // Top-level delegation tool: absorb later nested subagent steps as
            // children. Long tool calls can time out and let orchestrator
            // reasoning interleave before the subagent's final updates arrive,
            // so this cannot require strict adjacency.
            if (!isNested && step.kind === 'tool' && step.tool && isDelegationToolCall(step.tool)) {
              const childEntries: Array<{ step: AssistantTraceStepData; idx: number }> = [];
              let lastChildIdx = i;
              let j = i + 1;
              while (j < traceSteps.length) {
                const candidate = traceSteps[j];
                if (
                  !candidate.nested &&
                  candidate.kind === 'tool' &&
                  candidate.tool &&
                  isDelegationToolCall(candidate.tool)
                ) {
                  break;
                }
                if (candidate.nested) {
                  childEntries.push({ step: candidate, idx: j });
                  consumedNestedIndexes.add(j);
                  lastChildIdx = j;
                }
                j++;
              }
              const tasks = extractDelegationTasks(step.tool);
              if (tasks.length > 1) {
                const taskAssignments = assignDelegationChildrenToTasks(tasks, childEntries);
                taskAssignments.forEach((assignment, taskIndex) => {
                  items.push({
                    type: 'delegation',
                    step: buildDelegationTaskStep(step, tasks[taskIndex], taskIndex, assignment.children),
                    idx: i,
                    children: assignment.children,
                    lastChildIdx: assignment.lastChildIdx >= 0 ? assignment.lastChildIdx : i,
                  });
                });
              } else {
                const children = childEntries.map(({ step: child }) => child);
                items.push({
                  type: 'delegation',
                  step,
                  idx: i,
                  children,
                  lastChildIdx,
                });
              }
              i++;
              continue;
            }

            // Try to group consecutive tool steps with the same tool name and same nesting level
            if (step.kind === 'tool' && step.tool) {
              const toolName = step.tool.tool;
              const groupSteps: { step: AssistantTraceStepData; idx: number }[] = [{ step, idx: i }];
              let j = i + 1;
              while (j < traceSteps.length) {
                const next = traceSteps[j];
                if (next.kind === 'tool' && next.tool?.tool === toolName && Boolean(next.nested) === isNested) {
                  groupSteps.push({ step: next, idx: j });
                  j++;
                } else {
                  break;
                }
              }
              if (groupSteps.length >= 2) {
                items.push({ type: 'tool-group', toolName, steps: groupSteps, nested: isNested });
              } else {
                items.push({ type: 'step', step, idx: i, nested: isNested });
              }
              i = j;
            } else {
              items.push({ type: 'step', step, idx: i, nested: isNested });
              i++;
            }
          }

          // Group consecutive items by nested flag for indentation (delegation items render top-level)
          const itemNested = (item: DisplayItem): boolean =>
            item.type === 'delegation' ? false : item.nested;
          type NestGroup = { nested: boolean; items: DisplayItem[] };
          const nestGroups: NestGroup[] = [];
          for (const item of items) {
            const nested = itemNested(item);
            const last = nestGroups[nestGroups.length - 1];
            if (last && last.nested === nested) {
              last.items.push(item);
            } else {
              nestGroups.push({ nested, items: [item] });
            }
          }

          const renderItem = (item: DisplayItem, key: string) => {
            if (item.type === 'tool-group') {
              return (
                <CollapsibleToolGroup
                  key={key}
                  toolName={item.toolName}
                  steps={item.steps}
                  totalSteps={traceSteps.length}
                />
              );
            }
            if (item.type === 'delegation') {
              const lastTraceIdx = item.children.length > 0 ? item.lastChildIdx : item.idx;
              return (
                <DelegationCard
                  key={item.step.id}
                  step={item.step}
                  childSteps={item.children}
                  isLast={lastTraceIdx === traceSteps.length - 1}
                />
              );
            }
            const { step, idx } = item;
            const statusLabelNode = step.kind === 'status' ? (
              <span className="flex items-center gap-1.5">
                <Archive
                  className="h-3 w-3 shrink-0"
                  style={{ color: 'color-mix(in srgb, var(--foreground-muted) 60%, transparent)' }}
                />
                <span>{step.label}</span>
              </span>
            ) : null;
            return (
              <ChainOfThoughtStep
                key={step.id}
                status={step.status}
                isLast={idx === traceSteps.length - 1}
                label={
                  step.status === 'active' ? (
                    <Shimmer as="span" duration={2} spread={3}>{statusLabelNode || step.label}</Shimmer>
                  ) : (statusLabelNode || step.label)
                }
              >
                {(step.kind === 'reasoning' || step.kind === 'text') && step.content ? (
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
                      {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(step.content)))}
                    </ReactMarkdown>
                  </div>
                ) : null}
                {step.kind === 'tool' && step.tool ? (
                  <ToolTraceContent tool={step.tool} />
                ) : null}
                {step.kind === 'status' && step.statusMeta ? (
                  <StatusTraceMeta meta={step.statusMeta} />
                ) : null}
              </ChainOfThoughtStep>
            );
          };

          return nestGroups.map((group, gIdx) => {
            const rendered = group.items.map((item, iIdx) =>
              renderItem(item, `${gIdx}-${iIdx}`)
            );

            if (group.nested) {
              return (
                <div
                  key={`nested-${gIdx}`}
                  className="ml-5 border-l-[1.5px] pl-4 py-1"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--foreground-muted) 18%, transparent)',
                  }}
                >
                  {rendered}
                </div>
              );
            }

            return <React.Fragment key={`group-${gIdx}`}>{rendered}</React.Fragment>;
          });
  }, [traceSteps]);

  if (traceSteps.length === 0) return null;

  const headerLabel = isStreaming
    ? 'Thinking...'
    : reasoningDuration
      ? `Thought for ${formatDuration(reasoningDuration)}`
      : 'Thought';

  return (
    <ChainOfThought
      defaultOpen={Boolean(defaultOpen)}
      className="mb-3 mr-auto w-full max-w-[85%] md:max-w-[60%]"
    >
      <ChainOfThoughtHeader>
        <span className="text-[13px] text-theme-muted">{headerLabel}</span>
      </ChainOfThoughtHeader>

      <ChainOfThoughtContent>
        {renderedTraceTree}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
};
