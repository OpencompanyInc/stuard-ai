-- Marketplace for published Stuard workflows
-- Users can publish, rate, and discover workflows

-- Main table for published workflows
create table if not exists public.marketplace_workflows (
  id uuid primary key default gen_random_uuid(),
  -- Publisher info
  publisher_id uuid not null references auth.users(id) on delete cascade,
  publisher_name text, -- Display name at publish time
  
  -- Workflow identity
  slug text unique not null, -- URL-friendly identifier
  name text not null,
  description text not null,
  version text not null default '1',
  
  -- Workflow content (the full StuardSpec JSON)
  spec jsonb not null,
  
  -- Metadata
  category text, -- e.g., 'productivity', 'automation', 'data', 'integration'
  tags text[] default '{}',
  icon text, -- emoji or icon name
  
  -- Search: semantic embedding of description + name + tags
  embedding vector(3072), -- text-embedding-3-large dimension
  
  -- Stats (denormalized for performance)
  download_count integer not null default 0,
  rating_count integer not null default 0,
  rating_avg numeric(3,2) not null default 0.00,
  
  -- Visibility
  status text not null default 'published', -- draft, published, unlisted, removed
  featured boolean not null default false,
  
  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

-- Ratings table
create table if not exists public.marketplace_ratings (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  review text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, user_id) -- One rating per user per workflow
);

-- Downloads/installs tracking
create table if not exists public.marketplace_downloads (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, -- Optional, can be anonymous
  created_at timestamptz not null default now()
);

-- Indexes for fast lookups
create index if not exists marketplace_workflows_publisher_idx on public.marketplace_workflows(publisher_id);
create index if not exists marketplace_workflows_category_idx on public.marketplace_workflows(category);
create index if not exists marketplace_workflows_status_idx on public.marketplace_workflows(status);
create index if not exists marketplace_workflows_featured_idx on public.marketplace_workflows(featured) where featured = true;
create index if not exists marketplace_workflows_rating_idx on public.marketplace_workflows(rating_avg desc, rating_count desc);
create index if not exists marketplace_workflows_downloads_idx on public.marketplace_workflows(download_count desc);
create index if not exists marketplace_workflows_created_idx on public.marketplace_workflows(created_at desc);

-- Note: HNSW index has 2000 dimension limit, so we skip it for 3072-dim embeddings.
-- For small datasets (<10k rows), exact search via <=> operator is fast enough.
-- For larger datasets, consider using IVFFlat or reducing embedding dimensions.

-- GIN index for tags array search
create index if not exists marketplace_workflows_tags_idx on public.marketplace_workflows using gin(tags);

-- Ratings indexes
create index if not exists marketplace_ratings_workflow_idx on public.marketplace_ratings(workflow_id);
create index if not exists marketplace_ratings_user_idx on public.marketplace_ratings(user_id);

-- Downloads indexes
create index if not exists marketplace_downloads_workflow_idx on public.marketplace_downloads(workflow_id);
create index if not exists marketplace_downloads_user_idx on public.marketplace_downloads(user_id);

-- RLS policies
alter table public.marketplace_workflows enable row level security;
alter table public.marketplace_ratings enable row level security;
alter table public.marketplace_downloads enable row level security;

-- Workflows: anyone can read published, owner can manage their own
create policy marketplace_workflows_select_published on public.marketplace_workflows
  for select using (status = 'published' or publisher_id = auth.uid());

create policy marketplace_workflows_insert on public.marketplace_workflows
  for insert with check (publisher_id = auth.uid());

create policy marketplace_workflows_update on public.marketplace_workflows
  for update using (publisher_id = auth.uid()) with check (publisher_id = auth.uid());

create policy marketplace_workflows_delete on public.marketplace_workflows
  for delete using (publisher_id = auth.uid());

-- Ratings: anyone can read, users can manage their own
create policy marketplace_ratings_select on public.marketplace_ratings
  for select using (true);

create policy marketplace_ratings_insert on public.marketplace_ratings
  for insert with check (user_id = auth.uid());

create policy marketplace_ratings_update on public.marketplace_ratings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy marketplace_ratings_delete on public.marketplace_ratings
  for delete using (user_id = auth.uid());

-- Downloads: anyone can insert (tracking), select own or aggregate
create policy marketplace_downloads_insert on public.marketplace_downloads
  for insert with check (true);

create policy marketplace_downloads_select on public.marketplace_downloads
  for select using (user_id = auth.uid() or user_id is null);

-- Function to update rating stats when a rating is added/updated/deleted
create or replace function update_workflow_rating_stats()
returns trigger as $$
begin
  -- Recalculate stats for the affected workflow
  if TG_OP = 'DELETE' then
    update public.marketplace_workflows
    set 
      rating_count = (select count(*) from public.marketplace_ratings where workflow_id = OLD.workflow_id),
      rating_avg = coalesce((select avg(rating)::numeric(3,2) from public.marketplace_ratings where workflow_id = OLD.workflow_id), 0),
      updated_at = now()
    where id = OLD.workflow_id;
    return OLD;
  else
    update public.marketplace_workflows
    set 
      rating_count = (select count(*) from public.marketplace_ratings where workflow_id = NEW.workflow_id),
      rating_avg = coalesce((select avg(rating)::numeric(3,2) from public.marketplace_ratings where workflow_id = NEW.workflow_id), 0),
      updated_at = now()
    where id = NEW.workflow_id;
    return NEW;
  end if;
end;
$$ language plpgsql security definer;

-- Trigger for rating stats
drop trigger if exists trg_update_rating_stats on public.marketplace_ratings;
create trigger trg_update_rating_stats
  after insert or update or delete on public.marketplace_ratings
  for each row execute function update_workflow_rating_stats();

-- Function to increment download count
create or replace function increment_workflow_download()
returns trigger as $$
begin
  update public.marketplace_workflows
  set download_count = download_count + 1, updated_at = now()
  where id = NEW.workflow_id;
  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger for download count
drop trigger if exists trg_increment_download on public.marketplace_downloads;
create trigger trg_increment_download
  after insert on public.marketplace_downloads
  for each row execute function increment_workflow_download();

-- RPC function for semantic similarity search
create or replace function search_marketplace_workflows(
  query_embedding vector(3072),
  match_threshold float default 0.3,
  match_count int default 20,
  filter_category text default null
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  tags text[],
  icon text,
  rating_avg numeric,
  rating_count int,
  download_count int,
  publisher_name text,
  created_at timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    mw.id,
    mw.slug,
    mw.name,
    mw.description,
    mw.category,
    mw.tags,
    mw.icon,
    mw.rating_avg,
    mw.rating_count,
    mw.download_count,
    mw.publisher_name,
    mw.created_at,
    1 - (mw.embedding <=> query_embedding) as similarity
  from public.marketplace_workflows mw
  where 
    mw.status = 'published'
    and mw.embedding is not null
    and 1 - (mw.embedding <=> query_embedding) > match_threshold
    and (filter_category is null or mw.category = filter_category)
  order by mw.embedding <=> query_embedding
  limit match_count;
end;
$$;
