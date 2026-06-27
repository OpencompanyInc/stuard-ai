// ─── Marketplace identity (one-time publisher username) ──────────────────────
// Every workflow a person publishes goes out under a single @username — set
// once, reused everywhere. This replaces the old per-publish "display name +
// handle" fields. The username is stored locally; the publish flow reads it
// read-only and the Studio marketplace hub (My Published) is where it's set.

import type { MarketplaceCreatorProfile } from "../../utils/cloud";

const USERNAME_KEY = "stuard_marketplace_username";
// Legacy store written by the previous creator-profile UI — we still read it so
// existing publishers keep their handle without re-entering it.
const LEGACY_PROFILE_KEY = "stuard_marketplace_creator_profile";

const USERNAME_CHANGED_EVENT = "stuard:marketplace-username-changed";

/** Lowercase, url-safe handle: a–z, 0–9, dash, underscore. */
export function normalizeUsername(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function getMarketplaceUsername(): string {
  try {
    const direct = localStorage.getItem(USERNAME_KEY);
    if (direct && direct.trim()) return normalizeUsername(direct);
    // Fall back to the legacy creator profile's handle (one-time migration read).
    const legacyRaw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<MarketplaceCreatorProfile>;
      const handle = legacy.handle || legacy.display_name || "";
      if (handle) return normalizeUsername(handle);
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function setMarketplaceUsername(raw: string): string {
  const username = normalizeUsername(raw);
  try {
    if (username) localStorage.setItem(USERNAME_KEY, username);
    else localStorage.removeItem(USERNAME_KEY);
    window.dispatchEvent(new CustomEvent(USERNAME_CHANGED_EVENT, { detail: username }));
  } catch {
    /* ignore */
  }
  return username;
}

/** Subscribe to username changes (so open modals stay in sync). Returns an unsubscribe. */
export function onMarketplaceUsernameChanged(cb: (username: string) => void): () => void {
  const handler = (e: Event) => cb(String((e as CustomEvent).detail || ""));
  window.addEventListener(USERNAME_CHANGED_EVENT, handler);
  return () => window.removeEventListener(USERNAME_CHANGED_EVENT, handler);
}

/**
 * Build the creator profile payload the marketplace API still expects, derived
 * entirely from the one username. Display name == @handle so listings read
 * consistently without a separate name field.
 */
export function creatorProfileFromUsername(username: string): Partial<MarketplaceCreatorProfile> {
  const handle = normalizeUsername(username);
  return { handle, display_name: handle ? `@${handle}` : "" };
}
