/**
 * Voice Bridge Manager
 *
 * Coordinates the per-voice-session desktop bridge lifecycle:
 *
 *   1. Cloud inserts a row into `voice_bridge_requests` via Supabase
 *   2. Desktop picks it up via Supabase Realtime subscription
 *   3. Desktop opens a WS to /ws?client=desktop&voice_session=<sessionId>
 *   4. Cloud auth-handler recognises the param and calls registerVoiceBridge()
 *   5. The pending promise resolves → voice tools can relay through the WS
 *   6. On call end, cleanupVoiceBridge() tears everything down
 */

import { WebSocket } from 'ws';
import { getSupabaseService } from '../supabase';

const BRIDGE_REQUEST_TIMEOUT_MS = 15_000;
const BRIDGE_TABLE = 'voice_bridge_requests';

// sessionId → open WS to desktop
const activeBridges = new Map<string, WebSocket>();

// sessionId → waiting for desktop to connect
interface PendingBridge {
  resolve: (ws: WebSocket) => void;
  timer: NodeJS.Timeout;
}
const pendingBridges = new Map<string, PendingBridge>();

/**
 * Called by the auth handler when a desktop WS authenticates with a
 * `voice_session` query param. Links the WS to the voice session.
 */
export function registerVoiceBridge(sessionId: string, ws: WebSocket): boolean {
  const pending = pendingBridges.get(sessionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingBridges.delete(sessionId);
  }

  activeBridges.set(sessionId, ws);
  ws.on('close', () => {
    activeBridges.delete(sessionId);
  });

  if (pending) {
    pending.resolve(ws);
  }

  updateBridgeStatus(sessionId, 'connected').catch(() => {});
  console.log('[voice-bridge] Desktop bridge connected', { sessionId });
  return true;
}

/**
 * Get the desktop bridge WS for a voice session (non-blocking).
 */
export function getVoiceBridgeWs(sessionId: string | undefined): WebSocket | undefined {
  if (!sessionId) return undefined;
  const ws = activeBridges.get(sessionId);
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (ws) activeBridges.delete(sessionId);
  return undefined;
}

/**
 * Tear down the bridge for a voice session (call this when the call ends).
 */
export function cleanupVoiceBridge(sessionId: string): void {
  const ws = activeBridges.get(sessionId);
  if (ws) {
    try { ws.close(); } catch {}
    activeBridges.delete(sessionId);
  }
  const pending = pendingBridges.get(sessionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingBridges.delete(sessionId);
  }
  updateBridgeStatus(sessionId, 'closed').catch(() => {});
}

/**
 * Signal the desktop to open a bridge WS for this voice session.
 * Inserts a row into Supabase so the desktop's Realtime listener picks it up,
 * then waits up to BRIDGE_REQUEST_TIMEOUT_MS for the desktop to connect.
 *
 * Returns the bridge WS, or null if the desktop didn't connect in time.
 */
export async function requestDesktopBridge(
  userId: string,
  sessionId: string,
  channel: 'telnyx' | 'discord',
): Promise<WebSocket | null> {
  const existing = getVoiceBridgeWs(sessionId);
  if (existing) return existing;

  const supabase = getSupabaseService();
  if (!supabase) {
    console.warn('[voice-bridge] No Supabase service client, cannot signal desktop');
    return null;
  }

  try {
    const { error } = await supabase.from(BRIDGE_TABLE).insert({
      user_id: userId,
      session_id: sessionId,
      channel,
      status: 'pending',
      expires_at: new Date(Date.now() + BRIDGE_REQUEST_TIMEOUT_MS + 5_000).toISOString(),
    });
    if (error) throw error;
  } catch (err: any) {
    console.warn('[voice-bridge] Failed to insert bridge request:', err?.message);
    return null;
  }

  return new Promise<WebSocket | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingBridges.delete(sessionId);
      console.warn('[voice-bridge] Desktop bridge timeout', { sessionId });
      resolve(null);
    }, BRIDGE_REQUEST_TIMEOUT_MS);

    pendingBridges.set(sessionId, {
      resolve: (ws) => resolve(ws),
      timer,
    });
  });
}

async function updateBridgeStatus(sessionId: string, status: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return;
  try {
    await supabase.from(BRIDGE_TABLE).update({ status }).eq('session_id', sessionId);
  } catch {}
}
