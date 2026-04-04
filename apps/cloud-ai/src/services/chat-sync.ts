/**
 * Chat Sync Service
 *
 * Relays chat events (new messages, title updates) between VM and desktop.
 * Delivers immediately when the target is online, or queues to Supabase
 * for later delivery when the target reconnects.
 *
 * Security:
 *  - All operations require a verified userId (from JWT or HMAC auth)
 *  - Source (vm/desktop) is derived from auth method, never client-controlled
 *  - Supabase RLS restricts queue access to the owning user
 *  - Payload content is truncated to prevent queue flooding
 *  - Queue entries auto-expire after 7 days
 *
 * Queue drain happens when:
 *  - Desktop: first authenticated chat message triggers deliverQueuedChatEvents
 *  - VM: receives queued events via sendVMCommand on next interaction
 */

import { WebSocket } from 'ws';
import { getSupabaseService } from '../supabase';
import { writeLog } from '../utils/logger';
import { getDesktopWs } from './vm-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max content size per event (chars). Prevents queue abuse. */
const MAX_CONTENT_LENGTH = 50_000;
/** Max title length (chars). */
const MAX_TITLE_LENGTH = 200;
/** Max queued events per user to prevent unbounded growth. */
const MAX_PENDING_EVENTS = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatSyncEvent {
  type: 'chat_sync';
  action: 'new_message' | 'new_conversation' | 'title_update';
  conversationId: string;
  source: 'desktop' | 'vm';
  data: {
    role?: 'user' | 'assistant';
    content?: string;
    title?: string;
    model?: string;
    metadata?: any;
  };
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitization — strip unknown fields, enforce size limits
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeEvent(event: ChatSyncEvent): ChatSyncEvent {
  const data = { ...event.data };

  // Truncate content to prevent oversized payloads
  if (typeof data.content === 'string' && data.content.length > MAX_CONTENT_LENGTH) {
    data.content = data.content.slice(0, MAX_CONTENT_LENGTH) + '…[truncated]';
  }
  if (typeof data.title === 'string') {
    data.title = data.title.slice(0, MAX_TITLE_LENGTH);
  }

  // Strip metadata to only known-safe fields (prevent sensitive data leaking)
  if (data.metadata) {
    data.metadata = {
      tier: data.metadata.tier,
      modelId: data.metadata.modelId,
    };
  }

  // Only allow known roles
  if (data.role && data.role !== 'user' && data.role !== 'assistant') {
    data.role = 'assistant';
  }

  return {
    type: 'chat_sync',
    action: event.action,
    conversationId: String(event.conversationId || ''),
    source: event.source === 'vm' ? 'vm' : 'desktop',
    data,
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Operations (Supabase)
// ─────────────────────────────────────────────────────────────────────────────

async function queueChatSyncEvent(
  userId: string,
  target: 'desktop' | 'vm',
  event: ChatSyncEvent,
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;

  try {
    // Check queue depth to prevent abuse
    const { count, error: countErr } = await supabase
      .from('chat_sync_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (!countErr && (count ?? 0) >= MAX_PENDING_EVENTS) {
      writeLog('chat_sync_queue_full', { userId, target, count });
      return false;
    }

    const { error } = await supabase.from('chat_sync_queue').insert({
      user_id: userId,
      conversation_id: event.conversationId,
      event_type: event.action,
      source: event.source,
      target,
      payload: event,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

async function getPendingChatEvents(
  userId: string,
  target: 'desktop' | 'vm',
  limit = 100,
): Promise<Array<{ id: string; payload: ChatSyncEvent; created_at: string }>> {
  const supabase = getSupabaseService();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('chat_sync_queue')
      .select('id, payload, created_at')
      .eq('user_id', userId)
      .eq('target', target)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !data) return [];
    return data as any;
  } catch {
    return [];
  }
}

async function markChatEventDelivered(queueId: string): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('chat_sync_queue')
      .update({ status: 'delivered' })
      .eq('id', queueId);
    return !error;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relay (immediate delivery + fallback queue)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Relay a chat event to the other side (VM→desktop or desktop→VM).
 * Tries immediate delivery; queues if the target is offline.
 * Fire-and-forget — safe to call without awaiting.
 *
 * @param userId  - Verified user ID from auth (never client-supplied)
 * @param event   - Chat sync event (sanitized before relay)
 */
export async function relayChatEvent(userId: string, event: ChatSyncEvent): Promise<void> {
  // Sanitize before any relay or storage
  const safe = sanitizeEvent(event);

  if (safe.source === 'vm') {
    // VM produced this → deliver to desktop
    const desktopWs = getDesktopWs(userId);
    if (desktopWs) {
      try {
        desktopWs.send(JSON.stringify(safe));
        writeLog('chat_sync_delivered', { userId, action: safe.action, target: 'desktop' });
        return;
      } catch { /* fall through to queue */ }
    }
    // Desktop offline → queue for later
    const queued = await queueChatSyncEvent(userId, 'desktop', safe);
    if (queued) {
      writeLog('chat_sync_queued', { userId, action: safe.action, target: 'desktop' });
    }
  } else {
    // Desktop produced this → deliver to VM (if running)
    try {
      const { getCloudEngine } = await import('../supabase');
      const engine = await getCloudEngine(userId);
      if (!engine || engine.status !== 'running') return; // No VM running, nothing to sync
      const { sendVMCommand } = await import('./vm-command');
      await sendVMCommand(userId, 'chat_sync', safe, 15_000);
      writeLog('chat_sync_delivered', { userId, action: safe.action, target: 'vm' });
    } catch (e: any) {
      // VM delivery failure is non-critical — VM will fetch from Supabase on next load
      console.warn('[chat-sync] VM delivery failed:', e?.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Drain (on reconnect)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliver all queued chat events to a desktop client when it reconnects.
 * Called after the first authenticated chat message.
 *
 * @param userId - Verified user ID (from JWT auth — never client-supplied)
 * @param ws     - Authenticated desktop WebSocket
 */
export async function deliverQueuedChatEvents(userId: string, ws: WebSocket): Promise<number> {
  const pending = await getPendingChatEvents(userId, 'desktop');
  let delivered = 0;

  for (const item of pending) {
    if (ws.readyState !== WebSocket.OPEN) break;

    try {
      ws.send(JSON.stringify(item.payload));
      await markChatEventDelivered(item.id);
      delivered++;
    } catch {
      break;
    }
  }

  if (delivered > 0) {
    writeLog('queued_chat_events_delivered', { userId, count: delivered });
  }

  return delivered;
}
