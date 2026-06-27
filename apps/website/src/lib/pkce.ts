import { createHash, randomBytes } from 'crypto';

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function randomState(): string {
  return base64UrlEncode(randomBytes(24));
}

export function generatePkcePair(): { code_verifier: string; code_challenge: string } {
  const code_verifier = base64UrlEncode(randomBytes(32));
  const digest = createHash('sha256').update(code_verifier).digest();
  const code_challenge = base64UrlEncode(digest);
  return { code_verifier, code_challenge };
}
