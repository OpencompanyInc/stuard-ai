-- BYOK (Bring Your Own Key) provider keys.
--
-- Stores user-supplied API keys for third-party LLM providers (Anthropic,
-- OpenAI, Google, xAI/Grok, OpenRouter, OpenAI-compatible custom endpoints)
-- and OAuth tokens for ChatGPT/Codex subscription auth. Plaintext key
-- material is NEVER persisted in this table — only AES-256-GCM ciphertext
-- with per-user keys derived via HKDF(TOKEN_ENCRYPTION_PEPPER, user_id) in
-- cloud-ai. Same envelope-encryption pattern as external_accounts.
--
-- Resolution policy (enforced in cloud-ai/src/utils/models.ts):
--   1. If a row exists for (user_id, provider) AND enabled = true AND has a
--      decryptable key, use the user's key. Mark the inference event
--      billing_excluded so credits are not consumed.
--   2. Otherwise fall back to the friendly-owned env var key and bill
--      credits as normal.

create table if not exists public.user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Provider discriminator. Keep in sync with the enum in
  -- apps/cloud-ai/src/byok/types.ts.
  --
  -- codex_subscription holds OAuth tokens obtained by the user's local
  -- Codex CLI (in ~/.codex/auth.json). The desktop reads them and POSTs
  -- to /v1/byok/codex/import; cloud-ai then calls
  -- https://chatgpt.com/backend-api/codex/responses on the user's behalf.
  -- We never run our own OAuth flow for this provider.
  provider text not null check (provider in (
    'anthropic',
    'openai',
    'google',
    'xai',
    'openrouter',
    'openai_compatible',
    'codex_subscription'
  )),

  -- Display label (e.g. "Personal", "Work"). For now we enforce one row per
  -- (user_id, provider); multi-profile support can come later by relaxing
  -- the unique constraint.
  label text not null default 'default',

  -- Opt-in toggle: when false the key is stored but Stuard's friendly-owned
  -- key is used instead. Lets users keep a key on file without committing
  -- to BYOK billing yet.
  enabled boolean not null default true,

  -- Encrypted credential material. For API-key providers this is the
  -- API key; for codex_subscription it's the OAuth access_token.
  -- AES-256-GCM ciphertext + 12-byte IV + 16-byte auth tag, all base64.
  key_ct  text,
  key_iv  text,
  key_tag text,

  -- OAuth refresh token (codex_subscription only). Same encryption as key_ct.
  refresh_token_ct  text,
  refresh_token_iv  text,
  refresh_token_tag text,

  -- Access-token expiry (codex_subscription only). Plaintext for cheap
  -- freshness checks; the token itself is in key_ct.
  expires_at timestamptz,

  key_version smallint not null default 1,

  -- Last-4 of the plaintext key, safe to display in UI ("sk-...abc4").
  last_four text,

  -- HMAC-SHA256(plaintext, pepper) hex digest. Used for dedup detection
  -- ("you already added this key under a different label") without
  -- exposing the plaintext. Computed in cloud-ai.
  fingerprint text,

  -- For openai_compatible: the custom base URL (e.g. https://api.together.xyz/v1).
  -- Plaintext, since URLs aren't sensitive. NULL for other providers.
  base_url text,

  -- Provider-specific account email (Codex subscription, etc.) for UI display.
  account_email text,

  -- Free-form metadata (model preferences, scopes, etc.).
  meta jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,

  constraint user_provider_keys_user_provider_label_key unique (user_id, provider, label)
);

create index if not exists idx_user_provider_keys_user
  on public.user_provider_keys (user_id);

create index if not exists idx_user_provider_keys_user_provider
  on public.user_provider_keys (user_id, provider) where enabled = true;

-- Updated-at trigger
create or replace function public.touch_user_provider_keys_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_provider_keys_updated_at on public.user_provider_keys;
create trigger trg_user_provider_keys_updated_at
  before update on public.user_provider_keys
  for each row execute function public.touch_user_provider_keys_updated_at();

-- RLS: users can read/write only their own rows. Cloud-ai uses the service
-- role and bypasses RLS, but we lock down direct PostgREST access in case
-- the client ever talks to Supabase directly.
alter table public.user_provider_keys enable row level security;

drop policy if exists "user_provider_keys_select_own" on public.user_provider_keys;
create policy "user_provider_keys_select_own" on public.user_provider_keys
  for select using (auth.uid() = user_id);

drop policy if exists "user_provider_keys_modify_own" on public.user_provider_keys;
create policy "user_provider_keys_modify_own" on public.user_provider_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Audit log ──────────────────────────────────────────────────────────
-- Append-only record of every BYOK lifecycle event (create/update/delete/
-- enable/disable/test/use). Lets us answer "when was this key last used"
-- and detect anomalous access patterns. Plaintext keys are NEVER written
-- here — only the action and the row id.

create table if not exists public.byok_audit_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  key_id uuid references public.user_provider_keys(id) on delete set null,
  action text not null check (action in (
    'create', 'update', 'delete', 'enable', 'disable', 'test', 'use', 'rotate',
    'codex_import', 'codex_token_expired'
  )),
  ip inet,
  user_agent text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_byok_audit_log_user
  on public.byok_audit_log (user_id, created_at desc);

create index if not exists idx_byok_audit_log_key
  on public.byok_audit_log (key_id, created_at desc);

alter table public.byok_audit_log enable row level security;

drop policy if exists "byok_audit_log_select_own" on public.byok_audit_log;
create policy "byok_audit_log_select_own" on public.byok_audit_log
  for select using (auth.uid() = user_id);
-- Inserts are service-role only — no insert policy granted to authenticated.
