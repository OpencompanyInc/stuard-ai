import type { ChatAttachment } from './attachments';

export interface ContextPath {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface ToolCall {
  id: string;
  tool: string;
  status: 'called' | 'running' | 'completed' | 'error';
  args?: any;
  result?: any;
  error?: any;
  timestamp: number;
  description?: string;
  liveOutput?: string;
  subagentId?: string;
  nested?: boolean;
  /**
   * Id of the parent tool call this step ran under, when it is a child of a
   * grouping tool (`delegate`, `run_parallel`, `run_sequential`, `loop_executor`).
   * Lets the trace renderer reconstruct the parent→children rectangle
   * deterministically — survives chat reopen because the link is explicit and
   * order-independent, unlike positional absorption.
   */
  parentToolId?: string;
}

export type StreamChunk =
  | { type: 'text'; content: string; nested?: boolean; subagentId?: string }
  | { type: 'reasoning'; content: string; nested?: boolean; subagentId?: string }
  | { type: 'tool'; tool: ToolCall }
  | {
      type: 'status';
      id: string;
      variant: 'compacting';
      label: string;
      state: 'active' | 'complete';
      nested?: boolean;
      subagentId?: string;
      meta?: {
        round?: number;
        maxRounds?: number;
        tokensBefore?: number;
        tokensAfter?: number;
      };
    };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  reasoningDuration?: number;
  toolCalls?: ToolCall[];
  streamChunks?: StreamChunk[];
  timestamp?: number;
  contextPaths?: ContextPath[];
  attachments?: ChatAttachment[];
  modifiedFiles?: string[];
  checkpointId?: string;
  reverted?: boolean;
  aborted?: boolean;
}

export interface ProgressEvent {
  event: string;
  data: any;
}
