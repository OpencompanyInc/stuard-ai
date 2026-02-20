-- Migration: Add multi-profile support to external_accounts
-- Allows multiple OAuth accounts per provider per user (e.g. work Google, personal Google)

-- 1. Add profile columns
alter table public.external_accounts
  add column if not exists profile_label text not null default 'default',
  add column if not exists is_default boolean not null default true,
  add column if not exists account_email text;

-- 2. Drop old unique constraint (user_id, provider) and replace with (user_id, provider, profile_label)
-- First check if the old constraint exists and drop it
do $$
begin
  -- Drop the old unique constraint
  if exists (
    select 1 from pg_constraint
    where conname = 'external_accounts_user_id_provider_key'
    and conrelid = 'public.external_accounts'::regclass
  ) then
    alter table public.external_accounts
      drop constraint external_accounts_user_id_provider_key;
  end if;
end $$;

-- Add the new unique constraint
alter table public.external_accounts
  add constraint external_accounts_user_id_provider_profile_key
  unique (user_id, provider, profile_label);

-- 3. Create index for fast default-profile lookups
create index if not exists idx_external_accounts_default
  on public.external_accounts (user_id, provider, is_default)
  where is_default = true;

-- 4. Ensure only one default per (user_id, provider) using a partial unique index
create unique index if not exists idx_external_accounts_one_default
  on public.external_accounts (user_id, provider)
  where is_default = true;
