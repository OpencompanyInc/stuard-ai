import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import logger from '../utils/logger';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://mptdemenoyqzyttglrvd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wdGRlbWVub3lxenl0dGdscnZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDA4NTgsImV4cCI6MjA3MDE3Njg1OH0.3C0h0CCY1xl-z-zD61pdiiNu5ehN2R9c0tY0DLYI6gE';

let supabaseMain: SupabaseClient | null = null;
let currentSession: Session | null = null;
let currentSessionKey = 'signed-out';
const listeners = new Set<(session: Session | null) => void>();

function emitSessionChange() {
  for (const listener of listeners) {
    try { listener(currentSession); } catch { }
  }
}

function getSessionKey(session: Session | null): string {
  if (!session?.access_token || !session?.refresh_token) {
    return 'signed-out';
  }
  return `${session.user?.id || 'unknown'}:${session.access_token}:${session.refresh_token}`;
}

export function getMainSupabaseClient(): SupabaseClient | null {
  if (supabaseMain) return supabaseMain;
  supabaseMain = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  });
  return supabaseMain;
}

export function getMainAuthSession(): Session | null {
  return currentSession;
}

export function getMainAccessToken(): string | null {
  return currentSession?.access_token || null;
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'));
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Access token guaranteed fresh for at least ~60s. Refreshes via the in-memory
 * refresh token when the current JWT is expired or about to expire, so
 * long-lived main-process callers (tool router, schedulers) don't 401 after
 * the renderer-synced session goes stale.
 */
export async function getValidMainAccessToken(): Promise<string | null> {
  const token = currentSession?.access_token;
  if (!token) return null;

  const expMs = decodeJwtExpMs(token);
  const needsRefresh = expMs !== null && expMs - Date.now() < 60_000;
  if (!needsRefresh || !currentSession?.refresh_token) return token;

  try {
    const client = getMainSupabaseClient()!;
    const { data, error } = await client.auth.refreshSession({
      refresh_token: currentSession.refresh_token,
    });
    if (!error && data.session?.access_token) {
      currentSession = data.session;
      currentSessionKey = getSessionKey(currentSession);
      try { client.realtime.setAuth(currentSession.access_token); } catch { }
      emitSessionChange();
      logger.info('[auth-session] Access token refreshed in main process');
      return currentSession.access_token;
    }
    logger.warn('[auth-session] Token refresh failed:', error?.message);
  } catch (e: any) {
    logger.warn('[auth-session] Token refresh threw:', e?.message);
  }
  return token;
}

export function getMainUserId(): string | null {
  return currentSession?.user?.id || null;
}

export async function syncMainAuthSession(session: Session | null): Promise<{ ok: boolean; error?: string }> {
  const client = getMainSupabaseClient()!;
  try {
    if (!session?.access_token || !session?.refresh_token) {
      const hadSession = currentSessionKey !== 'signed-out';
      currentSession = null;
      currentSessionKey = 'signed-out';
      try { await client.auth.signOut(); } catch { }
      if (hadSession) {
        emitSessionChange();
      }
      return { ok: true };
    }

    const incomingSessionKey = getSessionKey(session);
    if (incomingSessionKey === currentSessionKey) {
      currentSession = session;
      try { client.realtime.setAuth(session.access_token); } catch { }
      return { ok: true };
    }

    const { data, error } = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) {
      logger.warn('[auth-session] setSession failed:', error.message);
      return { ok: false, error: error.message };
    }

    currentSession = data.session || session;
    const nextSessionKey = getSessionKey(currentSession);
    const sessionChanged = nextSessionKey !== currentSessionKey;
    currentSessionKey = nextSessionKey;
    logger.info(`[auth-session] Session synced for user ${currentSession?.user?.id}`);
    try { client.realtime.setAuth(currentSession.access_token); } catch { }
    if (sessionChanged) {
      emitSessionChange();
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function onMainAuthSessionChange(listener: (session: Session | null) => void): () => void {
  listeners.add(listener);
  return () => {
    try { listeners.delete(listener); } catch { }
  };
}
