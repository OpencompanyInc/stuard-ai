/**
 * Renderer-side snapshot of BYOK + Codex status.
 *
 * Combines two sources:
 *   1. GET /v1/byok/providers — which API-key providers the user has
 *      enabled (anthropic / openai / google / xai / openrouter / openai_compatible).
 *   2. window.desktopAPI.codexStatus() — whether the local Codex CLI is
 *      signed in and tokens have been pushed to cloud.
 *
 * Polled lightly (30s) and exposed as a stable object so callers (notably
 * ModelSelector) can show "Your key" / "Codex" badges and a Codex section
 * without each component having to re-query the same endpoints.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { createByokClient, type ByokKey, type ByokProvider } from '../utils/byok-api';

const POLL_MS = 30_000;

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

export interface ByokStatusSnapshot {
  /** Set of providers with an enabled BYOK key. Use String(providerId).toLowerCase(). */
  byokProviders: Set<string>;
  /** Lookup from providerId → public metadata (last_four, label, etc.). */
  byokKeysByProvider: Map<string, ByokKey>;
  /** True when the local Codex CLI is signed in AND tokens have been synced to cloud. */
  codexReady: boolean;
  codexAccountEmail: string | null;
  codexPlanType: string | null;
  loading: boolean;
}

const EMPTY: ByokStatusSnapshot = {
  byokProviders: new Set(),
  byokKeysByProvider: new Map(),
  codexReady: false,
  codexAccountEmail: null,
  codexPlanType: null,
  loading: true,
};

export function useByokStatus(): ByokStatusSnapshot & { refresh: () => void } {
  const [snap, setSnap] = useState<ByokStatusSnapshot>(EMPTY);

  const refresh = useCallback(async () => {
    const client = createByokClient(getToken);
    let keys: ByokKey[] = [];
    try {
      keys = await client.list();
    } catch {
      keys = [];
    }
    const byokProviders = new Set<string>();
    const byokKeysByProvider = new Map<string, ByokKey>();
    for (const k of keys) {
      if (!k.enabled) continue;
      // codex_subscription is tracked separately via codexReady
      if ((k.provider as ByokProvider) === ('codex_subscription' as any)) continue;
      byokProviders.add(String(k.provider).toLowerCase());
      byokKeysByProvider.set(String(k.provider).toLowerCase(), k);
    }

    let codexReady = false;
    let codexAccountEmail: string | null = null;
    let codexPlanType: string | null = null;
    try {
      const cs = await window.desktopAPI?.codexStatus?.();
      if (cs?.signedIn && cs?.lastSyncedAtMs) codexReady = true;
      codexAccountEmail = cs?.accountEmail || null;
      codexPlanType = cs?.planType || null;
    } catch {}

    setSnap({
      byokProviders,
      byokKeysByProvider,
      codexReady,
      codexAccountEmail,
      codexPlanType,
      loading: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { ...snap, refresh };
}

/**
 * Quick helper for picker rows. Given a model whose providerId is one of
 * {openai, anthropic, google, xai, openrouter, ...}, returns the BYOK
 * source label or null when the model would route through Stuard's keys.
 */
export function getByokSourceForProviderId(
  providerId: string | undefined | null,
  snap: Pick<ByokStatusSnapshot, 'byokProviders'>,
): 'byok' | null {
  if (!providerId) return null;
  const id = String(providerId).toLowerCase();
  return snap.byokProviders.has(id) ? 'byok' : null;
}
