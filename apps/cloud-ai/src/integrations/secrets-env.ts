/**
 * Temporary env-var secret loader for the declarative-integration test phase.
 *
 * Resolves declared auth fields against process.env using the convention:
 *   INT_<SLUG_UPPER_SNAKE>_<FIELD_UPPER_SNAKE>
 * e.g. for slug "stripe", field "secret_key" → INT_STRIPE_SECRET_KEY
 *
 * This file is the swap-out point. When the encrypted vault lands the
 * caller signature stays the same — every other module continues to use
 * resolveDeclaredSecrets() without changes.
 */

import type { AuthField } from './types';

/** Convert a manifest slug or field name to UPPER_SNAKE_CASE. */
function envKey(slug: string, field: string): string {
  const norm = (s: string) => s.replace(/[-.]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  return `INT_${norm(slug)}_${norm(field)}`;
}

/**
 * Read declared secrets from the environment. Required fields that resolve
 * to empty strings cause a thrown error so the caller can fail loudly
 * before making an outbound request with a half-empty Authorization header.
 */
export function resolveDeclaredSecrets(
  slug: string,
  fields: AuthField[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const key = envKey(slug, field.name);
    const value = (process.env[key] || '').trim();
    if (value) {
      out[field.name] = value;
    } else if (field.required) {
      missing.push(`${field.name} (set ${key})`);
    }
  }

  if (missing.length) {
    throw new Error(
      `Missing required secrets for integration "${slug}": ${missing.join(', ')}`,
    );
  }
  return out;
}

/** Inverse of envKey — exposed only for the CLI help output. */
export function expectedEnvVar(slug: string, field: string): string {
  return envKey(slug, field);
}
