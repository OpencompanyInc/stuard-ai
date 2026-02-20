/**
 * Clean streaming types for agent responses.
 * This module provides a unified interface for handling all stream chunk types.
 */

export type StreamEvent =
  | StartEvent
  | TextDeltaEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | FinishEvent
  | ErrorEvent
  | ProgressEvent;

export interface StartEvent {
  type: 'start';
}

export interface TextDeltaEvent {
  type: 'text-delta';
  text: string;
}

export interface ReasoningStartEvent {
  type: 'reasoning-start';
  id?: string;
}

export interface ReasoningDeltaEvent {
  type: 'reasoning-delta';
  text: string;
}

export interface ReasoningEndEvent {
  type: 'reasoning-end';
  id?: string;
}

export interface ToolCallEvent {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface FinishEvent {
  type: 'finish';
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    thinkingTokens?: number;
    reasoningTokens?: number;
    cachedPromptTokens?: number;
  };
  finishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

export interface ProgressEvent {
  type: 'progress';
  event: string;
  data: Record<string, unknown>;
}

/**
 * Tool call tracking for persistence
 */
export interface TrackedToolCall {
  id: string;
  tool: string;
  status: 'called' | 'completed' | 'error';
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Stream accumulator state
 */
export interface StreamState {
  text: string;
  reasoning: string;
  toolCalls: Map<string, TrackedToolCall>;
  chunks: Array<{ type: 'text' | 'reasoning' | 'tool'; content: string } | { type: 'tool'; tool: TrackedToolCall }>;
  sawTextDelta: boolean;
  sawToolCall: boolean;
  finishReason?: string;
  usage?: FinishEvent['usage'];
}

/**
 * Create an empty stream state
 */
export function createStreamState(): StreamState {
  return {
    text: '',
    reasoning: '',
    toolCalls: new Map(),
    chunks: [],
    sawTextDelta: false,
    sawToolCall: false,
  };
}
