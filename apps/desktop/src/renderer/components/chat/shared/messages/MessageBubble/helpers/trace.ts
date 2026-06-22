import { isRedundantStreamingUpdate, joinReasoningBlocks } from '../../../../../../utils/streamMerge';
import type { ToolCall, StreamChunk } from '../../../../../../hooks/useAgent';
import type { AssistantTraceStepData, TraceStatus } from '../types';
import { isDelegationToolCall } from './delegation';
import { truncatePreviewText } from './payload';

/** True when the text has no letters/digits (e.g. a stray "." reasoning chunk). */
export function isPunctuationOnly(content: string): boolean {
  return !/[\p{L}\p{N}]/u.test(content);
}

export function summarizeReasoningLabel(content: string, fallback: string = 'Planning next moves'): string {
  const plain = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return fallback;

  // Use the first sentence that actually has words — a chunk that begins with
  // stray punctuation (". Click…") must not yield a ". Click" label — then trim
  // any leading symbols so the label always starts on a real word.
  const sentence = (
    plain.split(/[.?!]/).map((s) => s.trim()).find((s) => /[\p{L}\p{N}]/u.test(s)) || plain
  )
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();

  const summary = truncatePreviewText(sentence, 72);
  return summary.split(' ').filter(Boolean).length >= 2 ? summary : fallback;
}

// Fallback label used when a nested subagent reply has no summarizable content
// yet (empty stream, single-token, or symbols-only). Kept distinct so the UI
// still conveys "this came from a subagent" in that rare case.
export const SUBAGENT_REPLY_FALLBACK = 'Subagent reply';

export function getStreamingStepFallback(step: AssistantTraceStepData): string {
  return step.kind === 'text' ? SUBAGENT_REPLY_FALLBACK : 'Planning next moves';
}

export function tryMergeStreamingStep(
  last: AssistantTraceStepData,
  step: AssistantTraceStepData,
): AssistantTraceStepData | null {
  if (last.kind !== step.kind) return null;
  if (step.kind !== 'reasoning' && step.kind !== 'text') return null;
  if (!step.content || !last.content) return null;
  if (Boolean(step.nested) !== Boolean(last.nested)) return null;
  if (step.subagentId !== last.subagentId) return null;

  // Consecutive reasoning/text steps (no visible step between them) are one
  // thinking block — fold them together whether the provider streamed
  // overlapping snapshots or non-overlapping increments. Anything that should
  // stay separate (a tool, a different subagent) is already excluded above.
  const mergedContent = joinReasoningBlocks(last.content, step.content);
  return {
    ...last,
    id: step.id,
    label: summarizeReasoningLabel(mergedContent, getStreamingStepFallback(step)),
    status: step.status === 'active' ? 'active' : last.status,
    content: mergedContent,
    nested: step.nested,
    subagentId: step.subagentId,
    subagentKind: step.subagentKind,
  };
}

export function compactReasoningTraceSteps(steps: AssistantTraceStepData[]): AssistantTraceStepData[] {
  const compacted: AssistantTraceStepData[] = [];

  for (const step of steps) {
    const last = compacted[compacted.length - 1];
    if (last) {
      const merged = tryMergeStreamingStep(last, step);
      if (merged) {
        compacted[compacted.length - 1] = merged;
        continue;
      }
    }

    // Drop a standalone reasoning/text fragment that's pure punctuation (e.g. a
    // lone "." chunk) when it couldn't be folded into a neighbour — on its own
    // it renders as an empty, ugly step.
    if (
      (step.kind === 'reasoning' || step.kind === 'text')
      && step.content
      && isPunctuationOnly(step.content)
    ) {
      continue;
    }

    compacted.push(step);
  }

  return compacted;
}

export function mapTraceStatus(tool: ToolCall, isStreaming?: boolean): TraceStatus {
  if (tool.status === 'error') return 'error';
  if (tool.status === 'running') return 'active';
  if (tool.status === 'called') {
    if (isDelegationToolCall(tool)) return 'active';
    return 'pending';
  }
  if (tool.status === 'completed') {
    // Delegation tools return as soon as the subagent is spawned; while the
    // assistant turn is still streaming, keep the rectangle in the active state.
    if (isStreaming && isDelegationToolCall(tool)) return 'active';
    return 'complete';
  }
  return isStreaming ? 'active' : 'pending';
}

export function isDelegatedToolCall(tool: ToolCall): boolean {
  if (tool.nested) return true;
  if (typeof tool.subagentId === 'string' && tool.subagentId.trim().length > 0) return true;
  if (typeof tool.id !== 'string') return false;
  return (
    tool.id.startsWith('subagent:') ||
    tool.id.startsWith('subagent-') ||
    tool.id.startsWith('sub-tc-')
  );
}

export function isTopLevelDuplicateOfNestedTool(tool: ToolCall, streamChunks?: StreamChunk[]): boolean {
  if (isDelegatedToolCall(tool) || !streamChunks?.length) return false;
  // Match by id first — fast path for the standard case where the orchestrator
  // and subagent share a toolCallId. When ids diverge (AI-SDK toolCallId vs
  // bridge-issued id for the same logical tool), fall back to matching by
  // tool name within close temporal range, so the subagent's tool call doesn't
  // also render in the orchestrator's chain-of-thought outside the rectangle.
  return streamChunks.some((chunk) => {
    if (chunk.type !== 'tool' || !isDelegatedToolCall(chunk.tool)) return false;
    if (tool.id && chunk.tool.id === tool.id) return true;
    if (chunk.tool.tool !== tool.tool) return false;
    const a = typeof tool.timestamp === 'number' ? tool.timestamp : 0;
    const b = typeof chunk.tool.timestamp === 'number' ? chunk.tool.timestamp : 0;
    if (!a || !b) return true; // no timestamps — assume same logical call
    return Math.abs(a - b) < 30_000; // 30s window covers slow bridge round-trips
  });
}

export function isTopLevelDuplicateOfNestedText(
  chunk: Extract<StreamChunk, { type: 'text' }>,
  streamChunks?: StreamChunk[],
): boolean {
  if (chunk.nested || !chunk.content.trim() || !streamChunks?.length) return false;
  return streamChunks.some((candidate) => {
    if (candidate.type !== 'text' || !candidate.nested || !candidate.content.trim()) return false;
    return isRedundantStreamingUpdate(candidate.content, chunk.content)
      || isRedundantStreamingUpdate(chunk.content, candidate.content);
  });
}
