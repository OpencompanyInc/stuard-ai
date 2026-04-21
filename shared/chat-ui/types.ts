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
}

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string; nested?: boolean }
  | { type: 'tool'; tool: ToolCall };

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
