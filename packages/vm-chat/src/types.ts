import type React from 'react';
import type { Message as ChatMessage } from '@stuardai/chat-ui/types';
import type { VmChatAttachment } from '@stuardai/cloud-client/types';

export interface VmConversationEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export type VmChatMessageRendererProps = {
  role: 'assistant' | 'user';
  text: string;
  reasoning?: string;
  reasoningDuration?: number;
  toolCalls?: unknown;
  streamChunks?: unknown;
  attachments?: unknown;
  isStreaming?: boolean;
  onSubmitToolOutput?: (id: string, result: unknown) => void;
  onGenUIResponse?: (id: string, result: unknown) => void;
};

export type VmChatModelMeta = {
  id: string;
  name: string;
  provider?: string;
  category?: string;
  isReasoning?: boolean;
  logoUrl?: string;
  providerId?: string;
};

export type VmChatModelLogoProps = {
  src?: string;
  alt?: string;
  providerId?: string;
  className?: string;
};

export interface IVmChatPlatform {
  getAccessToken(): Promise<string>;
  uploadFileToVm(
    targetPath: string,
    file: File,
  ): Promise<{ ok: boolean; error?: string; path?: string; size?: number }>;
  openChatStream(options: {
    message: string;
    conversationId?: string;
    model: string;
    modelId?: string;
    attachments?: VmChatAttachment[];
    contextPaths?: Array<{ path: string; name: string; isDirectory: boolean }>;
    signal?: AbortSignal;
  }): Promise<Response>;
  sendToolResult(toolId: string, result: unknown): Promise<void>;
  fetchConversations(limit: number): Promise<VmConversationEntry[]>;
  loadConversationMessages(
    conversationId: string,
    limit?: number,
  ): Promise<{ messages: ChatMessage[]; error?: string }>;
  getDisplayName?(): Promise<string>;
}

export interface VmChatProps {
  engine: { status?: string; instance_name?: string };
  platform: IVmChatPlatform;
  /** Required unless renderInteractiveTool is provided (portable bubble renderer is used). */
  MessageRenderer?: React.ComponentType<VmChatMessageRendererProps>;
  ModelLogo?: React.ComponentType<VmChatModelLogoProps>;
  models: VmChatModelMeta[];
  modelById: Map<string, VmChatModelMeta>;
  className?: string;
  variant?: 'default' | 'workspace';
  /** Optional slot for website-specific interactive tools (chat_ui, etc.). */
  renderInteractiveTool?: (tool: { id: string; tool: string; status?: string; args?: unknown }, key: string) => React.ReactNode | null;
}
