import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';
const SYNC_PREFS_CACHE_TTL_MS = 5000;

export interface RendererSyncPrefs {
  sync_accounts: boolean;
  sync_conversations: boolean;
  sync_memories: boolean;
  sync_integrations: boolean;
  timezone: string | null;
}

export const DEFAULT_RENDERER_SYNC_PREFS: RendererSyncPrefs = {
  sync_accounts: false,
  sync_conversations: false,
  sync_memories: false,
  sync_integrations: false,
  timezone: null,
};

let syncPrefsCache: { value: RendererSyncPrefs; at: number } | null = null;

export function invalidateRendererSyncPrefsCache() {
  syncPrefsCache = null;
}

export async function fetchRendererSyncPrefs(force = false): Promise<RendererSyncPrefs> {
  if (!force && syncPrefsCache && (Date.now() - syncPrefsCache.at) < SYNC_PREFS_CACHE_TTL_MS) {
    return syncPrefsCache.value;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      syncPrefsCache = { value: DEFAULT_RENDERER_SYNC_PREFS, at: Date.now() };
      return DEFAULT_RENDERER_SYNC_PREFS;
    }

    const resp = await fetch(`${CLOUD_AI_HTTP}/v1/preferences/sync`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    const prefs: RendererSyncPrefs = {
      sync_accounts: !!json?.sync_accounts,
      sync_conversations: !!json?.sync_conversations,
      sync_memories: !!json?.sync_memories,
      sync_integrations: !!json?.sync_integrations,
      timezone: typeof json?.timezone === 'string' ? json.timezone : null,
    };
    syncPrefsCache = { value: prefs, at: Date.now() };
    return prefs;
  } catch {
    syncPrefsCache = { value: DEFAULT_RENDERER_SYNC_PREFS, at: Date.now() };
    return DEFAULT_RENDERER_SYNC_PREFS;
  }
}
