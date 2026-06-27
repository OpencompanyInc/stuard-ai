/**
 * View Sessions
 *
 * Short-lived, opaque session ids used by capability URLs that can't carry
 * an Authorization header — primarily iframes for HTML file preview and
 * the localhost dev-server proxy.
 *
 * The sid is minted via an authenticated POST and embedded in the URL path
 * itself. The URL is the capability — possessing a valid sid means the
 * caller has been authenticated within the TTL window.
 */

import { randomBytes } from 'crypto';

export interface ViewSession {
  userId: string;
  expiresAt: number;
}

const VIEW_SESSIONS = new Map<string, ViewSession>();
export const VIEW_SESSION_TTL_MS = 5 * 60 * 1000;

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [sid, sess] of VIEW_SESSIONS) {
    if (sess.expiresAt <= now) VIEW_SESSIONS.delete(sid);
  }
}

export function mintViewSession(userId: string): { sid: string; expiresAt: number } {
  pruneExpiredSessions();
  const sid = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + VIEW_SESSION_TTL_MS;
  VIEW_SESSIONS.set(sid, { userId, expiresAt });
  return { sid, expiresAt };
}

export function lookupViewSession(sid: string): ViewSession | null {
  const sess = VIEW_SESSIONS.get(sid);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) {
    VIEW_SESSIONS.delete(sid);
    return null;
  }
  return sess;
}
