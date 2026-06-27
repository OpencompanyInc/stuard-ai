-- Marketplace Updates: Version history and changelog support
-- Allows publishers to update their workflows while preserving version history

-- Table to store version history for marketplace workflows
create table if not exists public.marketplace_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  version text not null,
  spec jsonb not null,
  changelog text, -- What changed in this version
  created_at timestamptz not null default now()
);

-- Index for fast version lookups
create index if not exists marketplace_workflow_versions_workflow_idx 
  on public.marketplace_workflow_versions(workflow_id, created_at desc);

-- RLS for version history
alter table public.marketplace_workflow_versions enable row level security;

-- Anyone can read version history for published workflows
create policy marketplace_workflow_versions_select on public.marketplace_workflow_versions
  for select using (
    exists (
      select 1 from public.marketplace_workflows w 
      where w.id = workflow_id and (w.status = 'published' or w.publisher_id = auth.uid())
    )
  );

-- Only the publisher can insert versions (via service role in practice)
create policy marketplace_workflow_versions_insert on public.marketplace_workflow_versions
  for insert with check (
    exists (
      select 1 from public.marketplace_workflows w 
      where w.id = workflow_id and w.publisher_id = auth.uid()
    )
  );

-- Add a column to track which version users have downloaded (for update notifications)
-- This allows us to notify users when workflows they've downloaded have updates
create table if not exists public.marketplace_user_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  downloaded_version text not null,
  local_workflow_id text, -- Local ID on user's machine (if they want to track updates)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workflow_id)
);

-- Index for user download lookups
create index if not exists marketplace_user_downloads_user_idx 
  on public.marketplace_user_downloads(user_id);
create index if not exists marketplace_user_downloads_workflow_idx 
  on public.marketplace_user_downloads(workflow_id);

-- RLS for user downloads
alter table public.marketplace_user_downloads enable row level security;

-- Users can only see and manage their own download records
create policy marketplace_user_downloads_select on public.marketplace_user_downloads
  for select using (user_id = auth.uid());

create policy marketplace_user_downloads_insert on public.marketplace_user_downloads
  for insert with check (user_id = auth.uid());

create policy marketplace_user_downloads_update on public.marketplace_user_downloads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy marketplace_user_downloads_delete on public.marketplace_user_downloads
  for delete using (user_id = auth.uid());
