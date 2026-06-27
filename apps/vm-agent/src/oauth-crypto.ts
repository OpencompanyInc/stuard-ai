import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * At-rest encryption for the VM's local OAuth token store.
 *
 * Threat model: a leak of the VM's disk / agent-data dir (snapshot, backup,
 * stray `cat oauth-tokens.json`) must not expose any plaintext OAuth tokens.
 *
 * Key material: the VM already holds a per-instance HMAC secret
 * (`VM_TOKEN_SECRET`, see migration 20260227_vm_per_instance_secret.sql —
 * unique per VM, service-role only, never exposed to users). We derive a
 * dedicated AES key from it via HKDF-SHA256 with a distinct `info` label so
 * the encryption key is domain-separated from the token-signing use of the
 * same secret. Because the secret is per-VM, compromising one VM's disk does
 * not help decrypt any other VM's tokens.
 *
 *   key = HKDF(VM_TOKEN_SECRET, salt = STUARD_USER_ID, info = 'vm-oauth-token-enc:v1')
 *
 * Algorithm: AES-256-GCM, 12-byte random IV, 16-byte tag. The blob is a
 * self-describing single line: `v1:<b64 iv>:<b64 tag>:<b64 ciphertext>`.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const VERSION = 'v1';
const INFO = 'vm-oauth-token-enc:v1';

function getSecret(): Buffer | null {
  const raw = (process.env.VM_TOKEN_SECRET || '').trim();
  if (!raw) return null;
  // Per-instance secret is hex (64 chars); fall back to utf8 for safety.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 64) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'utf8');
}

function deriveKey(): Buffer {
  const secret = getSecret();
  if (!secret) throw new Error('VM_TOKEN_SECRET is not set — cannot encrypt OAuth tokens');
  const userId = (process.env.STUARD_USER_ID || '').trim();
  const salt = Buffer.from(userId, 'utf8'); // empty salt is valid for HKDF
  const out = hkdfSync('sha256', secret, salt, Buffer.from(INFO, 'utf8'), KEY_LEN);
  return Buffer.from(out);
}

/** True when a key can be derived (i.e. VM_TOKEN_SECRET is present). */
export function isOAuthEncryptionAvailable(): boolean {
  return getSecret() !== null;
}

/** True when a blob string looks like our encrypted format (vs. legacy plaintext JSON). */
export function isEncryptedBlob(blob: string): boolean {
  return typeof blob === 'string' && blob.startsWith(VERSION + ':');
}

export function encryptOAuthBlob(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptOAuthBlob(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('unrecognized oauth blob format');
  }
  const key = deriveKey();
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
