/**
 * BYOK (Bring Your Own Key) provider types.
 *
 * Keep the `Provider` union in sync with the CHECK constraint in
 * infra/supabase/migrations/20260514000000_user_provider_keys.sql and the
 * provider strings used by buildProviderModel in ../utils/models.ts.
 */

export const BYOK_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'openrouter',
  'openai_compatible',
  'codex_subscription',
] as const;
// codex_subscription is special: tokens are NOT acquired by an OAuth flow
// in cloud-ai. The user runs `codex login` locally (the CLI does the
// official OpenAI OAuth and stores tokens in ~/.codex/auth.json). The
// desktop reads that file and POSTs the tokens to /v1/byok/codex/import;
// cloud-ai then uses them to call https://chatgpt.com/backend-api/codex/
// responses with our tools array attached.

export type Provider = (typeof BYOK_PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Public-facing provider key metadata. Plaintext key material is NEVER
 * included — only safe-to-display fields. This is what the UI sees.
 */
export interface ProviderKeyPublic {
  id: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  last_four: string | null;
  base_url: string | null;
  account_email: string | null;
  /** Codex only: access-token expiry. Cloud surfaces this so the desktop
   *  can decide when to push a refreshed token. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

/**
 * Internal-only shape used by the key resolver. Includes the decrypted
 * plaintext API key. NEVER serialize this over HTTP.
 */
export interface ResolvedProviderKey {
  id: string;
  provider: Provider;
  /** API key (most providers) or OAuth access_token (codex_subscription). */
  apiKey: string;
  baseUrl: string | null;
  /** Codex only — used to refresh when the access token 401s. */
  refreshToken?: string | null;
  expiresAt?: string | null;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'enable'
  | 'disable'
  | 'test'
  | 'use'
  | 'rotate'
  | 'codex_import'
  | 'codex_token_expired';
