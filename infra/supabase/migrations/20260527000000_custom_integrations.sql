-- Custom (user-authored) declarative integrations.
--
-- A user builds an integration manifest in the desktop Integration Builder and
-- "Deploys" it. The manifest (identity / auth schema / outbound-host allowlist /
-- declarative HTTP tools) plus the user's credentials are stored here so the
-- agent, bots, and workflows can call the integration's tools.
--
-- Plaintext credentials are NEVER persisted. `secrets_encrypted` holds a JSON
-- map of `{ <authFieldName>: EncryptedField }` where each value is AES-256-GCM
-- ciphertext + IV + tag (base64) produced by encryptForUser() in
-- apps/cloud-ai/src/utils/token-encryption.ts — the same per-user envelope
-- encryption (HKDF from TOKEN_ENCRYPTION_PEPPER) used by external_accounts and
-- user_provider_keys. A DB leak exposes no usable secret material.

create table if not exists public.custom_integrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,

  -- Denormalized identity (also present inside manifest) for cheap listing.
  name text not null default '',
  description text not null default '',
  icon text,
  category text,
  version text not null default '0.1.0',

  -- Full IntegrationManifest (apps/cloud-ai/src/integrations/types.ts).
  manifest jsonb not null,

  -- { <authFieldName>: { ciphertext, iv, tag, key_version } }
  secrets_encrypted jsonb not null default '{}'::jsonb,

  -- When false the integration is stored but its tools are not loaded into the
  -- agent / bots / workflows. Lets users keep credentials on file while paused.
  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, slug)
);

-- Fast "what's deployed for this user" lookups on the request hot path.
create index if not exists custom_integrations_user_enabled_idx
  on public.custom_integrations (user_id)
  where enabled;

-- Credential material + outbound config is backend data. Keep direct client
-- access closed; cloud-ai uses the service role exclusively (same posture as
-- tool_embeddings / external_accounts).
alter table public.custom_integrations enable row level security;

revoke all on table public.custom_integrations from anon;
revoke all on table public.custom_integrations from authenticated;

drop policy if exists custom_integrations_no_client_access on public.custom_integrations;
create policy custom_integrations_no_client_access on public.custom_integrations
  for all
  using (false)
  with check (false);
