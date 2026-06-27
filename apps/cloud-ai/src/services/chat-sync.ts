/**
 * Chat Sync Service
 *
 * Relays chat events (new messages, title updates) between VM and desktop.
 * Delivers immediately when the target is online, or queues to GCS for
 * later delivery when the target reconnects.
 *
 * Storage: chat-sync-queue/<userId>/<target>/<sortKey>.json
 *   - sortKey = `${ts}-${nonce}` so list order = creation order
 *   - target = 'desktop' | 'vm' lets us list only events for one direction
 *   - Bucket lifecycle policy enforces the 7-day TTL
 *
 * Security:
 *  - All operations require a verified userId (from JWT or HMAC auth)
 *  - Source (vm/desktop) is derived from auth method, never client-controlled
 *  - Object names are namespaced under {userId}/ so listing can't cross users
 *  - Payload content is truncated to prevent queue flooding
 */

import { WebSocket } from 'ws';
import { Storage } from '@google-cloud/storage';
import { CLOUD_ENGINE_BUCKET, GCP_KEY_FILE } from '../utils/config';
import { writeLog } from '../utils/logger';
import { getDesktopWs } from './vm-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max content size per event (chars). Prevents queue abuse. */
const MAX_CONTENT_LENGTH = 50_000;
/** Max title length (chars). */
const MAX_TITLE_LENGTH = 200;
/** Max queued events per user/target to prevent unbounded growth. */
const MAX_PENDING_EVENTS = 200;
/** GCS prefix for queued events. */
const QUEUE_PREFIX = 'chat-sync-queue';

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
// GCS client (lazy)
// ─────────────────────────────────────────────────────────────────────────────

let _storage: Storage | null = null;
function getBucket() {
  if (!_storage) {
    _storage = GCP_KEY_FILE
      ? new Storage({ keyFilename: GCP_KEY_FILE })
      : new Storage();
  }
  return _storage.bucket(CLOUD_ENGINE_BUCKET);
}

function queuePrefix(userId: string, target: 'desktop' | 'vm'): string {
  return `${QUEUE_PREFIX}/${userId}/${target}/`;
}

function buildObjectName(userId: string, target: 'desktop' | 'vm'): string {
  // ts is zero-padded to 13 chars so lexicographic sort = chronological sort
  // until year 2286. nonce breaks ties when two events land in the same ms.
  const ts = String(Date.now()).padStart(13, '0');
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${queuePrefix(userId, target)}${ts}-${nonce}.json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitization — strip unknown fields, enforce size limits
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeEvent(event: ChatSyncEvent): ChatSyncEvent {
  const data = { ...event.data };

  if (typeof data.content === 'string' && data.content.length > MAX_CONTENT_LENGTH) {
    data.content = data.content.slice(0, MAX_CONTENT_LENGTH) + '…[truncated]';
  }
  if (typeof data.title === 'string') {
    data.title = data.title.slice(0, MAX_TITLE_LENGTH);
  }

  if (data.metadata) {
    data.metadata = {
      tier: data.metadata.tier,
      modelId: data.metadata.modelId,
    };
  }

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
// Queue Operations (GCS)
// ─────────────────────────────────────────────────────────────────────────────

async function queueChatSyncEvent(
  userId: string,
  target: 'desktop' | 'vm',
  event: ChatSyncEvent,
): Promise<boolean> {
  try {
    const bucket = getBucket();

    // Cap queue depth — list one extra past the limit, drop event if over.
    // Cheaper than counting all objects; we just need to know "is it full?"
    const [files] = await bucket.getFiles({
      prefix: queuePrefix(userId, target),
      maxResults: MAX_PENDING_EVENTS + 1,
    });
    if (files.length >= MAX_PENDING_EVENTS) {
      writeLog('chat_sync_queue_full', { userId, target, count: files.length });
      return false;
    }

    const objectName = buildObjectName(userId, target);
    await bucket.file(objectName).save(JSON.stringify(event), {
      contentType: 'application/json',
      resumable: false,
      metadata: {
        metadata: {
          userId,
          target,
          action: event.action,
          conversationId: event.conversationId,
        },
      },
    });
    return true;
  } catch (e: any) {
    writeLog('chat_sync_queue_error', { userId, target, error: e?.message });
    return false;
  }
}

async function getPendingChatEvents(
  userId: string,
  target: 'desktop' | 'vm',
  limit = 100,
): Promise<Array<{ name: string; payload: ChatSyncEvent }>> {
  try {
    const bucket = getBucket();
    const [files] = await bucket.getFiles({
      prefix: queuePrefix(userId, target),
      maxResults: limit,
    });

    // Lexicographic sort = chronological because object names start with a
    // zero-padded ms timestamp.
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const out: Array<{ name: string; payload: ChatSyncEvent }> = [];
    for (const file of files) {
      try {
        const [buf] = await file.download();
        const payload = JSON.parse(buf.toString('utf8')) as ChatSyncEvent;
        out.push({ name: file.name, payload });
      } catch {
        // Corrupt object — delete so it doesn't block subsequent drains.
        await file.delete({ ignoreNotFound: true }).catch(() => {});
      }
    }
    return out;
  } catch (e: any) {
    writeLog('chat_sync_list_error', { userId, target, error: e?.message });
    return [];
  }
}

async function deleteQueuedEvent(objectName: string): Promise<void> {
  try {
    await getBucket().file(objectName).delete({ ignoreNotFound: true });
  } catch {
    // Best-effort — a stale object will be retried on next drain and the
    // duplicate-detection on the desktop/VM side handles repeats.
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
    const queued = await queueChatSyncEvent(userId, 'desktop', safe);
    if (queued) {
      writeLog('chat_sync_queued', { userId, action: safe.action, target: 'desktop' });
    }
  } else {
    // Desktop produced this → deliver to VM (if running)
    try {
      const { getCloudEngine } = await import('../supabase');
      const engine = await getCloudEngine(userId);
      if (!engine || engine.status !== 'running') {
        // No VM running — queue so the next-running VM can pick it up.
        const queued = await queueChatSyncEvent(userId, 'vm', safe);
        if (queued) {
          writeLog('chat_sync_queued', { userId, action: safe.action, target: 'vm' });
        }
        return;
      }
      const { sendVMCommand } = await import('./vm-command');
      await sendVMCommand(userId, 'chat_sync', safe, 15_000);
      writeLog('chat_sync_delivered', { userId, action: safe.action, target: 'vm' });
    } catch (e: any) {
      // VM delivery failed — queue for retry on next VM interaction.
      const queued = await queueChatSyncEvent(userId, 'vm', safe).catch(() => false);
      if (queued) {
        writeLog('chat_sync_queued_after_failure', { userId, action: safe.action, target: 'vm', error: e?.message });
      } else {
        console.warn('[chat-sync] VM delivery + queue both failed:', e?.message);
      }
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
      await deleteQueuedEvent(item.name);
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

/**
 * Deliver queued desktop→VM events to a freshly-running VM.
 * Called by cloud-engine after the VM transitions to `running`.
 *
 * Returns the number of events successfully relayed.
 */
export async function deliverQueuedVMChatEvents(userId: string): Promise<number> {
  const pending = await getPendingChatEvents(userId, 'vm');
  if (pending.length === 0) return 0;

  let delivered = 0;
  let sendVMCommand: typeof import('./vm-command').sendVMCommand;
  try {
    ({ sendVMCommand } = await import('./vm-command'));
  } catch {
    return 0;
  }

  for (const item of pending) {
    try {
      const result = await sendVMCommand(userId, 'chat_sync', item.payload, 15_000);
      if (result?.ok !== false) {
        await deleteQueuedEvent(item.name);
        delivered++;
      } else {
        // VM rejected — leave in queue, stop draining (likely transient).
        break;
      }
    } catch {
      // Transport failure — leave for next attempt.
      break;
    }
  }

  if (delivered > 0) {
    writeLog('queued_vm_chat_events_delivered', { userId, count: delivered });
  }
  return delivered;
}
