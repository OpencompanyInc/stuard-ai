/**
 * Local encrypted file-based store for OAuth tokens.
 * Tokens are stored locally by default; only synced to Supabase
 * when SYNC_ACCOUNTS=1 is explicitly set.
 *
 * Encryption: AES-256-GCM using INTEGRATION_STATE_SECRET as key material.
 * File: {DATA_DIR}/external-accounts.enc
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { INTEGRATION_STATE_SECRET } from '../utils/config';
import type { ExternalAccount } from '../supabase';

// ─── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.STUARD_DATA_DIR || join(process.cwd(), '.data');
const ACCOUNTS_FILE = join(DATA_DIR, 'external-accounts.enc');

// ─── Crypto helpers ──────────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

/** Derive a 32-byte key from the secret */
function deriveKey(): Buffer {
  return createHash('sha256').update(INTEGRATION_STATE_SECRET).digest();
}

function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv 16B][tag 16B][ciphertext ...]
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(blob: Buffer): string {
  const key = deriveKey();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

interface StoredAccount {
  id: string;
  user_id: string;
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email: string | null;
  scopes: string[];
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  meta: any;
  created_at: string;
  updated_at: string;
}

let cache: StoredAccount[] | null = null;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(): StoredAccount[] {
  if (cache) return cache;
  try {
    if (existsSync(ACCOUNTS_FILE)) {
      const blob = readFileSync(ACCOUNTS_FILE);
      const json = decrypt(blob);
      cache = JSON.parse(json) as StoredAccount[];
      return cache;
    }
  } catch (e: any) {
    console.error('[local-accounts] Failed to load store, starting fresh:', e?.message);
  }
  cache = [];
  return cache;
}

function save(): void {
  ensureDir();
  const json = JSON.stringify(cache ?? [], null, 2);
  const blob = encrypt(json);
  writeFileSync(ACCOUNTS_FILE, blob);
}

// ─── Public API (mirrors supabase external account functions) ────────────────

export async function localGetExternalAccount(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<ExternalAccount | null> {
  const accounts = load();
  if (profileLabel) {
    return accounts.find(
      (a) => a.user_id === userId && a.provider === provider && a.profile_label === profileLabel,
    ) ?? null;
  }
  // Default profile
  const defaultAcc = accounts.find(
    (a) => a.user_id === userId && a.provider === provider && a.is_default,
  );
  if (defaultAcc) return defaultAcc;
  // Fallback: oldest
  const matching = accounts
    .filter((a) => a.user_id === userId && a.provider === provider)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return matching[0] ?? null;
}

export async function localListExternalAccounts(
  userId: string,
  provider?: string,
): Promise<ExternalAccount[]> {
  const accounts = load();
  return accounts
    .filter((a) => a.user_id === userId && (!provider || a.provider === provider))
    .sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });
}

export async function localUpsertExternalAccount(input: {
  userId: string;
  provider: string;
  access_token: string;
  scopes?: string[];
  refresh_token?: string | null;
  expires_at?: string | null;
  meta?: any;
  profileLabel?: string;
  accountEmail?: string | null;
}): Promise<void> {
  const accounts = load();
  const profileLabel = input.profileLabel || 'default';
  const now = new Date().toISOString();

  const isFirstProfile = !accounts.some(
    (a) => a.user_id === input.userId && a.provider === input.provider,
  );

  const idx = accounts.findIndex(
    (a) =>
      a.user_id === input.userId &&
      a.provider === input.provider &&
      a.profile_label === profileLabel,
  );

  const record: StoredAccount = {
    id: idx >= 0 ? accounts[idx].id : randomBytes(16).toString('hex'),
    user_id: input.userId,
    provider: input.provider,
    profile_label: profileLabel,
    is_default: idx >= 0 ? accounts[idx].is_default : isFirstProfile,
    account_email: input.accountEmail ?? null,
    access_token: input.access_token,
    scopes: Array.isArray(input.scopes) ? input.scopes : [],
    refresh_token: input.refresh_token ?? null,
    expires_at: input.expires_at ?? null,
    meta: input.meta ?? null,
    created_at: idx >= 0 ? accounts[idx].created_at : now,
    updated_at: now,
  };

  if (idx >= 0) {
    accounts[idx] = record;
  } else {
    accounts.push(record);
  }

  cache = accounts;
  save();
}

export async function localSetDefaultExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const accounts = load();
  let found = false;
  for (const a of accounts) {
    if (a.user_id === userId && a.provider === provider) {
      a.is_default = a.profile_label === profileLabel;
      a.updated_at = new Date().toISOString();
      if (a.profile_label === profileLabel) found = true;
    }
  }
  if (found) save();
  return found;
}

export async function localDeleteExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const accounts = load();
  const idx = accounts.findIndex(
    (a) => a.user_id === userId && a.provider === provider && a.profile_label === profileLabel,
  );
  if (idx < 0) return false;
  const wasDefault = accounts[idx].is_default;
  accounts.splice(idx, 1);

  // If deleted was default, promote next oldest
  if (wasDefault) {
    const next = accounts
      .filter((a) => a.user_id === userId && a.provider === provider)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (next) {
      next.is_default = true;
      next.updated_at = new Date().toISOString();
    }
  }

  cache = accounts;
  save();
  return true;
}

export async function localGetExternalAccessToken(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<string | null> {
  const acc = await localGetExternalAccount(userId, provider, profileLabel);
  return acc?.access_token || null;
}
