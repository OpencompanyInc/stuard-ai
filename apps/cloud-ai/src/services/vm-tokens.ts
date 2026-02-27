/**
 * VM Token Service
 * 
 * Mints and verifies short-lived HMAC tokens for cloud-ai → VM authentication.
 * 
 * Security model: Each VM has its own unique secret (`vm_secret` column in cloud_engines).
 * Tokens are signed with that per-VM secret, so compromising one VM cannot
 * be used to forge tokens for another VM.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes (ultra short-lived for per-request auth)

interface VMTokenPayload {
  userId: string;
  instanceName: string;
  nonce: string;   // random per-token to prevent replay
  iat: number;
  exp: number;
}

// Simple HMAC-based token (lighter than full JWT library)
function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Generate a cryptographically random per-VM secret (32 bytes, hex-encoded).
 * Called once at provisioning time and stored in the cloud_engines table.
 */
export function generateVMSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Mint a short-lived token for a specific VM.
 * @param secret  The per-VM HMAC secret from the cloud_engines table.
 * @param userId  The userId this token is for (or 'cloud-ai-monitor' for system calls).
 * @param instanceName  Descriptive label for the caller (e.g., 'cloud-ai-command').
 */
export function mintVMToken(secret: string, userId: string, instanceName: string): string {
  const payload: VMTokenPayload = {
    userId,
    instanceName,
    nonce: randomBytes(8).toString('hex'),
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify a VM token and extract the payload.
 * @param token   The token string (base64url payload + '.' + base64url HMAC).
 * @param secret  The per-VM HMAC secret.
 * Returns null if the token is invalid or expired.
 */
export function verifyVMToken(token: string, secret: string): VMTokenPayload | null {
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    // Verify signature using constant-time comparison (prevents timing attacks)
    const expectedSig = sign(encodedPayload, secret);
    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

    // Decode payload
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(raw) as VMTokenPayload;

    // Check expiry
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
