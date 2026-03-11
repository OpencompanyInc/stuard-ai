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
const listeners = new Set<(session: Session | null) => void>();

function emitSessionChange() {
  for (const listener of listeners) {
    try { listener(currentSession); } catch { }
  }
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

export function getMainUserId(): string | null {
  return currentSession?.user?.id || null;
}

export async function syncMainAuthSession(session: Session | null): Promise<{ ok: boolean; error?: string }> {
  const client = getMainSupabaseClient()!;
  try {
    if (!session?.access_token || !session?.refresh_token) {
      currentSession = null;
      try { await client.auth.signOut(); } catch { }
      emitSessionChange();
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
    logger.info(`[auth-session] Session synced for user ${currentSession?.user?.id}`);
    try { client.realtime.setAuth(currentSession.access_token); } catch { }
    emitSessionChange();
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
