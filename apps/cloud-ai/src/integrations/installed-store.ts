/**
 * Storage for deployed (user-authored) custom integrations.
 *
 * Owns the `custom_integrations` table. Secret material is encrypted at rest
 * with the same per-user envelope encryption (encryptForUser / HKDF from
 * TOKEN_ENCRYPTION_PEPPER) that external_accounts and user_provider_keys use —
 * plaintext secrets are never persisted and never returned from any function
 * that doesn't have "Secrets" in its name.
 *
 * The list/read interface deliberately strips secrets so route handlers can
 * return manifests to the desktop without leaking credentials.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseService } from '../supabase';
import {
  encryptForUser,
  decryptForUser,
  type EncryptedField,
} from '../utils/token-encryption';
import type { IntegrationManifest } from './types';

const COLS =
  'user_id, slug, name, description, icon, category, version, manifest, secrets_encrypted, enabled, created_at, updated_at';

type SecretsEncrypted = Record<string, EncryptedField>;

interface CustomIntegrationRow {
  user_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  category: string | null;
  version: string;
  manifest: IntegrationManifest;
  secrets_encrypted: SecretsEncrypted | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Public shape returned to clients — manifest + flags, no secret material. */
export interface InstalledIntegrationPublic {
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  category: string | null;
  version: string;
  manifest: IntegrationManifest;
  enabled: boolean;
  /** Names of auth fields that currently have a stored value (not the values). */
  configuredSecrets: string[];
  createdAt: string;
  updatedAt: string;
}

/** Internal shape used by the tool compiler / run route — includes plaintext secrets. */
export interface InstalledIntegrationWithSecrets {
  slug: string;
  manifest: IntegrationManifest;
  secrets: Record<string, string>;
  enabled: boolean;
}

function requireSupabase(): SupabaseClient {
  const sb = getSupabaseService();
  if (!sb) throw new Error('supabase_service_not_configured');
  return sb;
}

function toPublic(row: CustomIntegrationRow): InstalledIntegrationPublic {
  return {
    slug: row.slug,
    name: row.name || row.manifest?.name || row.slug,
    description: row.description || row.manifest?.description || '',
    icon: row.icon ?? row.manifest?.icon ?? null,
    category: row.category ?? row.manifest?.category ?? null,
    version: row.version || row.manifest?.version || '0.1.0',
    manifest: row.manifest,
    enabled: !!row.enabled,
    configuredSecrets: Object.keys(row.secrets_encrypted || {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decryptSecrets(userId: string, enc: SecretsEncrypted | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!enc) return out;
  for (const [field, value] of Object.entries(enc)) {
    try {
      const plain = decryptForUser(userId, value);
      if (plain != null) out[field] = plain;
    } catch {
      // A field that fails to decrypt (e.g. pepper rotated without re-encrypt)
      // is simply absent — the executor will surface a missing-secret error.
    }
  }
  return out;
}

/** List a user's deployed integrations (no secrets). */
export async function listInstalled(userId: string): Promise<InstalledIntegrationPublic[]> {
  const sb = getSupabaseService();
  if (!sb) return [];
  const { data, error } = await sb
    .from('custom_integrations')
    .select(COLS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as CustomIntegrationRow[]).map(toPublic);
}

/** One integration by slug (no secrets). */
export async function getInstalled(userId: string, slug: string): Promise<InstalledIntegrationPublic | null> {
  const sb = getSupabaseService();
  if (!sb) return null;
  const { data, error } = await sb
    .from('custom_integrations')
    .select(COLS)
    .eq('user_id', userId)
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return toPublic(data as unknown as CustomIntegrationRow);
}

/**
 * Load enabled integrations with decrypted secrets for tool compilation.
 * Memory-only result — callers must not log or persist the secrets.
 */
export async function getEnabledWithSecrets(userId: string): Promise<InstalledIntegrationWithSecrets[]> {
  const sb = getSupabaseService();
  if (!sb) return [];
  const { data, error } = await sb
    .from('custom_integrations')
    .select(COLS)
    .eq('user_id', userId)
    .eq('enabled', true);
  if (error || !data) return [];
  return (data as unknown as CustomIntegrationRow[]).map((row) => ({
    slug: row.slug,
    manifest: row.manifest,
    secrets: decryptSecrets(userId, row.secrets_encrypted),
    enabled: !!row.enabled,
  }));
}

/** Decrypted secrets for a single integration (used by the run route). */
export async function getDecryptedSecrets(userId: string, slug: string): Promise<{ manifest: IntegrationManifest; secrets: Record<string, string> } | null> {
  const sb = getSupabaseService();
  if (!sb) return null;
  const { data, error } = await sb
    .from('custom_integrations')
    .select(COLS)
    .eq('user_id', userId)
    .eq('slug', slug)
    .eq('enabled', true)
    .single();
  if (error || !data) return null;
  const row = data as unknown as CustomIntegrationRow;
  return { manifest: row.manifest, secrets: decryptSecrets(userId, row.secrets_encrypted) };
}

/**
 * Deploy / update an integration. Secrets are merged: any field provided with a
 * non-empty value is (re-)encrypted; fields omitted keep their stored value, so
 * the user can redeploy an edited manifest without re-entering credentials.
 */
export async function upsertInstalled(
  userId: string,
  manifest: IntegrationManifest,
  secrets: Record<string, string> = {},
  enabled = true,
): Promise<InstalledIntegrationPublic> {
  const sb = requireSupabase();

  // Start from existing encrypted secrets so omitted fields survive a redeploy.
  const { data: existing } = await sb
    .from('custom_integrations')
    .select('secrets_encrypted')
    .eq('user_id', userId)
    .eq('slug', manifest.slug)
    .single();
  const merged: SecretsEncrypted = { ...((existing as any)?.secrets_encrypted || {}) };

  // Only keep secrets for fields the manifest actually declares.
  const declared = new Set((manifest.auth?.fields || []).map((f) => f.name));
  for (const key of Object.keys(merged)) {
    if (!declared.has(key)) delete merged[key];
  }
  for (const [field, value] of Object.entries(secrets)) {
    if (!declared.has(field)) continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    const enc = encryptForUser(userId, value);
    if (enc) merged[field] = enc;
  }

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('custom_integrations')
    .upsert(
      {
        user_id: userId,
        slug: manifest.slug,
        name: manifest.name || manifest.slug,
        description: manifest.description || '',
        icon: manifest.icon ?? null,
        category: manifest.category ?? null,
        version: manifest.version || '0.1.0',
        manifest,
        secrets_encrypted: merged,
        enabled,
        updated_at: now,
      },
      { onConflict: 'user_id,slug' },
    )
    .select(COLS)
    .single();
  if (error || !data) throw new Error(error?.message || 'upsert_failed');
  return toPublic(data as unknown as CustomIntegrationRow);
}

export async function setEnabled(userId: string, slug: string, enabled: boolean): Promise<boolean> {
  const sb = getSupabaseService();
  if (!sb) return false;
  const { error } = await sb
    .from('custom_integrations')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('slug', slug);
  return !error;
}

export async function removeInstalled(userId: string, slug: string): Promise<boolean> {
  const sb = getSupabaseService();
  if (!sb) return false;
  const { error } = await sb
    .from('custom_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('slug', slug);
  return !error;
}
