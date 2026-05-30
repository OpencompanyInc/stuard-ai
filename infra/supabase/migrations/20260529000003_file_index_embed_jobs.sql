-- File-index semantic embedding jobs.
--
-- Tracks a Gemini Batch-API embedding run for a local indexed folder: lifecycle
-- status, file/chunk counts (for a progress bar), the pre-flight credit estimate
-- + hard cap, and the actual credits billed on completion. The cloud-ai poller
-- (apps/cloud-ai/src/services/file-indexing.ts) owns this table; the desktop UI
-- reads it via GET /v1/file-index/embed/status.
--
-- `files` holds a compact [{ id, filename, kind }] array so the poller can build
-- summary/keywords for write-back without a bridge round-trip. JSONL request keys
-- are `<fileId>::<chunkIdx>`, so per-file chunk grouping needs no separate map.

create table if not exists public.file_index_embed_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  root_id text,
  root_path text,
  gemini_job_id text,
  status text not null default 'pending',          -- pending | running | writing | succeeded | failed | cancelled
  model text not null default 'gemini-embedding-2-preview',
  total_files integer not null default 0,
  total_chunks integer not null default 0,
  embedded_files integer not null default 0,
  failed_files integer not null default 0,
  queued_files integer not null default 0,          -- files left pending because the credit cap was hit
  estimated_tokens bigint not null default 0,
  estimated_credits numeric(12,4) not null default 0,
  actual_credits numeric(12,4) not null default 0,
  credit_cap numeric(12,4),
  files jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.file_index_embed_jobs enable row level security;

-- Owner can read their own jobs. Inserts/updates happen server-side via the
-- service role (which bypasses RLS), matching how usage_events is written.
-- NOTE: Postgres has no CREATE POLICY IF NOT EXISTS, so drop-then-create for idempotency.
drop policy if exists file_embed_jobs_owner_select on public.file_index_embed_jobs;
create policy file_embed_jobs_owner_select on public.file_index_embed_jobs
  for select using (auth.uid() = user_id);
drop policy if exists file_embed_jobs_owner_insert on public.file_index_embed_jobs;
create policy file_embed_jobs_owner_insert on public.file_index_embed_jobs
  for insert with check (auth.uid() = user_id);

create index if not exists idx_file_embed_jobs_user_status
  on public.file_index_embed_jobs(user_id, status);
create index if not exists idx_file_embed_jobs_active
  on public.file_index_embed_jobs(status)
  where status in ('pending', 'running', 'writing');
