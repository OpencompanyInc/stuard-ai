/**
 * BYOK key storage. Owns the user_provider_keys table.
 *
 * Plaintext key material:
 *   - never persisted (only AES-256-GCM ciphertext in *_ct/_iv/_tag columns)
 *   - never returned from any function in this module that doesn't have
 *     "WithSecret" in its name
 *   - never logged
 *
 * All public-facing reads return ProviderKeyPublic, which carries only
 * the last-4 digits + label + flags. The resolver in ./keys.ts is the only
 * place where decryption happens, and the result is held in memory just
 * long enough to make the upstream LLM call.
 */

import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseService } from '../supabase';
import {
  encryptForUser,
  decryptForUser,
  CURRENT_KEY_VERSION,
  type EncryptedField,
} from '../utils/token-encryption';
import {
  type Provider,
  type ProviderKeyPublic,
  type ResolvedProviderKey,
  type AuditAction,
} from './types';

const COLS = [
  'id', 'user_id', 'provider', 'label', 'enabled',
  'key_ct', 'key_iv', 'key_tag',
  'refresh_token_ct', 'refresh_token_iv', 'refresh_token_tag',
  'expires_at', 'key_version',
  'last_four', 'fingerprint', 'base_url', 'account_email', 'meta',
  'created_at', 'updated_at', 'last_used_at',
].join(', ');

interface UserProviderKeyRow {
  id: string;
  user_id: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  key_ct: string | null;
  key_iv: string | null;
  key_tag: string | null;
  refresh_token_ct: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  expires_at: string | null;
  key_version: number;
  last_four: string | null;
  fingerprint: string | null;
  base_url: string | null;
  account_email: string | null;
  meta: any;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

function requireSupabase(): SupabaseClient {
  const sb = getSupabaseService();
  if (!sb) throw new Error('supabase_service_not_configured');
  return sb;
}

function lastFourOf(plaintext: string): string {
  const trimmed = String(plaintext || '').trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
}

/**
 * Stable HMAC fingerprint of the plaintext key. Used for dedup detection
 * ("you already added this key under a different label") without exposing
 * the key. Uses TOKEN_ENCRYPTION_PEPPER as the HMAC key — a leak of
 * fingerprints alone reveals nothing.
 */
function fingerprintOf(plaintext: string): string {
  const pepper = (process.env.TOKEN_ENCRYPTION_PEPPER || '').trim();
  // We don't need the pepper to be 32 bytes for HMAC; UTF-8 bytes are fine.
  // If unset (dev mode without encryption), fall back to a constant — the
  // fingerprint is best-effort and only used for dedup hints.
  return createHmac('sha256', pepper || 'byok-fingerprint-fallback')
    .update(plaintext, 'utf8')
    .digest('hex');
}

function toPublic(row: UserProviderKeyRow): ProviderKeyPublic {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    enabled: !!row.enabled,
    last_four: row.last_four,
    base_url: row.base_url,
    account_email: row.account_email,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
  };
}

function asUserProviderKeyRow(data: unknown): UserProviderKeyRow {
  return data as UserProviderKeyRow;
}

function asUserProviderKeyRows(data: unknown): UserProviderKeyRow[] {
  return data as UserProviderKeyRow[];
}

/** List all of a user's configured provider keys (metadata only). */
export async function listProviderKeys(userId: string): Promise<ProviderKeyPublic[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_provider_keys')
    .select(COLS)
    .eq('user_id', userId)
    .order('provider', { ascending: true });
  if (error) throw error;
  return asUserProviderKeyRows(data || []).map(toPublic);
}

/** Get one provider key (metadata only). */
export async function getProviderKey(
  userId: string,
  provider: Provider,
  label: string = 'default',
): Promise<ProviderKeyPublic | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_provider_keys')
    .select(COLS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('label', label)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublic(asUserProviderKeyRow(data)) : null;
}

export interface UpsertProviderKeyInput {
  provider: Provider;
  label?: string;
  apiKey: string;
  baseUrl?: string | null;
  enabled?: boolean;
  accountEmail?: string | null;
  meta?: any;
}

/**
 * Create or update a provider API key for the user. Plaintext is encrypted
 * before persisting; only metadata is returned.
 */
export async function upsertProviderKey(
  userId: string,
  input: UpsertProviderKeyInput,
): Promise<ProviderKeyPublic> {
  const sb = requireSupabase();
  const label = String(input.label || 'default').slice(0, 80) || 'default';
  const plaintext = String(input.apiKey || '').trim();
  if (!plaintext) throw new Error('api_key_required');

  const enc = encryptForUser(userId, plaintext) as EncryptedField;

  const row: Record<string, any> = {
    user_id: userId,
    provider: input.provider,
    label,
    enabled: input.enabled ?? true,
    key_ct: enc.ciphertext,
    key_iv: enc.iv,
    key_tag: enc.tag,
    key_version: enc.key_version,
    last_four: lastFourOf(plaintext),
    fingerprint: fingerprintOf(plaintext),
    base_url: input.baseUrl?.trim() || null,
    account_email: input.accountEmail?.trim() || null,
    meta: input.meta ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('user_provider_keys')
    .upsert(row, { onConflict: 'user_id,provider,label' })
    .select(COLS)
    .single();
  if (error) throw error;
  return toPublic(asUserProviderKeyRow(data));
}

export async function setProviderKeyEnabled(
  userId: string,
  provider: Provider,
  enabled: boolean,
  label: string = 'default',
): Promise<ProviderKeyPublic | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_provider_keys')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('label', label)
    .select(COLS)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublic(asUserProviderKeyRow(data)) : null;
}

export async function deleteProviderKey(
  userId: string,
  provider: Provider,
  label: string = 'default',
): Promise<boolean> {
  const sb = requireSupabase();
  const { error, count } = await sb
    .from('user_provider_keys')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('label', label);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Decrypt and return the resolved key. INTERNAL — call sites must hold the
 * result only as long as needed for the upstream LLM call. Used by
 * ./keys.ts and the OAuth-refresh flow.
 */
export async function resolveProviderKeyWithSecret(
  userId: string,
  provider: Provider,
  label: string = 'default',
): Promise<ResolvedProviderKey | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_provider_keys')
    .select(COLS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('label', label)
    .eq('enabled', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = asUserProviderKeyRow(data);
  if (!row.key_ct || !row.key_iv || !row.key_tag) return null;

  let apiKey: string | null;
  try {
    apiKey = decryptForUser(userId, {
      ciphertext: row.key_ct,
      iv: row.key_iv,
      tag: row.key_tag,
      key_version: row.key_version || CURRENT_KEY_VERSION,
    });
  } catch (e: any) {
    console.error(`[byok] decrypt failed for ${provider}:`, e?.message || e);
    return null;
  }
  if (!apiKey) return null;

  let refreshToken: string | null = null;
  if (row.refresh_token_ct && row.refresh_token_iv && row.refresh_token_tag) {
    try {
      refreshToken = decryptForUser(userId, {
        ciphertext: row.refresh_token_ct,
        iv: row.refresh_token_iv,
        tag: row.refresh_token_tag,
        key_version: row.key_version || CURRENT_KEY_VERSION,
      });
    } catch {}
  }

  return {
    id: row.id,
    provider: row.provider,
    apiKey,
    baseUrl: row.base_url,
    refreshToken,
    expiresAt: row.expires_at,
  };
}

/**
 * Codex (ChatGPT subscription) token import. Tokens were obtained by the
 * user's local `codex` CLI doing OAuth against OpenAI; the desktop reads
 * ~/.codex/auth.json and POSTs the contents here. We don't run any OAuth
 * flow ourselves — see [[codex-client]] for inference details.
 */
export async function upsertCodexSubscription(
  userId: string,
  input: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    accountEmail?: string | null;
    label?: string;
  },
): Promise<ProviderKeyPublic> {
  const sb = requireSupabase();
  const label = String(input.label || 'default').slice(0, 80) || 'default';
  const access = String(input.accessToken || '').trim();
  if (!access) throw new Error('access_token_required');

  const accessEnc = encryptForUser(userId, access) as EncryptedField;
  const refreshEnc = input.refreshToken
    ? (encryptForUser(userId, input.refreshToken) as EncryptedField)
    : null;

  const row: Record<string, any> = {
    user_id: userId,
    provider: 'codex_subscription' as Provider,
    label,
    enabled: true,
    key_ct: accessEnc.ciphertext,
    key_iv: accessEnc.iv,
    key_tag: accessEnc.tag,
    refresh_token_ct: refreshEnc?.ciphertext ?? null,
    refresh_token_iv: refreshEnc?.iv ?? null,
    refresh_token_tag: refreshEnc?.tag ?? null,
    expires_at: input.expiresAt,
    key_version: accessEnc.key_version,
    last_four: lastFourOf(access),
    fingerprint: fingerprintOf(access),
    base_url: null,
    account_email: input.accountEmail?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('user_provider_keys')
    .upsert(row, { onConflict: 'user_id,provider,label' })
    .select(COLS)
    .single();
  if (error) throw error;
  return toPublic(asUserProviderKeyRow(data));
}

/**
 * Mark a Codex row as having an expired access token by zeroing out the
 * encrypted fields. The next inference call will see no usable key and
 * return codex_token_expired so the desktop can re-push fresh tokens
 * from the local CLI's auth.json (Codex CLI handles its own refresh).
 */
export async function markCodexExpired(userId: string, label: string = 'default'): Promise<void> {
  try {
    const sb = requireSupabase();
    await sb
      .from('user_provider_keys')
      .update({
        key_ct: null, key_iv: null, key_tag: null,
        refresh_token_ct: null, refresh_token_iv: null, refresh_token_tag: null,
        expires_at: new Date(0).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', 'codex_subscription')
      .eq('label', label);
  } catch {}
}

/** Update last_used_at without bumping updated_at. Best-effort. */
export async function markProviderKeyUsed(keyId: string): Promise<void> {
  try {
    const sb = requireSupabase();
    await sb
      .from('user_provider_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);
  } catch {}
}

/** Append-only audit-log write. Plaintext keys MUST NOT be passed in `detail`. */
export async function writeAuditLog(input: {
  userId: string;
  provider: Provider | string;
  keyId?: string | null;
  action: AuditAction;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, any>;
}): Promise<void> {
  try {
    const sb = requireSupabase();
    await sb.from('byok_audit_log').insert({
      user_id: input.userId,
      provider: input.provider,
      key_id: input.keyId ?? null,
      action: input.action,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      detail: input.detail ?? null,
    });
  } catch (e: any) {
    console.warn('[byok] audit log write failed:', e?.message || e);
  }
}

/**
 * Find any other key the user already has with the same plaintext (under
 * a different provider/label). Used to warn on duplicates without exposing
 * the existing key. Returns the matching public metadata or null.
 */
export async function findDuplicateByFingerprint(
  userId: string,
  plaintext: string,
  excludeProvider?: Provider,
  excludeLabel?: string,
): Promise<ProviderKeyPublic | null> {
  const fp = fingerprintOf(plaintext);
  const sb = requireSupabase();
  let q = sb
    .from('user_provider_keys')
    .select(COLS)
    .eq('user_id', userId)
    .eq('fingerprint', fp);
  const { data, error } = await q;
  if (error || !data) return null;
  const rows = asUserProviderKeyRows(data).filter((r) => {
    if (!excludeProvider) return true;
    return !(r.provider === excludeProvider && r.label === (excludeLabel || 'default'));
  });
  return rows.length ? toPublic(rows[0]) : null;
}
