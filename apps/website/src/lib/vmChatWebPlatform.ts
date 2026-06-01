import type { Message as ChatMessage } from '@stuardai/chat-ui/types';
import type { IVmChatPlatform, VmConversationEntry } from '@stuardai/vm-chat/types';
import { displayConversationTitle } from '@stuardai/chat-ui';
import {
  getCloudConversationMessages,
  getCloudConversations,
  getVMStatus,
  openVMAgentChatStream,
  sendVmToolResult,
  uploadFileToVm,
} from '@/lib/cloudApi';

export function createWebVmChatPlatform(): IVmChatPlatform {
  return {
    async getAccessToken() {
      return '';
    },

    uploadFileToVm: (targetPath, file) => uploadFileToVm(targetPath, file),

    async checkReady() {
      try {
        const res = await getVMStatus();
        // Ready means the Python agent (LLM brain) is connected, not just that
        // the VM's HTTP server answers — otherwise a chat streams back empty
        // ("No response"). Fall back to `reachable` for older backends.
        const r = res as { reachable?: boolean; agentReady?: boolean };
        const ready = r.agentReady ?? r.reachable;
        return !!(res?.ok && ready);
      } catch {
        return false;
      }
    },

    openChatStream: (options) =>
      openVMAgentChatStream({
        message: options.message,
        conversationId: options.conversationId,
        model: options.model,
        modelId: options.modelId,
        attachments: options.attachments,
        contextPaths: options.contextPaths,
        signal: options.signal,
      }),

    sendToolResult: (toolId, result) => sendVmToolResult(toolId, result).then(() => undefined),

    async fetchConversations(limit) {
      const res = await getCloudConversations(limit);
      if (!res.ok || !Array.isArray(res.conversations)) return [];
      return (res.conversations as Array<Record<string, unknown>>)
        .filter((c) => c?.id)
        .map((c) => ({
          id: String(c.id),
          title: displayConversationTitle(c.title),
          updated_at: String(c.updated_at || c.created_at || ''),
          message_count: Number(c.message_count) || 0,
        }));
    },

    async loadConversationMessages(conversationId, limit = 100) {
      const res = await getCloudConversationMessages(conversationId, limit);
      const rawMsgs: Array<Record<string, unknown>> =
        res.ok && Array.isArray(res.messages) ? (res.messages as Array<Record<string, unknown>>) : [];
      if (rawMsgs.length === 0) {
        return { messages: [], error: res.error as string | undefined };
      }
      const messages: ChatMessage[] = rawMsgs.map((m, i) => ({
        id: `${conversationId}-${i}`,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: String(m.content || m.text || ''),
        timestamp: m.created_at ? new Date(String(m.created_at)).getTime() : Date.now(),
      }));
      return { messages };
    },
  };
}
