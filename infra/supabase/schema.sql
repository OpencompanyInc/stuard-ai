create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  monthly_token_limit integer not null default 100000,
  sync_accounts boolean not null default false,
  sync_conversations boolean not null default true,
  sync_memories boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Persist memory deliveries when local agent is offline
create table if not exists public.memory_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id text,
  items jsonb not null,
  status text not null default 'pending', -- pending | delivered | failed
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memory_outbox enable row level security;

create policy if not exists memory_outbox_owner_select on public.memory_outbox
  for select using (auth.uid() = user_id);
create policy if not exists memory_outbox_owner_insert on public.memory_outbox
  for insert with check (auth.uid() = user_id);
create policy if not exists memory_outbox_owner_update on public.memory_outbox
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text,
  title text,
  source text not null default 'stuard',
  status text default 'started',
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  metadata jsonb, -- Stores reasoning, toolCalls, streamChunks for interleaved display
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd numeric,
  credit_cost numeric(12,4) not null default 0,
  raw jsonb,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.usage_events enable row level security;
alter table public.profiles enable row level security;

create policy if not exists conversations_owner_select on public.conversations
  for select using (auth.uid() = user_id);
create policy if not exists conversations_owner_modify on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists messages_owner_select on public.messages
  for select using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy if not exists messages_owner_insert on public.messages
  for insert with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()) and user_id = auth.uid());
create policy if not exists messages_owner_update on public.messages
  for update using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy if not exists messages_owner_delete on public.messages
  for delete using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

create policy if not exists usage_owner_select on public.usage_events
  for select using (auth.uid() = user_id);
create policy if not exists usage_owner_insert on public.usage_events
  for insert with check (auth.uid() = user_id);

create policy if not exists profiles_owner_select on public.profiles
  for select using (auth.uid() = user_id);
create policy if not exists profiles_owner_update on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- External accounts (OAuth tokens for integrations: github, google, etc.)
-- Supports multiple profiles per provider (e.g. work Google, personal Google)
create table if not exists public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  profile_label text not null default 'default',
  is_default boolean not null default true,
  account_email text,
  scopes text[] not null default '{}',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, profile_label)
);

alter table public.external_accounts enable row level security;

create policy if not exists external_accounts_owner_select on public.external_accounts
  for select using (auth.uid() = user_id);
create policy if not exists external_accounts_owner_insert on public.external_accounts
  for insert with check (auth.uid() = user_id);
create policy if not exists external_accounts_owner_update on public.external_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Deployments (CI/CD version control) ────────────────────────────────────
create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('beta', 'staging', 'production')),
  version text,
  status text not null default 'pending' check (status in ('pending', 'building', 'deploying', 'deployed', 'failed', 'rolled_back')),
  git_branch text,
  git_commit_sha text,
  git_tag text,
  triggered_by text,
  targets jsonb not null default '{"website": true, "cloud": true, "desktop": true}'::jsonb,
  workflow_run_url text,
  workflow_run_id text,
  duration_seconds integer,
  error_message text,
  metadata jsonb default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_deployments_channel on public.deployments(channel);
create index if not exists idx_deployments_status on public.deployments(status);
create index if not exists idx_deployments_created_at on public.deployments(created_at desc);

alter table public.deployments enable row level security;
