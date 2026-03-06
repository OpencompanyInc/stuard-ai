/**
 * Webhook Dispatch System
 * Routes webhook events to workflows via desktop bridge or queue
 */

import { WebSocket } from 'ws';
import { writeLog } from '../utils/logger';
import { queueWebhookDelivery, updateWebhookEvent, getWebhookBySlug, logWebhookEvent } from './core';
import type { Webhook, WebhookEvent } from './core';

// Active client connections by user ID
const activeConnections = new Map<string, Set<WebSocket>>();

/**
 * Register a client connection for webhook delivery.
 * Safe to call multiple times for the same WS — idempotent.
 */
const registeredCloseHandlers = new WeakSet<WebSocket>();

export function registerWebhookClient(userId: string, ws: WebSocket) {
  let connections = activeConnections.get(userId);
  if (!connections) {
    connections = new Set();
    activeConnections.set(userId, connections);
  }
  connections.add(ws);

  // Only add the close handler once per WebSocket to avoid listener accumulation
  if (!registeredCloseHandlers.has(ws)) {
    registeredCloseHandlers.add(ws);
    ws.on('close', () => {
      connections?.delete(ws);
      if (connections?.size === 0) {
        activeConnections.delete(userId);
      }
    });
  }
}

/**
 * Check if user has an active connection
 */
export function hasActiveConnection(userId: string): boolean {
  const connections = activeConnections.get(userId);
  if (!connections || connections.size === 0) return false;

  // Check if any connection is actually open
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      return true;
    }
  }
  return false;
}

/**
 * Get active WebSocket for a user
 */
function getActiveWs(userId: string): WebSocket | null {
  const connections = activeConnections.get(userId);
  if (!connections) return null;

  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      return ws;
    }
  }
  return null;
}

export interface WebhookPayload {
  type: 'webhook_trigger';
  webhook: {
    id: string;
    slug: string;
    name: string;
    type: string;
  };
  event: {
    id: string;
    source: string;
    timestamp: string;
  };
  workflow?: {
    id: string;
    triggerId?: string;
  };
  data: any;
}

/**
 * Dispatch a webhook event to the user's desktop client
 */
export async function dispatchWebhook(
  userId: string,
  webhook: Webhook,
  eventId: string,
  data: any,
  source: string = 'webhook'
): Promise<{ delivered: boolean; queued: boolean }> {
  const payload: WebhookPayload = {
    type: 'webhook_trigger',
    webhook: {
      id: webhook.id,
      slug: webhook.slug,
      name: webhook.name,
      type: webhook.type,
    },
    event: {
      id: eventId,
      source,
      timestamp: new Date().toISOString(),
    },
    data,
  };

  // Add workflow info if configured
  if (webhook.target_workflow_id) {
    payload.workflow = {
      id: webhook.target_workflow_id,
      triggerId: webhook.target_workflow_trigger_id || undefined,
    };
  }

  // Try to deliver immediately
  const ws = getActiveWs(userId);
  if (ws) {
    try {
      ws.send(JSON.stringify(payload));
      writeLog('webhook_delivered', { userId, webhookId: webhook.id, eventId });

      await updateWebhookEvent(eventId, {
        status: 'delivered',
        delivered_to: 'desktop',
        delivered_at: new Date().toISOString(),
      });

      return { delivered: true, queued: false };
    } catch (e: any) {
      writeLog('webhook_delivery_failed', { userId, webhookId: webhook.id, error: e?.message });
    }
  }

  // Queue for later delivery
  writeLog('webhook_queued', { userId, webhookId: webhook.id, eventId });

  await queueWebhookDelivery(userId, webhook.id, eventId, payload);

  await updateWebhookEvent(eventId, {
    status: 'processing',
    delivered_to: 'queued',
  });

  return { delivered: false, queued: true };
}

/**
 * Dispatch a provider webhook (Stripe, Twilio, etc.) to workflows
 */
export async function dispatchProviderWebhook(
  userId: string,
  provider: string,
  eventType: string,
  eventId: string,
  data: any,
  workflowId?: string,
  triggerId?: string
): Promise<{ delivered: boolean; queued: boolean }> {
  const payload = {
    type: 'provider_webhook',
    provider,
    eventType,
    event: {
      id: eventId,
      timestamp: new Date().toISOString(),
    },
    workflow: workflowId ? { id: workflowId, triggerId: triggerId || undefined } : undefined,
    data,
  };

  const ws = getActiveWs(userId);
  if (ws) {
    try {
      ws.send(JSON.stringify(payload));
      writeLog('provider_webhook_delivered', { userId, provider, eventType, eventId });
      return { delivered: true, queued: false };
    } catch (e: any) {
      writeLog('provider_webhook_delivery_failed', { userId, provider, error: e?.message });
    }
  }

  // Queue for later
  await queueWebhookDelivery(userId, null, eventId, payload);
  writeLog('provider_webhook_queued', { userId, provider, eventType, eventId });

  return { delivered: false, queued: true };
}

/**
 * Deliver queued webhooks when a client connects
 */
export async function deliverQueuedWebhooks(userId: string, ws: WebSocket): Promise<number> {
  const { getPendingDeliveries, markDelivered } = await import('./core');

  const pending = await getPendingDeliveries(userId);
  let delivered = 0;

  for (const item of pending) {
    if (ws.readyState !== WebSocket.OPEN) break;

    try {
      ws.send(JSON.stringify(item.payload));
      await markDelivered(item.id);
      delivered++;
    } catch {
      break;
    }
  }

  if (delivered > 0) {
    writeLog('queued_webhooks_delivered', { userId, count: delivered });
  }

  return delivered;
}

/**
 * Process an incoming webhook request and dispatch to the user
 */
export async function processIncomingWebhook(
  slug: string,
  body: any,
  rawBody: string,
  headers: Record<string, string>,
  queryParams: Record<string, string>,
  sourceIp?: string,
  signature?: string
): Promise<{
  ok: boolean;
  webhook?: Webhook;
  eventId?: string;
  delivered?: boolean;
  queued?: boolean;
  error?: string;
}> {
  // Find the webhook by slug
  const webhook = await getWebhookBySlug(slug);

  if (!webhook) {
    writeLog('webhook_not_found', { slug });
    return { ok: false, error: 'webhook_not_found' };
  }

  if (!webhook.is_active) {
    writeLog('webhook_inactive', { slug, webhookId: webhook.id });
    return { ok: false, error: 'webhook_inactive' };
  }

  // Check IP whitelist
  if (webhook.allowed_ips && webhook.allowed_ips.length > 0 && sourceIp) {
    if (!webhook.allowed_ips.includes(sourceIp)) {
      writeLog('webhook_ip_rejected', { slug, sourceIp });
      return { ok: false, error: 'ip_not_allowed' };
    }
  }

  // Verify signature if required
  if (webhook.require_signature) {
    if (!signature) {
      writeLog('webhook_missing_signature', { slug });
      return { ok: false, error: 'signature_required' };
    }

    const { verifyHmacSignature } = await import('./core');
    if (!verifyHmacSignature(rawBody, signature, webhook.secret)) {
      writeLog('webhook_invalid_signature', { slug });
      return { ok: false, error: 'invalid_signature' };
    }
  }

  // Log the event
  const eventId = await logWebhookEvent({
    webhook_id: webhook.id,
    user_id: webhook.user_id,
    source_ip: sourceIp,
    method: 'POST',
    path: `/webhooks/incoming/${slug}`,
    headers,
    query_params: queryParams,
    body,
    raw_body: rawBody,
    status: 'received',
    delivery_attempts: 0,
  });

  if (!eventId) {
    writeLog('webhook_log_failed', { slug });
    return { ok: false, error: 'logging_failed' };
  }

  // Dispatch to user
  const result = await dispatchWebhook(
    webhook.user_id,
    webhook,
    eventId,
    body,
    'webhook.cloud'
  );

  return {
    ok: true,
    webhook,
    eventId,
    delivered: result.delivered,
    queued: result.queued,
  };
}
