/**
 * Unified chunk handler for Mastra/AI SDK stream events.
 * Converts raw stream chunks into normalized StreamEvent types.
 */

import type { StreamEvent, StreamState, TrackedToolCall, FinishEvent } from './types';

/**
 * List of internal SIS meta-tools that should be hidden from UI
 */
const SIS_META_TOOLS = new Set([
  'sis_execute_tool',
  'sis_search_tools',
  'sis_list_categories',
  'search_past_conversations',
  'segment_search',
]);

/**
 * Check if a tool should be hidden from UI
 */
export function isSISMetaTool(toolName: string): boolean {
  return SIS_META_TOOLS.has(toolName);
}

/**
 * Parse a raw stream chunk into a normalized StreamEvent.
 * Returns null if the chunk type is not recognized or should be ignored.
 */
export function parseChunk(chunk: unknown): StreamEvent | null {
  if (!chunk || typeof chunk !== 'object') {
    // Handle raw string deltas
    if (typeof chunk === 'string') {
      return { type: 'text-delta', text: chunk };
    }
    return null;
  }

  const c = chunk as Record<string, unknown>;
  const evType = c.type as string | undefined;
  const payload = c.payload as Record<string, unknown> | undefined;

  switch (evType) {
    case 'start':
      return { type: 'start' };

    case 'text-delta': {
      const text = (payload?.text ?? c.text ?? '') as string;
      if (text) {
        return { type: 'text-delta', text };
      }
      return null;
    }

    case 'tool-call': {
      const toolCallId = (payload?.toolCallId ?? payload?.id ?? c.toolCallId ?? c.id ?? `tc-${Date.now()}`) as string;
      const toolName = (payload?.toolName ?? payload?.tool ?? payload?.name ?? c.toolName ?? c.tool ?? c.name ?? 'tool') as string;
      const args = (payload?.args ?? payload?.input ?? c.args ?? c.input ?? {}) as Record<string, unknown>;
      return { type: 'tool-call', toolCallId, toolName, args };
    }

    case 'tool-result': {
      const toolCallId = (payload?.toolCallId ?? payload?.id ?? c.toolCallId ?? c.id ?? '') as string;
      const toolName = (payload?.toolName ?? payload?.tool ?? payload?.name ?? c.toolName ?? c.tool ?? c.name ?? 'tool') as string;
      const result = payload?.result ?? payload?.output ?? c.result ?? c.output;
      return { type: 'tool-result', toolCallId, toolName, result };
    }

    case 'finish': {
      const responseObj = payload?.response as Record<string, unknown> | undefined;
      const text = (payload?.text ?? responseObj?.text ?? c.text ?? '') as string;
      const usage = (payload?.usage ?? c.usage) as FinishEvent['usage'];
      const finishReason = (payload?.finishReason ?? c.finishReason ?? 'unknown') as 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';
      return { type: 'finish', text, usage, finishReason };
    }

    case 'error': {
      const message = (payload?.message ?? c.message ?? 'Unknown error') as string;
      const code = (payload?.code ?? c.code) as string | undefined;
      return { type: 'error', message, code };
    }

    // Reasoning/Thinking events - forward to client
    case 'reasoning-start':
    case 'thinking-start': {
      return { type: 'reasoning-start' as const, id: (payload?.id ?? undefined) as string | undefined };
    }

    case 'reasoning':
    case 'reasoning-delta':
    case 'thinking-delta': {
      const text = (payload?.text ?? c.textDelta ?? payload?.textDelta ?? '') as string;
      if (text) {
        return { type: 'reasoning-delta' as const, text };
      }
      return null;
    }

    case 'reasoning-end':
    case 'thinking-end': {
      return { type: 'reasoning-end' as const, id: (payload?.id ?? undefined) as string | undefined };
    }

    case 'reasoning-signature':
    case 'step-finish':
    case 'step-start':
    case 'response-metadata':
      return null;

    default:
      // Fallback for legacy formats
      return parseLegacyChunk(c);
  }
}

/**
 * Parse legacy/alternative chunk formats
 */
function parseLegacyChunk(c: Record<string, unknown>): StreamEvent | null {
  // Check for text delta in various legacy formats
  let textDelta: string | undefined;
  if (typeof c.textDelta === 'string') {
    textDelta = c.textDelta;
  } else if (typeof c.delta === 'string') {
    textDelta = c.delta;
  } else if (typeof c.text === 'string' && !c.type) {
    textDelta = c.text;
  }

  if (textDelta && textDelta.length > 0) {
    return { type: 'text-delta', text: textDelta };
  }

  // Check for legacy toolCall format
  const toolCall = c.toolCall as Record<string, unknown> | undefined;
  if (toolCall?.name) {
    return {
      type: 'tool-call',
      toolCallId: (toolCall.id ?? `tc-${Date.now()}`) as string,
      toolName: toolCall.name as string,
      args: (toolCall.args ?? {}) as Record<string, unknown>,
    };
  }

  // Check for legacy toolResult format
  const toolResult = c.toolResult as Record<string, unknown> | undefined;
  if (toolResult) {
    return {
      type: 'tool-result',
      toolCallId: (toolResult.toolCallId ?? '') as string,
      toolName: (toolResult.toolName ?? 'tool') as string,
      result: toolResult.result,
    };
  }

  return null;
}

/**
 * Update stream state with a parsed event
 */
export function updateStreamState(state: StreamState, event: StreamEvent): void {
  switch (event.type) {
    case 'text-delta':
      state.text += event.text;
      state.sawTextDelta = true;
      // Append to last text chunk or create new
      const lastChunk = state.chunks[state.chunks.length - 1];
      if (lastChunk?.type === 'text') {
        lastChunk.content += event.text;
      } else {
        state.chunks.push({ type: 'text', content: event.text });
      }
      break;

    case 'reasoning-delta': {
      state.reasoning += event.text;
      // Append to last reasoning chunk or create new
      const lastReasoningChunk = state.chunks[state.chunks.length - 1];
      if (lastReasoningChunk?.type === 'reasoning') {
        lastReasoningChunk.content += event.text;
      } else {
        state.chunks.push({ type: 'reasoning', content: event.text });
      }
      break;
    }

    case 'reasoning-start':
    case 'reasoning-end':
      // No-op for state tracking, these are control signals
      break;

    case 'tool-call': {
      state.sawToolCall = true;
      const toolCall: TrackedToolCall = {
        id: event.toolCallId,
        tool: event.toolName,
        status: 'called',
        args: event.args,
        timestamp: Date.now(),
      };
      state.toolCalls.set(event.toolCallId, toolCall);
      state.chunks.push({ type: 'tool', tool: { ...toolCall } });
      break;
    }

    case 'tool-result': {
      state.sawToolCall = true;
      const existing = state.toolCalls.get(event.toolCallId);
      if (existing) {
        existing.status = event.isError ? 'error' : 'completed';
        existing.result = event.result;
        // Update in chunks
        for (const chunk of state.chunks) {
          if (chunk.type === 'tool' && 'tool' in chunk && chunk.tool.id === event.toolCallId) {
            chunk.tool.status = existing.status;
            chunk.tool.result = event.result;
            break;
          }
        }
      }
      break;
    }

    case 'finish':
      if (event.text && !state.text) {
        state.text = event.text;
      }
      state.finishReason = event.finishReason;
      state.usage = event.usage;
      break;
  }
}
