import { getExternalAccount, upsertExternalAccount } from '../../supabase';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../../utils/config';
import { getDesktopWs } from '../../services/vm-bridge';
import { withClientBridge } from '../../tools/bridge';
import { getClientOAuthAccount, storeClientOAuthAccount, listVMOAuthAccountsForUser } from '../../tools/vm-oauth';

export { getExternalAccount };

function parseIso(iso?: string | null): number | null {
  try { return iso ? new Date(iso).getTime() : null; } catch { return null; }
}

export async function refreshGoogleTokenIfNeeded(userId: string, acc: any, profileLabel?: string): Promise<string> {
  let accessToken = String(acc?.access_token || '');
  const expiresAt = parseIso(acc?.expires_at);
  const now = Date.now();
  const skewMs = 120_000; // 2 minutes
  const shouldRefresh = !!expiresAt && (expiresAt - now) < skewMs;
  if (!shouldRefresh) return accessToken;
  if (!acc?.refresh_token || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return accessToken;
  try {
    const params = new URLSearchParams();
    params.set('client_id', GOOGLE_CLIENT_ID);
    params.set('client_secret', GOOGLE_CLIENT_SECRET);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', String(acc.refresh_token));
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const newAccess = String(tBody.access_token);
      const expiresIn = Number(tBody.expires_in || 3600);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
      try {
        await upsertExternalAccount({
          userId,
          provider: 'google',
          access_token: newAccess,
          scopes: Array.isArray(acc.scopes) ? acc.scopes : [],
          refresh_token: refresh_token || null,
          expires_at,
          meta: { token_type: tBody.token_type || (acc.meta?.token_type || 'Bearer') },
          profileLabel: profileLabel || acc.profile_label || 'default',
          accountEmail: acc.account_email || null,
        });
      } catch {}
      accessToken = newAccess;
    }
  } catch {}
  return accessToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Device-aware Google token resolution for plain HTTP routes (planner / calendar)
//
// Since the OAuth-local migration, Google tokens are device-held — they no longer
// live in Supabase for migrated users. Agent tools fetch them over the bridge at
// call-time, but plain HTTP routes (e.g. the dashboard planner's calendar fetch)
// have no bridge/ALS context. This resolver re-establishes a bridge bound to the
// caller's registered desktop WS (same mechanism as exportDesktopOAuthTokens) and
// reuses the migrated client-store accessors, falling back to a running VM and
// finally legacy Supabase rows.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedGoogleAccount {
  accessToken: string;
  scopes: string[];
  profileLabel: string;
  source: 'desktop' | 'vm' | 'supabase';
}

interface ExchangedGoogleToken {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

function tokenNeedsRefresh(expiresAtIso?: string | null): boolean {
  const expiresAt = parseIso(expiresAtIso);
  return !!expiresAt && (expiresAt - Date.now()) < 120_000; // 2-minute skew
}

/** Exchange a refresh token for a fresh access token (cloud-ai holds the client secret). */
async function exchangeGoogleRefreshToken(refreshToken: string): Promise<ExchangedGoogleToken | null> {
  if (!refreshToken || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  try {
    const params = new URLSearchParams();
    params.set('client_id', GOOGLE_CLIENT_ID);
    params.set('client_secret', GOOGLE_CLIENT_SECRET);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refreshToken);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const expiresIn = Number(tBody.expires_in || 3600);
      return {
        access_token: String(tBody.access_token),
        refresh_token: String(tBody.refresh_token || refreshToken),
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    }
  } catch {}
  return null;
}

/**
 * Resolve a usable Google access token + scopes for a non-agent HTTP route.
 * Order: desktop-local store → running VM store → legacy Supabase. Proactively
 * refreshes a near-expiry token and writes it back to the store it came from.
 * Returns null when Google isn't connected anywhere reachable.
 */
export async function resolveGoogleAccountForRoute(
  userId: string,
  profileLabel?: string,
): Promise<ResolvedGoogleAccount | null> {
  // 1. Desktop-local — the common case for desktop users post-migration. Bind a
  //    bridge to the user's registered desktop WS so getClientOAuthAccount /
  //    storeClientOAuthAccount reach the device's encrypted store.
  const desktopWs = getDesktopWs(userId);
  if (desktopWs) {
    try {
      const resolved = await withClientBridge(desktopWs, async (): Promise<ResolvedGoogleAccount | null> => {
        const acc = await getClientOAuthAccount('google', profileLabel);
        if (!acc) return null;
        let accessToken = String(acc.access_token || '');
        if (tokenNeedsRefresh(acc.expires_at) && acc.refresh_token) {
          const refreshed = await exchangeGoogleRefreshToken(String(acc.refresh_token));
          if (refreshed) {
            await storeClientOAuthAccount('google', {
              ...acc,
              access_token: refreshed.access_token,
              refresh_token: refreshed.refresh_token,
              expires_at: refreshed.expires_at,
            }).catch(() => {});
            accessToken = refreshed.access_token;
          }
        }
        return {
          accessToken,
          scopes: Array.isArray(acc.scopes) ? acc.scopes.map((s: any) => String(s)) : [],
          profileLabel: acc.profile_label || 'default',
          source: 'desktop',
        };
      }, { userId }) as ResolvedGoogleAccount | null;
      if (resolved) return resolved;
    } catch {}
  }

  // 2. VM-local — cloud-engine users whose tokens live on the running VM.
  try {
    const vmAccounts = await listVMOAuthAccountsForUser(userId, 'google');
    const vmAcc = vmAccounts.find(a => !profileLabel || a.profile_label === profileLabel)
      || (profileLabel ? null : (vmAccounts.find(a => a.is_default) || vmAccounts[0] || null));
    if (vmAcc) {
      let accessToken = String(vmAcc.access_token || '');
      if (tokenNeedsRefresh(vmAcc.expires_at) && vmAcc.refresh_token) {
        const refreshed = await exchangeGoogleRefreshToken(String(vmAcc.refresh_token));
        if (refreshed) {
          try {
            const { storeOAuthTokensOnVM } = await import('../cloud-engine');
            await storeOAuthTokensOnVM(userId, [{
              provider: 'google',
              profileLabel: vmAcc.profile_label || 'default',
              isDefault: vmAcc.is_default,
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: refreshed.expires_at,
              scopes: vmAcc.scopes || [],
              accountEmail: vmAcc.account_email || null,
            }], { replace: false });
          } catch {}
          accessToken = refreshed.access_token;
        }
      }
      return {
        accessToken,
        scopes: Array.isArray(vmAcc.scopes) ? vmAcc.scopes.map((s: any) => String(s)) : [],
        profileLabel: vmAcc.profile_label || 'default',
        source: 'vm',
      };
    }
  } catch {}

  // 3. Legacy Supabase — pre-migration rows, until the Phase-4 cleanup deletes them.
  try {
    const acc = await getExternalAccount(userId, 'google', profileLabel);
    if (acc) {
      const accessToken = await refreshGoogleTokenIfNeeded(userId, acc);
      return {
        accessToken,
        scopes: Array.isArray(acc.scopes) ? acc.scopes.map((s: any) => String(s)) : [],
        profileLabel: acc.profile_label || 'default',
        source: 'supabase',
      };
    }
  } catch {}

  return null;
}
