/**
 * VM Token Service
 * 
 * Mints and verifies short-lived JWTs for VM agent authentication
 * back to cloud-ai.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { VM_TOKEN_SECRET } from '../utils/config';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VMTokenPayload {
  userId: string;
  instanceName: string;
  iat: number;
  exp: number;
}

// Simple HMAC-based token (lighter than full JWT library)
function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', VM_TOKEN_SECRET).update(payload).digest('base64url');
}

/**
 * Mint a short-lived token for a VM to authenticate with cloud-ai.
 */
export function mintVMToken(userId: string, instanceName: string): string {
  const payload: VMTokenPayload = {
    userId,
    instanceName,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify a VM token and extract the payload.
 * Returns null if the token is invalid or expired.
 */
export function verifyVMToken(token: string): VMTokenPayload | null {
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    // Verify signature using constant-time comparison (prevents timing attacks)
    const expectedSig = sign(encodedPayload);
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
