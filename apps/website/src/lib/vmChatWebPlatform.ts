import type { Message as ChatMessage } from '@stuardai/chat-ui/types';
import type { IVmChatPlatform, VmConversationEntry } from '@stuardai/vm-chat/types';
import { displayConversationTitle, isPlaceholderConversationTitle } from '@stuardai/chat-ui';
import {
  getCloudConversationMessages,
  getCloudConversations,
  getVMStatus,
  openVMAgentChatStream,
  sendVmToolResult,
  uploadFileToVm,
  vmRelay,
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
      // Query the VM relay (local memory.db — has the real titles) alongside the
      // cloud mirror. The Supabase mirror deliberately stores no conversation
      // titles, so on its own every entry resolves to the "New chat" fallback.
      const [vmRes, cloudRes] = await Promise.all([
        vmRelay({ path: '/memory/conversations_list', method: 'POST', body: { limit }, timeoutMs: 4_000 }).catch(() => null),
        getCloudConversations(limit).catch(() => null),
      ]);

      const sources: Array<Array<Record<string, unknown>>> = [];
      const vmList =
        (vmRes as { result?: { result?: { conversations?: unknown[] }; conversations?: unknown[] } })?.result?.result?.conversations
        || (vmRes as { result?: { conversations?: unknown[] } })?.result?.conversations
        || (vmRes as { conversations?: unknown[] })?.conversations;
      if (Array.isArray(vmList)) sources.push(vmList as Array<Record<string, unknown>>);
      const cloudData = cloudRes as { ok?: boolean; conversations?: unknown[] } | null;
      if (cloudData?.ok && Array.isArray(cloudData.conversations)) {
        sources.push(cloudData.conversations as Array<Record<string, unknown>>);
      }

      const byId = new Map<string, VmConversationEntry>();
      for (const list of sources) {
        for (const c of list) {
          if (!c) continue;
          const id = String(c.id || c.conversation_id || '');
          if (!id) continue;
          const entry: VmConversationEntry = {
            id,
            title: displayConversationTitle(c.title),
            updated_at: String(c.updated_at || c.created_at || ''),
            message_count: Number(c.message_count) || 0,
          };
          const existing = byId.get(id);
          if (!existing) {
            byId.set(id, entry);
            continue;
          }
          // Prefer a real title and the freshest metadata when merging sources.
          byId.set(id, {
            id,
            title: !isPlaceholderConversationTitle(entry.title)
              ? entry.title
              : displayConversationTitle(existing.title),
            updated_at:
              new Date(entry.updated_at || 0) > new Date(existing.updated_at || 0)
                ? entry.updated_at
                : existing.updated_at,
            message_count: Math.max(existing.message_count, entry.message_count),
          });
        }
      }

      return Array.from(byId.values())
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
        .slice(0, limit);
    },

    async loadConversationMessages(conversationId, limit = 100) {
      // Prefer the VM's local memory.db (real message bodies) — the Supabase
      // mirror stores metadata only, so the REST endpoint comes back empty for
      // most conversations.
      let rawMsgs: Array<Record<string, unknown>> = [];
      let loadError: string | undefined;

      const vmRes = await vmRelay({
        path: '/memory/messages_list',
        method: 'POST',
        body: { conversation_id: conversationId, limit },
        timeoutMs: 8_000,
      }).catch(() => null);
      const vmMsgs =
        (vmRes as { result?: { result?: { messages?: unknown[] }; messages?: unknown[] } })?.result?.result?.messages
        || (vmRes as { result?: { messages?: unknown[] } })?.result?.messages
        || (vmRes as { messages?: unknown[] })?.messages;
      if (Array.isArray(vmMsgs)) {
        rawMsgs = vmMsgs.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object');
      }

      if (rawMsgs.length === 0) {
        const res = await getCloudConversationMessages(conversationId, limit);
        if (res.ok && Array.isArray(res.messages)) {
          rawMsgs = res.messages as Array<Record<string, unknown>>;
        } else {
          loadError = res.error as string | undefined;
        }
      }

      if (rawMsgs.length === 0) {
        return { messages: [], error: loadError };
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
