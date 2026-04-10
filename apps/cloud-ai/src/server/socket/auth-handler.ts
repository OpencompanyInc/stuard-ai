import type { WebSocket } from 'ws';

import { verifyAccessToken } from '../../auth';
import { clearRun, buildSyncPayload } from '../../services/run-state';
import { send } from './helpers';
import { registerWebhookClient, deliverQueuedWebhooks } from '../../webhooks/dispatch';

export async function registerWebhookState(ws: WebSocket, userId: string) {
  registerWebhookClient(userId, ws);
  return await deliverQueuedWebhooks(userId, ws);
}

export function sendRunStateSync(ws: WebSocket, userId: string, requestId?: string) {
  const sync = buildSyncPayload(userId);
  if (sync.pendingApprovals.length === 0 && sync.terminals.length === 0) {
    return;
  }

  send(ws, { type: 'run_state_sync', ...sync }, requestId);
  for (const terminal of sync.terminals) {
    clearRun(userId, terminal.requestId);
  }
}

export async function handleAuthMessage(ws: WebSocket, msg: any) {
  const token = String(msg?.accessToken || msg?.auth?.accessToken || '').trim();
  if (!token) {
    send(ws, { type: 'auth_result', ok: false, message: 'no_token' });
    return;
  }

  try {
    const authResult = await verifyAccessToken(token);
    if (!authResult?.success || !authResult.userId) {
      send(ws, { type: 'auth_result', ok: false, message: 'invalid_token' });
      return;
    }

    try {
      const delivered = await registerWebhookState(ws, authResult.userId);
      send(ws, { type: 'auth_result', ok: true, queued: delivered });
    } catch {
      send(ws, { type: 'auth_result', ok: true, queued: 0 });
    }

    try {
      sendRunStateSync(ws, authResult.userId);
    } catch { }
  } catch (error: any) {
    send(ws, { type: 'auth_result', ok: false, message: error?.message || 'auth_failed' });
  }
}
