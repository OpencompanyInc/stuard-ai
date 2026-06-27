/**
 * BYOK key resolver. Single entry point for "what key should we use for
 * this user + provider".
 *
 * Resolution order:
 *   1. If the user has an enabled BYOK row for the provider → use it.
 *   2. Otherwise → null (caller falls back to the friendly-owned env-var key).
 *
 * Plaintext keys held only in a short-lived in-memory cache (60s TTL).
 * Cache is invalidated on upsert/delete by ../routes/byok.ts.
 */

import {
  resolveProviderKeyWithSecret,
  markProviderKeyUsed,
  writeAuditLog,
  listProviderKeys,
} from './storage';
import { type Provider, type ResolvedProviderKey } from './types';

interface CacheEntry {
  resolved: ResolvedProviderKey | null;
  fetchedAtMs: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, provider: Provider, label: string): string {
  return `${userId}:${provider}:${label}`;
}

/**
 * Returns the user's resolved BYOK key for a provider, or null when the
 * user has no enabled key (caller should fall back to the friendly env
 * key).
 *
 * Marks last_used_at + writes a 'use' audit-log row when a BYOK key is
 * actually returned. Both are best-effort and never block the call.
 */
export async function getUserApiKey(
  userId: string | null | undefined,
  provider: Provider,
  label: string = 'default',
): Promise<ResolvedProviderKey | null> {
  if (!userId) return null;
  const key = cacheKey(userId, provider, label);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return cached.resolved;
  }

  let resolved: ResolvedProviderKey | null = null;
  try {
    resolved = await resolveProviderKeyWithSecret(userId, provider, label);
  } catch (e: any) {
    console.warn(`[byok] resolve failed for ${provider}:`, e?.message || e);
    resolved = null;
  }

  cache.set(key, { resolved, fetchedAtMs: Date.now() });

  if (resolved) {
    // Fire-and-forget side effects.
    void markProviderKeyUsed(resolved.id);
    void writeAuditLog({
      userId,
      provider,
      keyId: resolved.id,
      action: 'use',
    });
  }

  return resolved;
}

/**
 * Whether a request that claims `modelSource` byok/subscription is actually
 * backed by a real user credential. Used to bypass the Stuard credit gate for
 * users who pay for their own inference (BYOK key or ChatGPT/Codex subscription)
 * — they must not be blocked just because their Stuard credit balance is 0.
 *
 * We verify the credential server-side rather than trusting the client's
 * `modelSource` flag, so a 0-credit user can't spoof it to get the (Stuard-
 * billed) router/model-tier LLM call for free. Returns false for any other
 * source (auto/stuard/friendly), which keeps the normal credit gate in force.
 */
export async function userHasUserFundedInference(
  userId: string | null | undefined,
  modelSource: unknown,
): Promise<boolean> {
  if (!userId) return false;
  const raw = String(modelSource || '').trim().toLowerCase();
  const isSubscription = raw === 'subscription' || raw === 'chatgpt' || raw === 'codex';
  const isByok = raw === 'byok' || raw === 'api_key' || raw === 'api-key';
  if (!isSubscription && !isByok) return false;

  try {
    if (isSubscription) {
      return (await getUserApiKey(userId, 'codex_subscription')) != null;
    }
    // BYOK: at least one enabled provider key that isn't the codex subscription.
    const keys = await listProviderKeys(userId);
    return keys.some((k) => k.enabled !== false && k.provider !== 'codex_subscription');
  } catch (e: any) {
    console.warn('[byok] userHasUserFundedInference check failed:', e?.message || e);
    return false;
  }
}

/** Drop cache entries for a user (on key change/delete/toggle). */
export function invalidateUserCache(userId: string, provider?: Provider): void {
  for (const k of Array.from(cache.keys())) {
    if (!k.startsWith(`${userId}:`)) continue;
    if (provider && !k.startsWith(`${userId}:${provider}:`)) continue;
    cache.delete(k);
  }
}

/** Test helper. */
export function _clearAllCacheForTests(): void {
  cache.clear();
}
