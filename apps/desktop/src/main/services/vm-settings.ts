/**
 * VM Settings — desktop ↔ VM-wide configuration sync.
 *
 * Right now this owns the user's IANA timezone. Calling `syncTimezoneToVm()`
 * pushes the desktop's current zone (manual override or OS auto-detect) to
 * cloud-ai's `/v1/cloud-engine/timezone` endpoint, which:
 *
 *   1. Persists it to the user's profile so future VM provisions / cold
 *      starts inherit it (no more UTC-by-default VMs).
 *   2. Forwards a `set_user_timezone` command to the running VM agent so
 *      cron triggers, quiet-hour math, and time-tool output flip
 *      immediately — no bot redeploy required.
 *
 * Add other VM-wide settings here as they come up.
 */
import { BrowserWindow, net } from 'electron';
import logger from '../utils/logger';
import { getTimezone } from '../settings';

function getCloudAiHttp(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    ''
  ).trim().replace(/\/+$/, '') || 'http://127.0.0.1:8082';
}

async function getAuthToken(): Promise<string | null> {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const token = await win.webContents.executeJavaScript(
        `(async () => { try { const { data } = await window.supabase?.auth?.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
        true,
      );
      if (token) return token;
    }
  } catch { /* fall through */ }
  return null;
}

export interface VmTimezoneSyncResult {
  ok: boolean;
  timezone?: string;
  /** True when supabase profile was updated. */
  persisted?: boolean;
  /** Result from the `set_user_timezone` VM command (skipped if engine is offline). */
  vm?: { ok: boolean; skipped?: boolean; changed?: boolean; timezone?: string | null; error?: string };
  error?: string;
}

// Avoid spamming the endpoint when several callers ask in quick succession
// (e.g. preferences-changed + engine-status-poll firing back-to-back).
let _inFlight: Promise<VmTimezoneSyncResult> | null = null;
let _lastSyncedTz: string | null = null;
let _lastSyncedAt = 0;
const RESYNC_THROTTLE_MS = 30_000;

/**
 * Push the desktop's current timezone to cloud-ai (and from there to the VM).
 *
 * Best-effort and idempotent: returns the cached success for the same tz if
 * called repeatedly within RESYNC_THROTTLE_MS. Pass `force: true` to bypass
 * the cache (e.g. when the user just changed their preference).
 */
export async function syncTimezoneToVm(opts: { force?: boolean; timezone?: string } = {}): Promise<VmTimezoneSyncResult> {
  const tz = (opts.timezone && opts.timezone.trim()) || getTimezone();
  const now = Date.now();
  if (
    !opts.force &&
    _lastSyncedTz === tz &&
    now - _lastSyncedAt < RESYNC_THROTTLE_MS
  ) {
    return { ok: true, timezone: tz };
  }
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    const token = await getAuthToken();
    if (!token) return { ok: false, error: 'not_authenticated' as const };
    const cloud = getCloudAiHttp();
    try {
      const resp = await net.fetch(`${cloud}/v1/cloud-engine/timezone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ timezone: tz }),
      });
      const data = await resp.json() as any;
      if (!resp.ok || data?.ok === false) {
        return { ok: false, error: String(data?.error || `http_${resp.status}`) };
      }
      _lastSyncedTz = tz;
      _lastSyncedAt = Date.now();
      return {
        ok: true,
        timezone: data?.timezone || tz,
        persisted: !!data?.persisted,
        vm: data?.vm,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'cloud_unreachable') };
    }
  })();

  try {
    const result = await _inFlight;
    if (!result.ok) {
      logger.warn(`[vm-settings] Timezone sync failed: ${result.error}`);
    } else {
      logger.info(`[vm-settings] Synced timezone "${result.timezone}" to VM (persisted=${result.persisted}, vm.ok=${result.vm?.ok ?? '?'})`);
    }
    return result;
  } finally {
    _inFlight = null;
  }
}

/** Forget the throttle cache — call after the user signs out or the engine is destroyed. */
export function resetTimezoneSyncCache(): void {
  _lastSyncedTz = null;
  _lastSyncedAt = 0;
}
