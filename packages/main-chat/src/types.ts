import type React from 'react';
import type { Message as ChatMessage } from '@stuardai/chat-ui/types';
import type { ChatAttachment } from '@stuardai/chat-ui/attachments';

export interface MainChatConversationEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export interface MainChatModelMeta {
  id: string;
  name: string;
  provider?: string;
  category?: string;
  isReasoning?: boolean;
  logoUrl?: string;
  providerId?: string;
}

export interface MainChatStreamPreview {
  text: string;
  reasoning?: string;
  toolCalls: NonNullable<ChatMessage['toolCalls']>;
  streamChunks?: ChatMessage['streamChunks'];
}

export interface IMainChatPlatform {
  resolveWebSocketUrl(): string;
  getAccessToken(): Promise<string | null>;
  fetchConversations(limit: number): Promise<MainChatConversationEntry[]>;
  loadConversationMessages(
    conversationId: string,
    limit?: number,
  ): Promise<{ messages: ChatMessage[]; error?: string }>;
  prepareAttachment?(file: File): Promise<{ attachment: ChatAttachment } | { error: string }>;
}

export interface UseWebAgentOptions {
  platform: IMainChatPlatform;
  model?: string;
  modelId?: string;
}

export interface UseWebAgentResult {
  connected: boolean;
  connecting: boolean;
  loading: boolean;
  streaming: boolean;
  streamPreview: MainChatStreamPreview | null;
  error: string | null;
  messages: ChatMessage[];
  conversations: MainChatConversationEntry[];
  conversationId: string | null;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  stopGeneration: () => void;
  loadConversation: (conversationId: string) => Promise<void>;
  startNewConversation: () => void;
  refreshConversations: () => Promise<void>;
}

export interface MainChatProps {
  platform: IMainChatPlatform;
  models: MainChatModelMeta[];
  modelById: Map<string, MainChatModelMeta>;
  className?: string;
  renderInteractiveTool?: (
    tool: { id: string; tool: string; status?: string; args?: unknown },
    key: string,
  ) => React.ReactNode | null;
}
