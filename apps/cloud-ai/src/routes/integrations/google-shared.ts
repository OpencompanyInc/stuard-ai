import { getExternalAccount, upsertExternalAccount } from '../../supabase';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../../utils/config';

export { getExternalAccount };

function parseIso(iso?: string | null): number | null {
  try { return iso ? new Date(iso).getTime() : null; } catch { return null; }
}

export async function refreshGoogleTokenIfNeeded(userId: string, acc: any): Promise<string> {
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
        });
      } catch {}
      accessToken = newAccess;
    }
  } catch {}
  return accessToken;
}
