-- Deployment tracking for CI/CD version control
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

comment on table public.deployments is 'CI/CD deployment tracking for beta, staging, and production channels';
