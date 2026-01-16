# PKCE (Proof Key for Code Exchange) — Overview for Stuard AI (Desktop)

This document explains PKCE and how to use it for the Stuard AI desktop app (Electron) when integrating Microsoft OAuth / Microsoft Graph.

---

## What is PKCE?
PKCE (Proof Key for Code Exchange) is an extension to the OAuth 2.0 Authorization Code flow that prevents authorization code interception attacks. It’s designed for public clients (mobile, desktop, SPAs) that cannot safely store a client secret.

## Why use PKCE?
• Prevents an attacker who intercepts an authorization code from exchanging it for tokens (they won’t have the PKCE secret).
• Required/recommended for public clients (Electron desktop app is a public client).

## High-level flow
1. Client (desktop) generates a random `code_verifier` (high-entropy).  
2. Client computes `code_challenge = BASE64URL(SHA256(code_verifier))`.  
3. Client starts the OAuth authorize request and includes `code_challenge` and `code_challenge_method=S256`.  
4. Authorization server authenticates the user and returns an authorization `code` to the redirect URI.  
5. Client sends a token request to the authorization server including the original `code_verifier`.  
6. Authorization server verifies `code_verifier` against previously received `code_challenge` and issues tokens if they match.

## Example TypeScript PKCE helper
```ts
// pkce.ts
import crypto from 'crypto';

export function base64URLEncode(buff: Buffer) {
  return buff
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function sha256(buffer: string) {
  return crypto.createHash('sha256').update(buffer).digest();
}

export function generatePkcePair() {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  return { codeVerifier, codeChallenge };
}
```

## Example authorize URL (Electron desktop using custom URI)
```
https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize?
  client_id={CLIENT_ID}
  &response_type=code
  &redirect_uri=stuardai://auth
  &scope=openid%20profile%20offline_access%20User.Read%20Mail.Read
  &code_challenge={CODE_CHALLENGE}
  &code_challenge_method=S256
  &state={STATE}
```

## Token exchange (desktop public client — include `code_verifier`)
POST to `/token` with:
- `grant_type=authorization_code`
- `code` (the authorization code)
- `redirect_uri` (must match)
- `client_id` (public client id)
- `code_verifier` (the original verifier)

The server will compute `BASE64URL(SHA256(code_verifier))` and verify it matches the stored `code_challenge`.

## Integration notes for Stuard AI (desktop + website)
• Desktop (public client / Electron): use PKCE, no client secret embedded. Generate verifier before opening the system browser and keep it only in memory until the token exchange completes.  
• Website (Next.js): can be a confidential client — perform the server-side code exchange with a client secret.  
• Use the SAME Azure App Registration and add both redirect URIs (web and desktop) so consent is shared.

## Storage & security
• Persist only the refresh token (if needed) and store it securely (Windows Credential Locker, macOS Keychain, or encrypted local storage).  
• Do NOT store client secrets in public clients.  
• Use `offline_access` scope only if you need refresh tokens.  

## Recommendations & checklist
- [ ] Use S256 (`code_challenge_method=S256`).  
- [ ] Generate `code_verifier` with secure random bytes (>=32 bytes).  
- [ ] Register desktop redirect URI (`stuardai://auth` or loopback) in Azure AD.  
- [ ] Use system browser (not embedded webview) for authorization.  
- [ ] Store refresh tokens securely.  
- [ ] Rotate secrets and use Key Vault for server client secrets.

---

If you want, I can add `pkce.ts` to `src/main/` and wire the PKCE flow into `index.ts` (desktop) now. Reply: **scaffold desktop** or **no**.