import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Per-user envelope encryption for OAuth tokens stored in Supabase.
 *
 * Threat model: a leak of `external_accounts` rows (DB dump, backup,
 * accidental select-with-service-role) should not expose any plaintext
 * tokens. The master pepper lives in `TOKEN_ENCRYPTION_PEPPER` (cloud-ai
 * env / secret manager), never in Postgres.
 *
 * Per-user keys are derived deterministically via HKDF-SHA256:
 *   key = HKDF(pepper, salt=user_id, info=`oauth-token-v{key_version}:{user_id}`)
 * which means a leak of one user's derived key does NOT compromise other
 * users' keys (it would also take the master pepper to compute them).
 *
 * Algorithm: AES-256-GCM, 12-byte random IV per encryption, 16-byte tag.
 * Ciphertext, IV, and tag are stored as base64 strings in their own columns.
 * `key_version` lets us rotate the pepper without bulk re-encrypting all rows.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
export const CURRENT_KEY_VERSION = 1;

function getMasterPepper(): Buffer {
  const raw = (process.env.TOKEN_ENCRYPTION_PEPPER || '').trim();
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_PEPPER is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  let buf: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 64) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'utf8');
  }
  if (buf.length < 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_PEPPER must be at least 32 bytes (64 hex chars). ' +
      `Got ${buf.length} bytes.`,
    );
  }
  return buf;
}

function deriveUserKey(userId: string, version: number = CURRENT_KEY_VERSION): Buffer {
  const pepper = getMasterPepper();
  const salt = Buffer.from(userId, 'utf8');
  const info = Buffer.from(`oauth-token-v${version}:${userId}`, 'utf8');
  const out = hkdfSync('sha256', pepper, salt, info, KEY_LEN);
  return Buffer.from(out);
}

export interface EncryptedField {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
  key_version: number;
}

export function encryptForUser(
  userId: string,
  plaintext: string | null | undefined,
): EncryptedField | null {
  if (plaintext == null || plaintext === '') return null;
  const key = deriveUserKey(userId, CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    key_version: CURRENT_KEY_VERSION,
  };
}

export function decryptForUser(
  userId: string,
  field: EncryptedField | null | undefined,
): string | null {
  if (!field?.ciphertext || !field?.iv || !field?.tag) return null;
  const version = field.key_version || CURRENT_KEY_VERSION;
  const key = deriveUserKey(userId, version);
  const iv = Buffer.from(field.iv, 'base64');
  const tag = Buffer.from(field.tag, 'base64');
  const ct = Buffer.from(field.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** True when the pepper is configured. Lets callers fail fast at startup. */
export function isEncryptionConfigured(): boolean {
  try {
    getMasterPepper();
    return true;
  } catch {
    return false;
  }
}
