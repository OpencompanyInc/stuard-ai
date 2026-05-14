import type { WebSocket } from 'ws';

import type { ModelChoice } from '../../router/model-router';
import type { TierChoice } from '../socket/helpers';

export type AgentType = 'stuard' | 'workflow' | 'bot';

export interface AuthUser {
  userId: string;
  email?: string;
}

export type StreamChunkRecord =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool'; tool: any };

export interface PreparedChatRequest {
  ws: WebSocket;
  msg: any;
  requestId?: string;
  messages: any[];
  providedMessages?: any[];
  history: any[];
  prompt: string;
  inputMessages: any[];
  agent: any;
  agentType: AgentType;
  authUser: AuthUser | null;
  requestedMode: TierChoice;
  routedTier: ModelChoice;
  chosenModelId?: string;
  modelSource?: string;
  conversationId: string | null;
  conversationCreatedNow: boolean;
  modelLabel: string;
  workflowModelId?: string;
  contextPathsForMeta?: Array<{ path: string; name: string; isDirectory: boolean }>;
  resource: string;
  thread: string;
  maxSteps: number;
  providerOptions: any;
}
