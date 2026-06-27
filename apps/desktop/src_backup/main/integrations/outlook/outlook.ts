import { app, shell, Notification, net } from "electron";
import * as http from "http";
import path from "path";
import * as fs from "fs";
import { generatePkcePair } from "../../utils/pkce";

export async function getOutlookAccessTokenLocal(): Promise<{ ok: boolean; accessToken?: string; remainingSeconds?: number }> {
  try {
    const p = path.join(app.getPath('userData'), 'ms_oauth_tokens.json');
    if (!fs.existsSync(p)) return { ok: false };
    const raw = fs.readFileSync(p, 'utf-8');
    const j = JSON.parse(raw || '{}');
    const at = typeof j?.access_token === 'string' ? j.access_token : '';
    const rt = typeof j?.refresh_token === 'string' ? j.refresh_token : '';
    const obtained = j?.obtained_at ? new Date(j.obtained_at).getTime() : 0;
    const expiresIn = Number(j?.expires_in || 3600);
    const now = Date.now();
    const age = Math.max(0, Math.floor((now - obtained) / 1000));
    const remaining = expiresIn - age;
    if (at && remaining > 15) return { ok: true, accessToken: at, remainingSeconds: remaining };
    if (!rt) return { ok: false };
    const CLIENT_ID = process.env.MS_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
    const TENANT = process.env.MS_TENANT || 'common';
    if (!CLIENT_ID) return { ok: false };
    const tokenUrl = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
    const scope = ["offline_access", "User.Read", "Mail.Read", "Mail.Send"].join(' ');
    const params = new URLSearchParams();
    params.set('client_id', CLIENT_ID);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', rt);
    params.set('scope', scope);
    const resp = await net.fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false };
    const newAt = String((body as any)?.access_token || '');
    const newRt = String((body as any)?.refresh_token || rt);
    const newExp = Number((body as any)?.expires_in || 3600);
    if (!newAt) return { ok: false };
    const updated = { ...j, access_token: newAt, refresh_token: newRt, expires_in: newExp, obtained_at: new Date().toISOString() };
    try { fs.writeFileSync(p, JSON.stringify(updated, null, 2), 'utf-8'); } catch {}
    return { ok: true, accessToken: newAt, remainingSeconds: newExp };
  } catch {
    return { ok: false };
  }
}

function randomState() {
  const b = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startOutlookConnect(): Promise<{ ok: boolean; error?: string }> {
  const CLIENT_ID = process.env.MS_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
  const TENANT = process.env.MS_TENANT || 'common';
  if (!CLIENT_ID) return { ok: false, error: 'Missing MS_CLIENT_ID' };
  const scopes = ["openid", "profile", "offline_access", "User.Read", "Mail.Read", "Mail.Send"].join(' ');
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = randomState();
  const server = http.createServer();
  const port: number = await new Promise((resolve, reject) => {
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve((addr as any).port);
      else reject(new Error('no address'));
    });
  });
  const redirectUri = `http://localhost:${port}`;
  const authUrl = new URL(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  const result = await new Promise<{ code?: string; error?: string; state?: string }>((resolve) => {
    server.on('request', async (req, res) => {
      try {
        const u = new URL(req.url || '/', `http://localhost:${port}`);
        if (u.pathname === '/') {
          const code = u.searchParams.get('code') || undefined;
          const err = u.searchParams.get('error') || undefined;
          const st = u.searchParams.get('state') || undefined;
          (res as any).statusCode = 200;
          (res as any).setHeader('Content-Type', 'text/html; charset=utf-8');
          (res as any).end('<html><body>Authentication complete. You can close this window.</body></html>');
          resolve({ code, error: err, state: st });
          setTimeout(() => { try { server.close(); } catch {} }, 50);
        } else {
          (res as any).statusCode = 404;
          (res as any).end('Not found');
        }
      } catch {
        try { (res as any).statusCode = 500; (res as any).end('Error'); } catch {}
      }
    });
    try { shell.openExternal(authUrl.toString()); } catch {}
  });
  if (result.error) return { ok: false, error: result.error };
  if (!result.code) return { ok: false, error: 'No code' };
  if (result.state !== state) return { ok: false, error: 'State mismatch' };
  const tokenUrl = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', CLIENT_ID);
  body.set('code', result.code);
  body.set('redirect_uri', redirectUri);
  body.set('code_verifier', codeVerifier);
  const resp = await net.fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { ok: false, error: `Token error ${resp.status} ${t}` };
  }
  const json: any = await resp.json();
  const tokenPath = path.join(app.getPath('userData'), 'ms_oauth_tokens.json');
  const payload = {
    obtained_at: new Date().toISOString(),
    tenant: TENANT,
    client_id: CLIENT_ID,
    scope: scopes,
    token_type: json.token_type,
    expires_in: json.expires_in,
    ext_expires_in: json.ext_expires_in,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    id_token: json.id_token,
  };
  try { fs.writeFileSync(tokenPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8' }); } catch {}
  return { ok: true };
}

export function getOutlookStatus() {
  try {
    const p = path.join(app.getPath('userData'), 'ms_oauth_tokens.json');
    const ok = fs.existsSync(p);
    return { ok, path: ok ? p : null };
  } catch {
    return { ok: false };
  }
}
