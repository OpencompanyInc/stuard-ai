-- Drop the legacy plaintext OAuth token columns from external_accounts.
--
-- Tokens are now stored as AES-256-GCM ciphertext in the *_ct / *_iv / *_tag
-- columns (added in 20260512000000_external_accounts_encrypted). The encrypted
-- write path has been nulling the plaintext columns on every write since then;
-- this migration completes the transition by removing them entirely, so a
-- row-level leak can never expose a plaintext token.
--
-- PRECONDITIONS (run in this order):
--   1. Deploy the encrypt-on-write cloud-ai build (already live since 2026-05-12).
--   2. Run the backfill to encrypt any remaining legacy rows:
--        pnpm --filter @stuardai/cloud-ai backfill:oauth-encryption
--        pnpm --filter @stuardai/cloud-ai backfill:oauth-encryption:check   # must report 0
--   3. Deploy the cloud-ai build that no longer SELECTs these columns
--      (supabase.ts: removed from ACCOUNT_COLS / ExternalAccountRow + legacy
--      read fallback). Then apply this migration.
--
-- The guard below makes step 2 non-optional: if any row still holds a plaintext
-- token, the migration aborts instead of silently destroying it.

DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM public.external_accounts
   WHERE access_token IS NOT NULL
      OR refresh_token IS NOT NULL;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop plaintext columns: % row(s) still hold plaintext tokens. Run the encryption backfill first (pnpm --filter @stuardai/cloud-ai backfill:oauth-encryption).',
      remaining;
  END IF;
END$$;

ALTER TABLE public.external_accounts
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;
