import { WebSocket } from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// Connection tracking for Desktop relay
//
// VM agents no longer maintain persistent WebSocket connections.
// Cloud-ai communicates with VMs via on-demand HTTP requests.
// This module only tracks desktop WS connections for relaying terminal output etc.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientType = 'desktop' | 'vm-agent';

interface ConnectionInfo {
  userId: string;
  clientType: ClientType;
}

// userId → most-recent WebSocket for desktop
const desktopConnections = new Map<string, WebSocket>();

// Reverse lookup: ws → { userId, clientType }
const wsToUser = new WeakMap<WebSocket, ConnectionInfo>();

export class DesktopOfflineError extends Error {
  constructor(userId?: string) {
    super(userId
      ? `Desktop app is offline for user ${userId}. Device tools require the Stuard desktop app.`
      : 'Desktop app is offline. Device tools require the Stuard desktop app.');
    this.name = 'DesktopOfflineError';
  }
}

/**
 * Register a WebSocket connection for a given user and client type.
 * For 'vm-agent' type: no-op (VMs use HTTP now).
 * For 'desktop' type: tracks the connection for relay purposes.
 */
export function registerConnection(ws: WebSocket, userId: string, clientType: ClientType): void {
  if (clientType === 'vm-agent') {
    // No-op: VM agents use HTTP now, no persistent WS tracking needed
    return;
  }

  desktopConnections.set(userId, ws);
  wsToUser.set(ws, { userId, clientType });

  ws.on('close', () => {
    const current = desktopConnections.get(userId);
    if (current === ws) {
      desktopConnections.delete(userId);
    }
  });
}

export function getDesktopWs(userId: string): WebSocket | undefined {
  const ws = desktopConnections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (ws) desktopConnections.delete(userId);
  return undefined;
}

export function hasDesktopConnection(userId: string): boolean {
  return !!getDesktopWs(userId);
}

export function getConnectionInfo(ws: WebSocket): ConnectionInfo | undefined {
  return wsToUser.get(ws);
}

export function getConnectionStats(): { desktopCount: number; vmCount: number } {
  let desktopCount = 0;
  for (const [userId, ws] of desktopConnections.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      desktopCount++;
    } else {
      desktopConnections.delete(userId);
    }
  }

  return { desktopCount, vmCount: 0 };
}

