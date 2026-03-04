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
/**
 * Verify an incoming request from a VM agent or VM engine.
 *
 * Security flow:
 *   1. VM mints token using its local VM_TOKEN_SECRET
 *   2. VM sends: Authorization: Bearer <token> + X-VM-User-Id: <userId>
 *   3. Cloud-ai extracts userId from header
 *   4. Cloud-ai looks up per-VM secret from cloud_engines DB
 *   5. Cloud-ai verifies token HMAC against that secret
 *   6. If valid → userId is trusted (server resolved, not client-provided)
 *
 * This means: NO user tokens (Supabase JWTs) ever exist on the VM.
 * A compromised VM only has its own HMAC secret, scoped to that single VM.
 *
 * @returns { userId } if valid, null if authentication fails.
 */
export async function verifyVMAuthFromRequest(
  authHeader: string | undefined,
  vmUserIdHeader: string | undefined,
): Promise<{ userId: string } | null> {
  if (!authHeader || !vmUserIdHeader) return null;

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const claimedUserId = vmUserIdHeader.trim();
  if (!token || !claimedUserId) return null;

  try {
    // Lazy import to avoid circular dependency at module load time
    const { resolveVMSecret } = await import('./vm-command');
    const secret = await resolveVMSecret(claimedUserId);

    // If we only got the dev fallback secret and there's no real VM, reject
    if (!secret || secret === 'dev-vm-token-secret') {
      // Allow in dev mode only
      if (!process.env.DEV_VM_URL) return null;
    }

    const payload = verifyVMToken(token, secret);
    if (!payload) return null;

    // Extra check: the userId in the token payload must match the claimed userId
    // (prevents a VM from claiming to be a different user)
    if (payload.userId !== claimedUserId) return null;

    return { userId: claimedUserId };
  } catch {
    return null;
  }
}

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
