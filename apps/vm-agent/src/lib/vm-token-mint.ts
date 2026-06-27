/**
 * VM Token Minting (VM side)
 *
 * Mints short-lived HMAC tokens that cloud-ai verifies via its per-VM
 * `vm_secret` (stored in cloud_engines). The verification side lives in
 * `apps/cloud-ai/src/services/vm-tokens.ts` (`verifyVMToken`); they must
 * stay byte-compatible (same payload shape, same base64url + sha256 HMAC).
 */

import { createHmac, randomBytes } from 'crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface VMTokenPayload {
  userId: string;
  instanceName: string;
  nonce: string;
  iat: number;
  exp: number;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

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
