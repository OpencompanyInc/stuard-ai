-- Fix stale external_accounts uniqueness for multi-profile OAuth accounts.
--
-- Some environments still have an older unique constraint named
-- external_accounts_user_provider_key on (user_id, provider). That constraint
-- blocks adding a second GitHub/Google/etc. profile even though the application
-- now upserts by (user_id, provider, profile_label).

alter table public.external_accounts
  add column if not exists profile_label text not null default 'default',
  add column if not exists is_default boolean not null default true,
  add column if not exists account_email text;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'external_accounts'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by ord.ordinality)
        from unnest(con.conkey) with ordinality as ord(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = con.conrelid
         and att.attnum = ord.attnum
      ) = array['user_id', 'provider']
  loop
    execute format(
      'alter table public.external_accounts drop constraint %I',
      constraint_record.conname
    );
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.external_accounts'::regclass
      and contype = 'u'
      and (
        select array_agg(att.attname::text order by ord.ordinality)
        from unnest(conkey) with ordinality as ord(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = conrelid
         and att.attnum = ord.attnum
      ) = array['user_id', 'provider', 'profile_label']
  ) then
    alter table public.external_accounts
      add constraint external_accounts_user_id_provider_profile_key
      unique (user_id, provider, profile_label);
  end if;
end $$;

with ranked_accounts as (
  select
    id,
    row_number() over (
      partition by user_id, provider
      order by is_default desc, created_at asc, id asc
    ) as default_rank
  from public.external_accounts
)
update public.external_accounts account
set
  is_default = ranked_accounts.default_rank = 1,
  updated_at = now()
from ranked_accounts
where account.id = ranked_accounts.id
  and account.is_default is distinct from (ranked_accounts.default_rank = 1);

create index if not exists idx_external_accounts_default
  on public.external_accounts (user_id, provider, is_default)
  where is_default = true;

create unique index if not exists idx_external_accounts_one_default
  on public.external_accounts (user_id, provider)
  where is_default = true;
