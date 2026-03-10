import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import logger from '../utils/logger';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_PUBLISHABLE_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();

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
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    logger.warn('[auth-session] Supabase public config missing in main process');
    return null;
  }
  supabaseMain = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
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
  const client = getMainSupabaseClient();
  if (!client) return { ok: false, error: 'supabase_main_client_unavailable' };
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
      return { ok: false, error: error.message };
    }

    currentSession = data.session || session;
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
