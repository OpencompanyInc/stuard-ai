import type { WebSocket } from 'ws';

import { verifyAccessToken } from '../../auth';
import { clearRun, buildSyncPayload } from '../../services/run-state';
import { registerConnection, type ClientType } from '../../services/vm-bridge';
import { send } from './helpers';
import { registerWebhookClient, deliverQueuedWebhooks } from '../../webhooks/dispatch';
import { registerVoiceBridge } from '../../voice/voice-bridge-manager';

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

    const clientType = typeof (ws as any)?.__clientType === 'string'
      ? String((ws as any).__clientType).toLowerCase().trim()
      : '';
    if (clientType === 'desktop' || clientType === 'vm-agent') {
      try {
        registerConnection(ws, authResult.userId, clientType as ClientType);
      } catch { }
    }

    // If this WS was opened for a voice bridge session, register it
    const voiceSession = (ws as any).__voiceSession as string | undefined;
    if (voiceSession) {
      registerVoiceBridge(voiceSession, ws);
      send(ws, { type: 'auth_result', ok: true, voiceBridge: true });
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
