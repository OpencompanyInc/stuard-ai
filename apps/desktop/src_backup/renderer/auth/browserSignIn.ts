import { supabase } from "../lib/supabaseClient";
import { AUTH_PAGE_URL } from "../config.public";

/**
 * Generate a cryptographically secure random string using Web Crypto API
 * Falls back to Math.random if crypto is unavailable
 */
function secureRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  
  try {
    // Use Web Crypto API for cryptographically secure randomness
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => chars[byte % chars.length]).join("");
  } catch {
    // Fallback to Math.random (less secure but functional)
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}

/**
 * Generate a secure UUID v4 using Web Crypto API
 */
function secureUUID(): string {
  try {
    // Use crypto.randomUUID if available (modern browsers)
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {}
  
  // Fallback: generate using getRandomValues
  try {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    // Set version (4) and variant bits
    array[6] = (array[6] & 0x0f) | 0x40;
    array[8] = (array[8] & 0x3f) | 0x80;
    
    const hex = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    // Ultimate fallback
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export async function startBrowserSignIn(timeoutMs = 120_000): Promise<{ ok: true } | { ok: false; error: string }> {
  const channelId = secureUUID();
  const nonce = secureRandomString(32); // Increased length for better security
  const channelName = `auth:${channelId}`;

  const channel = supabase.channel(channelName, { config: { broadcast: { ack: true } } });

  const done = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    const timer = setTimeout(async () => {
      try { await channel.unsubscribe(); } catch {}
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    channel.on("broadcast", { event: "SIGNED_IN" }, async (payload: any) => {
      try {
        const p = payload?.payload || payload;
        if (!p || p.nonce !== nonce) return;
        const tokens = p.tokens || p.session || {};
        const access_token = tokens.access_token || tokens.accessToken;
        const refresh_token = tokens.refresh_token || tokens.refreshToken;
        if (!access_token || !refresh_token) return;
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        clearTimeout(timer);
        try { await channel.unsubscribe(); } catch {}
        if (error) return resolve({ ok: false, error: error.message });
        resolve({ ok: true });
      } catch (e: any) {
        clearTimeout(timer);
        try { await channel.unsubscribe(); } catch {}
        resolve({ ok: false, error: e?.message || "unknown" });
      }
    });
  });

  await channel.subscribe();

  const url = new URL(AUTH_PAGE_URL);
  url.searchParams.set("cid", channelId);
  url.searchParams.set("nonce", nonce);

  try {
    (window as any).desktopAPI?.openExternal?.(url.toString());
  } catch {}

  return done;
}
