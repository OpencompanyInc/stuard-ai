/**
 * Local SQLite-based store for OAuth tokens.
 * Tokens persist across restarts without requiring Supabase sync.
 *
 * Sensitive fields (access_token, refresh_token) are encrypted at rest
 * with AES-256-GCM using INTEGRATION_STATE_SECRET as key material.
 *
 * Database: {DATA_DIR}/external-accounts.db
 */

import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { INTEGRATION_STATE_SECRET } from '../utils/config';
import type { ExternalAccount } from '../supabase';

// ─── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.STUARD_DATA_DIR || join(process.cwd(), '.data');
const DB_FILE = join(DATA_DIR, 'external-accounts.db');

// ─── Crypto helpers ──────────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  return createHash('sha256').update(INTEGRATION_STATE_SECRET).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as base64: iv + tag + ciphertext
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const blob = Buffer.from(encoded, 'base64');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ─── Database ────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  _db = new Database(DB_FILE);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS external_accounts (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      provider       TEXT NOT NULL,
      profile_label  TEXT NOT NULL,
      is_default     INTEGER NOT NULL DEFAULT 0,
      account_email  TEXT,
      scopes         TEXT NOT NULL DEFAULT '[]',
      access_token   TEXT NOT NULL,
      refresh_token  TEXT,
      expires_at     TEXT,
      meta           TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE(user_id, provider, profile_label)
    );
    CREATE INDEX IF NOT EXISTS idx_ea_user_provider
      ON external_accounts(user_id, provider);
  `);
  return _db;
}

// ─── Row helpers ─────────────────────────────────────────────────────────────

function rowToAccount(row: any): ExternalAccount {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    profile_label: row.profile_label,
    is_default: !!row.is_default,
    account_email: row.account_email ?? null,
    scopes: JSON.parse(row.scopes || '[]'),
    access_token: decrypt(row.access_token),
    refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null,
    expires_at: row.expires_at ?? null,
    meta: row.meta ? JSON.parse(row.meta) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Public API (mirrors supabase external account functions) ────────────────

export async function localGetExternalAccount(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<ExternalAccount | null> {
  const d = db();
  if (profileLabel) {
    // Try matching by profile_label first
    const byLabel = d.prepare(
      'SELECT * FROM external_accounts WHERE user_id = ? AND provider = ? AND profile_label = ?',
    ).get(userId, provider, profileLabel);
    if (byLabel) return rowToAccount(byLabel);
    // Fallback: match by account_email (AI may pass email instead of label)
    const byEmail = d.prepare(
      'SELECT * FROM external_accounts WHERE user_id = ? AND provider = ? AND account_email = ?',
    ).get(userId, provider, profileLabel);
    if (byEmail) return rowToAccount(byEmail);
    return null;
  }
  // Default profile
  const defaultAcc = d.prepare(
    'SELECT * FROM external_accounts WHERE user_id = ? AND provider = ? AND is_default = 1',
  ).get(userId, provider);
  if (defaultAcc) return rowToAccount(defaultAcc);
  // Fallback: oldest
  const oldest = d.prepare(
    'SELECT * FROM external_accounts WHERE user_id = ? AND provider = ? ORDER BY created_at ASC LIMIT 1',
  ).get(userId, provider);
  return oldest ? rowToAccount(oldest) : null;
}

export async function localListExternalAccounts(
  userId: string,
  provider?: string,
): Promise<ExternalAccount[]> {
  const d = db();
  const rows = provider
    ? d.prepare(
        'SELECT * FROM external_accounts WHERE user_id = ? AND provider = ? ORDER BY is_default DESC, created_at ASC',
      ).all(userId, provider)
    : d.prepare(
        'SELECT * FROM external_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
      ).all(userId);
  return rows.map(rowToAccount);
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
  const d = db();
  const profileLabel = input.profileLabel || 'default';
  const now = new Date().toISOString();

  const existing = d.prepare(
    'SELECT id, is_default, created_at FROM external_accounts WHERE user_id = ? AND provider = ? AND profile_label = ?',
  ).get(input.userId, input.provider, profileLabel) as any;

  const isFirstProfile = !d.prepare(
    'SELECT 1 FROM external_accounts WHERE user_id = ? AND provider = ? LIMIT 1',
  ).get(input.userId, input.provider);

  const id = existing?.id ?? randomBytes(16).toString('hex');
  const isDefault = existing ? existing.is_default : (isFirstProfile ? 1 : 0);
  const createdAt = existing?.created_at ?? now;
  const scopes = JSON.stringify(Array.isArray(input.scopes) ? input.scopes : []);
  const meta = input.meta != null ? JSON.stringify(input.meta) : null;
  const encAccessToken = encrypt(input.access_token);
  const encRefreshToken = input.refresh_token ? encrypt(input.refresh_token) : null;

  d.prepare(`
    INSERT INTO external_accounts (id, user_id, provider, profile_label, is_default, account_email, scopes, access_token, refresh_token, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider, profile_label) DO UPDATE SET
      account_email = excluded.account_email,
      scopes = excluded.scopes,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      meta = excluded.meta,
      updated_at = excluded.updated_at
  `).run(
    id, input.userId, input.provider, profileLabel,
    isDefault, input.accountEmail ?? null,
    scopes, encAccessToken,
    encRefreshToken, input.expires_at ?? null,
    meta, createdAt, now,
  );
}

export async function localSetDefaultExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const d = db();
  const now = new Date().toISOString();
  const txn = d.transaction(() => {
    d.prepare(
      'UPDATE external_accounts SET is_default = 0, updated_at = ? WHERE user_id = ? AND provider = ?',
    ).run(now, userId, provider);
    const result = d.prepare(
      'UPDATE external_accounts SET is_default = 1, updated_at = ? WHERE user_id = ? AND provider = ? AND profile_label = ?',
    ).run(now, userId, provider, profileLabel);
    return result.changes > 0;
  });
  return txn();
}

export async function localDeleteExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const d = db();
  const now = new Date().toISOString();
  const txn = d.transaction(() => {
    const row = d.prepare(
      'SELECT is_default FROM external_accounts WHERE user_id = ? AND provider = ? AND profile_label = ?',
    ).get(userId, provider, profileLabel) as any;
    if (!row) return false;

    d.prepare(
      'DELETE FROM external_accounts WHERE user_id = ? AND provider = ? AND profile_label = ?',
    ).run(userId, provider, profileLabel);

    if (row.is_default) {
      const next = d.prepare(
        'SELECT profile_label FROM external_accounts WHERE user_id = ? AND provider = ? ORDER BY created_at ASC LIMIT 1',
      ).get(userId, provider) as any;
      if (next) {
        d.prepare(
          'UPDATE external_accounts SET is_default = 1, updated_at = ? WHERE user_id = ? AND provider = ? AND profile_label = ?',
        ).run(now, userId, provider, next.profile_label);
      }
    }
    return true;
  });
  return txn();
}

export async function localGetExternalAccessToken(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<string | null> {
  const acc = await localGetExternalAccount(userId, provider, profileLabel);
  return acc?.access_token || null;
}
