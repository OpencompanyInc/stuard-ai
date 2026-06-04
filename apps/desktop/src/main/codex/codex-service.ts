/**
 * Codex (ChatGPT-subscription) integration — desktop main process.
 *
 * The user runs `codex login` (the official OpenAI Codex CLI handles the
 * full OAuth dance against ChatGPT). The CLI persists tokens at
 * ~/.codex/auth.json. We read that file, decode the id_token JWT for
 * account metadata, and POST the tokens to cloud-ai so cloud-ai can call
 * https://chatgpt.com/backend-api/codex/responses on the user's behalf
 * with whatever tools the host attached.
 *
 * Security notes:
 *   - Tokens never touch disk anywhere except where Codex CLI already put
 *     them (~/.codex/auth.json). We read in-process and POST directly.
 *   - The HTTP call to cloud-ai requires a Supabase JWT in Authorization;
 *     we get it from getMainAccessToken().
 *   - We refuse to POST plaintext tokens over a non-HTTPS endpoint
 *     (loopback exception for dev).
 *   - We never log access_token, refresh_token, or chatgpt-account-id.
 */

import { ipcMain, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { getMainAccessToken } from '../services/auth-session';
import logger from '../utils/logger';

const AUTH_PATH = join(homedir(), '.codex', 'auth.json');
const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

let resyncTimer: NodeJS.Timeout | null = null;
let lastSyncedAtMs: number | null = null;
let lastSyncError: string | null = null;
let lastTokenFingerprint: string | null = null; // first 16 chars of access_token, for change detection only

interface AuthDotJson {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface DecodedJwt {
  email: string | null;
  accountId: string | null;
  planType: string | null;
  expiresAt: string | null; // ISO
}

function decodeJwt(jwt: string): DecodedJwt {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return { email: null, accountId: null, planType: null, expiresAt: null };
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const obj = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    const email = typeof obj?.email === 'string' ? obj.email : null;
    const auth = obj?.['https://api.openai.com/auth'];
    const accountId = typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : null;
    const planType = typeof auth?.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : null;
    const exp = typeof obj?.exp === 'number' ? obj.exp : null;
    const expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
    return { email, accountId, planType, expiresAt };
  } catch {
    return { email: null, accountId: null, planType: null, expiresAt: null };
  }
}

function readAuthJson(): AuthDotJson | null {
  try {
    if (!existsSync(AUTH_PATH)) return null;
    const raw = readFileSync(AUTH_PATH, 'utf8');
    return JSON.parse(raw) as AuthDotJson;
  } catch (e: any) {
    logger?.warn?.(`[codex] failed to read auth.json: ${e?.message || 'unknown'}`);
    return null;
  }
}

function detectCodexBinary(): boolean {
  // We don't actually need the binary to be on PATH for the import flow
  // to work — we just need ~/.codex/auth.json. But we surface CLI presence
  // for the UI's "install codex" hint. Lightweight check: look for the
  // ~/.codex directory itself; presence of auth.json implies the CLI ran.
  return existsSync(join(homedir(), '.codex'));
}

function getCloudAiBase(): string {
  // Match the renderer's default in apps/desktop/src/renderer/utils/cloud.ts
  // so a dev with no env vars set hits their local cloud-ai (8082) instead
  // of production. Override either by setting CLOUD_AI_HTTP in the desktop
  // main-process env or by running against a remote.
  const raw = process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || 'http://127.0.0.1:8082';
  return String(raw).replace(/\/+$/, '');
}

function assertSecureForPlaintext(baseUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('cloud_ai_url_invalid'); }
  if (parsed.protocol === 'https:') return;
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return;
  throw new Error('insecure_transport');
}

export interface CodexStatus {
  installed: boolean;     // ~/.codex exists (CLI has been used)
  signedIn: boolean;      // auth.json exists with tokens
  accountEmail: string | null;
  planType: string | null;
  // The plan label above is decoded from the cached token, NOT a live OpenAI
  // lookup. The plan_type claim is only re-issued when the Codex CLI
  // logs in or refreshes, so a subscription change won't show until then.
  // These fields let the UI flag a possibly-stale plan instead of asserting
  // it confidently.
  tokenExpiresAt: string | null; // ISO; JWT `exp`
  tokenExpired: boolean;         // exp is in the past
  lastRefreshAtMs: number | null; // when auth.json was last refreshed/written
  authJsonPath: string;
  lastSyncedAtMs: number | null;
  lastSyncError: string | null;
}

const EMPTY_JWT: DecodedJwt = { email: null, accountId: null, planType: null, expiresAt: null };

export function getCodexStatus(): CodexStatus {
  const installed = detectCodexBinary();
  const auth = readAuthJson();
  const tokens = auth?.tokens;

  // Decode both tokens — they serve different purposes and have very
  // different lifetimes:
  //   - id_token: short-lived (~1h) identity assertion. Best source for
  //     profile claims (email, plan_type).
  //   - access_token: the long-lived (~days) bearer credential cloud-ai
  //     actually sends to chatgpt.com. Its expiry is what gates whether
  //     inference still works — so the "expired" signal must come from here,
  //     NOT the id_token (which would false-alarm within an hour of every
  //     refresh). This mirrors syncCodexToCloud's expires_at computation.
  const idDecoded = tokens?.id_token ? decodeJwt(tokens.id_token) : EMPTY_JWT;
  const accessDecoded = tokens?.access_token ? decodeJwt(tokens.access_token) : EMPTY_JWT;

  // When was the token last refreshed/written? Prefer auth.json's own
  // `last_refresh` marker, fall back to the file mtime.
  let lastRefreshAtMs: number | null = null;
  if (auth?.last_refresh) {
    const t = Date.parse(auth.last_refresh);
    if (!Number.isNaN(t)) lastRefreshAtMs = t;
  }
  if (lastRefreshAtMs == null) {
    try {
      if (existsSync(AUTH_PATH)) lastRefreshAtMs = statSync(AUTH_PATH).mtimeMs;
    } catch {}
  }

  const tokenExpiresAt = accessDecoded.expiresAt ?? idDecoded.expiresAt;
  const expMs = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN;
  const tokenExpired = !Number.isNaN(expMs) && expMs < Date.now();

  return {
    installed,
    signedIn: !!(tokens?.access_token),
    accountEmail: idDecoded.email ?? accessDecoded.email,
    planType: idDecoded.planType ?? accessDecoded.planType,
    tokenExpiresAt,
    tokenExpired,
    lastRefreshAtMs,
    authJsonPath: AUTH_PATH,
    lastSyncedAtMs,
    lastSyncError,
  };
}

/**
 * Push the local Codex tokens up to cloud-ai's encrypted store. Idempotent:
 * if the access_token hasn't changed since last sync, skips the network call.
 */
export async function syncCodexToCloud(opts?: { force?: boolean }): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const auth = readAuthJson();
  const tokens = auth?.tokens;
  const accessToken = tokens?.access_token;
  if (!accessToken) {
    lastSyncError = 'no_local_tokens';
    return { ok: false, error: 'no_local_tokens' };
  }
  const fingerprint = accessToken.slice(0, 16);
  if (!opts?.force && fingerprint === lastTokenFingerprint && lastSyncedAtMs && (Date.now() - lastSyncedAtMs) < RESYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }

  const sbToken = getMainAccessToken();
  if (!sbToken) {
    lastSyncError = 'not_signed_in';
    return { ok: false, error: 'not_signed_in' };
  }

  const base = getCloudAiBase();
  try {
    assertSecureForPlaintext(base);
  } catch (e: any) {
    lastSyncError = e?.message || 'insecure_transport';
    return { ok: false, error: lastSyncError ?? 'insecure_transport' };
  }

  const idDecoded = tokens?.id_token ? decodeJwt(tokens.id_token) : { email: null, accountId: null, planType: null, expiresAt: null };
  const accessDecoded = decodeJwt(accessToken);

  const body = {
    access_token: accessToken,
    refresh_token: tokens?.refresh_token || null,
    expires_at: accessDecoded.expiresAt || idDecoded.expiresAt,
    account_email: idDecoded.email || accessDecoded.email,
  };

  try {
    const r = await fetch(`${base}/v1/byok/codex/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${sbToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const status = r.status;
      let errorCode = `http_${status}`;
      try {
        const j = await r.json();
        if (j && typeof j.error === 'string') errorCode = j.error;
      } catch {}
      lastSyncError = errorCode;
      return { ok: false, error: errorCode };
    }
    lastSyncedAtMs = Date.now();
    lastSyncError = null;
    lastTokenFingerprint = fingerprint;
    return { ok: true };
  } catch (e: any) {
    lastSyncError = e?.code || e?.name || 'network_error';
    return { ok: false, error: lastSyncError ?? 'network_error' };
  }
}

/**
 * Spawn `codex login` in a detached terminal so the user can complete the
 * OAuth flow. Codex CLI opens a browser and listens on 127.0.0.1:1455
 * itself; we don't get involved in the OAuth at all.
 *
 * We don't spawn it inside Electron because the user needs to see the
 * device-code prompt or browser instruction. On Windows/macOS we use the
 * platform's "open in terminal" mechanism by shelling out via a helper.
 */
export async function openCodexLogin(): Promise<{ ok: boolean; error?: string; method?: string }> {
  // First, try just running it with stdio inherited via a detached process.
  // If that fails (eg codex isn't on PATH), tell the renderer to surface
  // install instructions.
  try {
    const child = spawn('codex', ['login'], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    child.on('error', () => {/* swallow; renderer will handle */});
    child.unref();
    // Schedule a sync poll after a few seconds to pick up the new tokens
    // once the user finishes the browser flow.
    setTimeout(() => { void syncCodexToCloud({ force: true }); }, 8000);
    setTimeout(() => { void syncCodexToCloud({ force: true }); }, 20000);
    setTimeout(() => { void syncCodexToCloud({ force: true }); }, 45000);
    return { ok: true, method: 'spawn' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'spawn_failed' };
  }
}

/** Open ~/.codex/auth.json's parent directory in the OS file manager. */
export async function revealCodexDir(): Promise<void> {
  try {
    const dir = join(homedir(), '.codex');
    if (existsSync(dir)) {
      await shell.openPath(dir);
    }
  } catch {}
}

let watchAttached = false;
function attachAuthFileWatcher(): void {
  if (watchAttached) return;
  watchAttached = true;
  let lastMtime = 0;
  try {
    if (existsSync(AUTH_PATH)) {
      lastMtime = statSync(AUTH_PATH).mtimeMs;
    }
  } catch {}
  // Lightweight 30s poll for mtime changes — avoids fs.watch flakiness
  // across platforms when the file is replaced atomically by Codex CLI.
  setInterval(() => {
    try {
      if (!existsSync(AUTH_PATH)) return;
      const m = statSync(AUTH_PATH).mtimeMs;
      if (m > lastMtime + 1000) {
        lastMtime = m;
        void syncCodexToCloud({ force: true });
      }
    } catch {}
  }, 30_000).unref?.();
}

/**
 * Wire ipcMain handlers + start the periodic resync timer. Call once
 * during setupIpc().
 */
export function setupCodexIpc(): void {
  ipcMain.handle('codex:status', async () => getCodexStatus());
  ipcMain.handle('codex:syncToCloud', async (_e, opts?: { force?: boolean }) => syncCodexToCloud(opts || {}));
  ipcMain.handle('codex:openLogin', async () => openCodexLogin());
  ipcMain.handle('codex:revealDir', async () => { await revealCodexDir(); return { ok: true }; });

  // Startup sync (best-effort — fails silently if user isn't signed in
  // to Stuard yet).
  setTimeout(() => { void syncCodexToCloud({}); }, 3_000);

  if (resyncTimer) { try { clearInterval(resyncTimer); } catch {} }
  resyncTimer = setInterval(() => { void syncCodexToCloud({}); }, RESYNC_INTERVAL_MS);
  resyncTimer.unref?.();

  attachAuthFileWatcher();
}
