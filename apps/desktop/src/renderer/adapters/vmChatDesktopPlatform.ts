import type { Message as ChatMessage } from '@stuardai/chat-ui/types';
import type { CloudClient } from '@stuardai/cloud-client';
import type { IVmChatPlatform, VmConversationEntry } from '@stuardai/vm-chat/types';
import { displayConversationTitle, isPlaceholderConversationTitle } from '@stuardai/chat-ui';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (
  (window as unknown as { __CLOUD_AI_HTTP__?: string }).__CLOUD_AI_HTTP__
  || (import.meta as { env?: { VITE_CLOUD_AI_URL?: string } }).env?.VITE_CLOUD_AI_URL
  || 'http://127.0.0.1:8082'
).replace(/\/+$/, '');

function isMainChatConversation(raw: { source?: string }): boolean {
  const source = String(raw?.source || '').trim().toLowerCase();
  return !['workflow', 'skill', 'proactive', 'bot'].includes(source);
}

async function vmRelay(
  client: CloudClient,
  path: string,
  body?: unknown,
  method = 'POST',
  options?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  try {
    return (await client.vmRelay({
      path,
      method: method as 'POST' | 'GET' | 'DELETE' | 'PUT',
      body,
      timeoutMs: options?.timeoutMs,
    })) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'relay_failed' };
  }
}

export function createDesktopVmChatPlatform(client: CloudClient): IVmChatPlatform {
  return {
    async getAccessToken() {
      try {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token || '';
      } catch {
        return '';
      }
    },

    uploadFileToVm: (targetPath, file) => client.uploadFileToVm(targetPath, file),

    async checkReady() {
      try {
        const res = await client.getVMStatus();
        // Ready means the Python agent (LLM brain) is connected, not just that
        // the VM's HTTP server answers — otherwise a chat streams back empty
        // ("No response"). Fall back to `reachable` for older backends that
        // don't report agentReady.
        const r = res as { reachable?: boolean; agentReady?: boolean };
        const ready = r.agentReady ?? r.reachable;
        return !!(res?.ok && ready);
      } catch {
        return false;
      }
    },

    openChatStream: (options) => client.openVMAgentChatStream(options),

    async sendToolResult(toolId, result) {
      try {
        await vmRelay(client, '/command', {
          command: 'tool_result',
          args: { id: toolId, result },
        });
      } catch { /* best-effort */ }
    },

    async fetchConversations(limit) {
      const token = await this.getAccessToken();
      const [vmRes, cloudRes, supaRes] = await Promise.all([
        vmRelay(client, '/memory/conversations_list', { limit }, 'POST', { timeoutMs: 4_000 }).catch(() => null),
        fetch(`${CLOUD_AI_HTTP}/v1/memory/conversations?limit=${limit}&status=active`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then((r) => r.json())
          .catch(() => null),
        (async () => {
          try {
            return await supabase
              .from('conversations')
              .select('id, title, created_at, updated_at, message_count, source')
              .not('source', 'in', '("workflow","skill","proactive","bot")')
              .order('updated_at', { ascending: false })
              .limit(limit);
          } catch {
            return null;
          }
        })(),
      ]);

      const sources: Array<Array<Record<string, unknown>>> = [];
      const vmList =
        (vmRes as { result?: { result?: { conversations?: unknown[] }; conversations?: unknown[] } })?.result?.result?.conversations
        || (vmRes as { result?: { conversations?: unknown[] } })?.result?.conversations
        || (vmRes as { conversations?: unknown[] })?.conversations;
      if (Array.isArray(vmList)) sources.push(vmList as Array<Record<string, unknown>>);
      if ((cloudRes as { ok?: boolean; conversations?: unknown[] })?.ok && Array.isArray((cloudRes as { conversations?: unknown[] }).conversations)) {
        sources.push((cloudRes as { conversations: Array<Record<string, unknown>> }).conversations);
      }
      if (supaRes && !(supaRes as { error?: unknown }).error && Array.isArray((supaRes as { data?: unknown[] }).data)) {
        sources.push((supaRes as { data: Array<Record<string, unknown>> }).data);
      }

      const byId = new Map<string, VmConversationEntry>();
      for (const list of sources) {
        for (const c of list) {
          if (!c || !isMainChatConversation(c as { source?: string })) continue;
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
      let rawMsgs: Array<Record<string, unknown>> = [];
      let loadError: string | undefined;

      try {
        const res = await vmRelay(
          client,
          '/memory/messages_list',
          { conversation_id: conversationId, limit },
          'POST',
          { timeoutMs: 8_000 },
        );
        const extracted =
          (res?.result as { result?: { messages?: unknown[] }; messages?: unknown[] })?.result?.messages
          || (res?.result as { messages?: unknown[] })?.messages
          || (res?.messages as unknown[])
          || [];
        rawMsgs = Array.isArray(extracted)
          ? extracted.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
          : [];

        if (rawMsgs.length === 0) {
          const token = await this.getAccessToken();
          const resp = await fetch(
            `${CLOUD_AI_HTTP}/v1/memory/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} },
          );
          const d = await resp.json();
          if (d.ok && Array.isArray(d.messages)) rawMsgs = d.messages;
        }

        if (rawMsgs.length === 0) {
          const { data, error } = await supabase
            .from('messages')
            .select('role, content, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(limit);
          if (!error && Array.isArray(data)) {
            rawMsgs = data as Array<Record<string, unknown>>;
          }
        }
      } catch (err: unknown) {
        loadError = (err as Error)?.message || 'Failed to load conversation';
      }

      if (rawMsgs.length > 0) {
        const messages: ChatMessage[] = rawMsgs.map((m, i) => ({
          id: `${conversationId}-${i}`,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          text: String(m.content || m.text || ''),
          timestamp: m.created_at ? new Date(String(m.created_at)).getTime() : Date.now() - (rawMsgs.length - i) * 1000,
        }));
        return { messages };
      }

      return {
        messages: [
          {
            id: `${conversationId}-empty`,
            role: 'assistant',
            text: loadError
              ? `Couldn't load this conversation: ${loadError}`
              : 'No messages stored locally for this chat yet. Start typing to continue it — the history will sync from the desktop in the background.',
            timestamp: Date.now(),
          },
        ],
        error: loadError,
      };
    },

    async getDisplayName() {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        const rawName =
          user?.user_metadata?.full_name
          || user?.user_metadata?.name
          || user?.email?.split('@')[0]
          || 'there';
        return String(rawName).split(/\s+/)[0] || 'there';
      } catch {
        return 'there';
      }
    },
  };
}
