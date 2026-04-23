import { mergeStreamingText } from './streamMerge';
import type { StreamChunk, ToolCall } from './types';

function isPendingToolStatus(status: ToolCall['status']): boolean {
  return status === 'called' || status === 'running';
}

function toolMatches(existing: ToolCall, incoming: ToolCall): boolean {
  if (existing.id && incoming.id) return existing.id === incoming.id;
  if (existing.tool !== incoming.tool) return false;
  if ((existing.subagentId || '') !== (incoming.subagentId || '')) return false;

  if (isPendingToolStatus(existing.status)) {
    return true;
  }

  return existing.status === incoming.status;
}

function mergeToolCall(existing: ToolCall, incoming: ToolCall): ToolCall {
  return {
    ...existing,
    ...incoming,
    id: incoming.id || existing.id,
    timestamp: incoming.timestamp || existing.timestamp || Date.now(),
    args: incoming.args ?? existing.args,
    result: incoming.result ?? existing.result,
    error: incoming.error ?? existing.error,
    description: incoming.description ?? existing.description,
    subagentId: incoming.subagentId ?? existing.subagentId,
    nested: incoming.nested ?? existing.nested,
    liveOutput: incoming.liveOutput
      ? mergeStreamingText(existing.liveOutput || '', incoming.liveOutput)
      : existing.liveOutput,
  };
}

export function appendTextChunk(chunks: StreamChunk[], content: string): StreamChunk[] {
  if (!content) return chunks;

  const next = [...chunks];
  const last = next[next.length - 1];

  if (last?.type === 'text') {
    next[next.length - 1] = {
      type: 'text',
      content: mergeStreamingText(last.content, content),
    };
    return next;
  }

  next.push({ type: 'text', content });
  return next;
}

export function appendReasoningChunk(chunks: StreamChunk[], content: string, nested = false): StreamChunk[] {
  if (!content) return chunks;

  const next = [...chunks];
  const last = next[next.length - 1];

  if (last?.type === 'reasoning' && Boolean(last.nested) === Boolean(nested)) {
    next[next.length - 1] = {
      type: 'reasoning',
      content: mergeStreamingText(last.content, content),
      nested,
    };
    return next;
  }

  next.push({ type: 'reasoning', content, nested });
  return next;
}

export function upsertStatusChunk(
  chunks: StreamChunk[],
  incoming: Extract<StreamChunk, { type: 'status' }>,
): StreamChunk[] {
  const next = [...chunks];
  const index = next.findIndex(
    (chunk) => chunk.type === 'status' && chunk.id === incoming.id,
  );

  if (index >= 0) {
    const existing = next[index];
    if (existing.type === 'status') {
      next[index] = {
        ...existing,
        ...incoming,
        meta: { ...existing.meta, ...incoming.meta },
      };
    }
    return next;
  }

  next.push(incoming);
  return next;
}

export function upsertToolCall(toolCalls: ToolCall[], incoming: ToolCall): ToolCall[] {
  const next = [...toolCalls];
  const index = next.findIndex((tool) => toolMatches(tool, incoming));

  if (index >= 0) {
    next[index] = mergeToolCall(next[index], incoming);
    return next;
  }

  next.push({
    ...incoming,
    timestamp: incoming.timestamp || Date.now(),
  });
  return next;
}

export function upsertToolChunk(chunks: StreamChunk[], tool: ToolCall): StreamChunk[] {
  const next = [...chunks];
  const index = next.findIndex((chunk) => chunk.type === 'tool' && toolMatches(chunk.tool, tool));

  if (index >= 0) {
    const existing = next[index];
    if (existing.type === 'tool') {
      next[index] = {
        type: 'tool',
        tool: mergeToolCall(existing.tool, tool),
      };
    }
    return next;
  }

  next.push({ type: 'tool', tool: { ...tool, timestamp: tool.timestamp || Date.now() } });
  return next;
}

export function applyToolCallUpdate(
  toolCalls: ToolCall[],
  streamChunks: StreamChunk[],
  incoming: ToolCall,
): { toolCalls: ToolCall[]; streamChunks: StreamChunk[] } {
  const nextToolCalls = upsertToolCall(toolCalls, incoming);
  const mergedTool = nextToolCalls[nextToolCalls.findIndex((tool) => toolMatches(tool, incoming))] || incoming;

  return {
    toolCalls: nextToolCalls,
    streamChunks: upsertToolChunk(streamChunks, mergedTool),
  };
}