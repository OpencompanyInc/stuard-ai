/**
 * Short-TTL in-memory staging for freshly-minted OAuth tokens awaiting pickup
 * by the user's desktop, which stores them in its own encrypted local store.
 *
 * Why this exists: under the device-only token model, the OAuth callback runs
 * as a plain browser redirect on cloud-ai with no live bridge to the desktop
 * (the desktop's Python agent does not register as a server-side connection).
 * So the callback can't push the token. Instead it stages the token here, and
 * the desktop — which initiated the connect and holds a Bearer JWT — claims it
 * over an authenticated HTTP endpoint within the TTL. The token is held only in
 * memory, deleted on claim, and never written to Supabase.
 *
 * VM connects do NOT use this path — the VM has a live command channel and is
 * pushed to directly (storeOAuthTokensOnVM).
 */

export interface ClaimableToken {
  provider: string;
  profileLabel: string;
  isDefault: boolean;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  accountEmail: string | null;
}

interface StagedEntry {
  tokens: ClaimableToken[];
  expiresAtMs: number;
}

const TTL_MS = 2 * 60 * 1000; // 2 minutes — desktop polls right after consent
const MAX_TOKENS_PER_USER = 20; // bound memory; far above any real connect burst

// userId → staged tokens. Multiple connects before a claim accumulate.
const staged = new Map<string, StagedEntry>();

function purgeExpired(now = Date.now()): void {
  for (const [userId, entry] of staged.entries()) {
    if (entry.expiresAtMs <= now) staged.delete(userId);
  }
}

/**
 * Stage one or more tokens for a user to claim. Merges with any already-staged
 * tokens, replacing a prior entry for the same (provider, profileLabel) so a
 * re-connect supersedes a stale stage. Refreshes the TTL.
 */
export function stageTokensForClaim(userId: string, tokens: ClaimableToken[]): void {
  if (!userId || !Array.isArray(tokens) || tokens.length === 0) return;
  purgeExpired();
  const now = Date.now();
  const existing = staged.get(userId);
  const prior = existing && existing.expiresAtMs > now ? existing.tokens : [];
  const sameAccount = (a: ClaimableToken, b: ClaimableToken) =>
    a.provider.toLowerCase() === b.provider.toLowerCase() && a.profileLabel === b.profileLabel;
  const kept = prior.filter((p) => !tokens.some((t) => sameAccount(p, t)));
  const merged = [...kept, ...tokens].slice(-MAX_TOKENS_PER_USER);
  staged.set(userId, { tokens: merged, expiresAtMs: now + TTL_MS });
}

/**
 * Atomically return and remove all staged tokens for a user. Returns [] when
 * nothing is pending (or it expired). One-time read by design.
 */
export function claimTokens(userId: string): ClaimableToken[] {
  if (!userId) return [];
  purgeExpired();
  const entry = staged.get(userId);
  if (!entry) return [];
  staged.delete(userId);
  return entry.tokens;
}

// Periodic sweep so abandoned stages (user closed the app mid-connect) don't
// linger in memory until the next stage/claim touches the map.
const sweepTimer = setInterval(() => purgeExpired(), 60_000);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
