-- Encrypted columns for OAuth tokens in external_accounts.
--
-- Cloud-ai is now the single source of truth for integration tokens (the
-- desktop-local store has been removed). To make Supabase rest-encryption
-- meaningful even against a row-level leak, the sensitive token fields are
-- now stored as AES-256-GCM ciphertext, with per-user keys derived in
-- cloud-ai via HKDF(TOKEN_ENCRYPTION_PEPPER, user_id, version).
--
-- The plaintext `access_token` / `refresh_token` columns become NULL-able so
-- existing rows continue working until their next write. New writes always
-- populate the encrypted columns and null out the plaintext counterparts.
-- A follow-up migration will drop the plaintext columns once backfill is
-- complete.

ALTER TABLE public.external_accounts
  ADD COLUMN IF NOT EXISTS access_token_ct  TEXT,
  ADD COLUMN IF NOT EXISTS access_token_iv  TEXT,
  ADD COLUMN IF NOT EXISTS access_token_tag TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_ct  TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_iv  TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_tag TEXT,
  ADD COLUMN IF NOT EXISTS key_version SMALLINT;

-- Allow the plaintext column to be NULL so encrypted-only rows are legal.
-- Pre-existing rows keep their plaintext until cloud-ai re-encrypts them on
-- next read/write.
ALTER TABLE public.external_accounts
  ALTER COLUMN access_token DROP NOT NULL;
