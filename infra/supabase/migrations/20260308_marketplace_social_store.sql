alter table public.marketplace_workflows
  add column if not exists short_description text,
  add column if not exists locked boolean not null default false,
  add column if not exists thumbnail_url text,
  add column if not exists cover_image_url text;

create table if not exists public.marketplace_creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique,
  display_name text not null,
  bio text,
  avatar_url text,
  hero_image_url text,
  website_url text,
  verified boolean not null default false,
  follower_count integer not null default 0,
  workflow_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_creators_handle_format check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$')
);

create table if not exists public.marketplace_creator_follows (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.marketplace_creators(user_id) on delete cascade,
  follower_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (creator_id, follower_id),
  constraint marketplace_creator_follows_no_self check (creator_id <> follower_id)
);

create table if not exists public.marketplace_workflow_media (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  media_type text not null,
  url text not null,
  thumbnail_url text,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint marketplace_workflow_media_type check (media_type in ('image', 'video'))
);

create index if not exists marketplace_creators_handle_idx
  on public.marketplace_creators(handle);
create index if not exists marketplace_creator_follows_creator_idx
  on public.marketplace_creator_follows(creator_id, created_at desc);
create index if not exists marketplace_creator_follows_follower_idx
  on public.marketplace_creator_follows(follower_id, created_at desc);
create index if not exists marketplace_workflow_media_workflow_idx
  on public.marketplace_workflow_media(workflow_id, sort_order asc, created_at asc);
create index if not exists marketplace_workflows_thumbnail_idx
  on public.marketplace_workflows(thumbnail_url)
  where thumbnail_url is not null;
create index if not exists marketplace_workflows_cover_idx
  on public.marketplace_workflows(cover_image_url)
  where cover_image_url is not null;

alter table public.marketplace_creators enable row level security;
alter table public.marketplace_creator_follows enable row level security;
alter table public.marketplace_workflow_media enable row level security;

create policy marketplace_creators_select on public.marketplace_creators
  for select using (true);

create policy marketplace_creators_insert on public.marketplace_creators
  for insert with check (user_id = auth.uid());

create policy marketplace_creators_update on public.marketplace_creators
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists marketplace_creator_follows_select on public.marketplace_creator_follows;
create policy marketplace_creator_follows_select on public.marketplace_creator_follows
  for select using (true);

drop policy if exists marketplace_creator_follows_insert on public.marketplace_creator_follows;
create policy marketplace_creator_follows_insert on public.marketplace_creator_follows
  for insert with check (follower_id = auth.uid());

drop policy if exists marketplace_creator_follows_delete on public.marketplace_creator_follows;
create policy marketplace_creator_follows_delete on public.marketplace_creator_follows
  for delete using (follower_id = auth.uid());

create policy marketplace_workflow_media_select on public.marketplace_workflow_media
  for select using (
    exists (
      select 1
      from public.marketplace_workflows w
      where w.id = workflow_id
        and (w.status = 'published' or w.publisher_id = auth.uid())
    )
  );

create policy marketplace_workflow_media_insert on public.marketplace_workflow_media
  for insert with check (
    exists (
      select 1
      from public.marketplace_workflows w
      where w.id = workflow_id
        and w.publisher_id = auth.uid()
    )
  );

create policy marketplace_workflow_media_update on public.marketplace_workflow_media
  for update using (
    exists (
      select 1
      from public.marketplace_workflows w
      where w.id = workflow_id
        and w.publisher_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.marketplace_workflows w
      where w.id = workflow_id
        and w.publisher_id = auth.uid()
    )
  );

create policy marketplace_workflow_media_delete on public.marketplace_workflow_media
  for delete using (
    exists (
      select 1
      from public.marketplace_workflows w
      where w.id = workflow_id
        and w.publisher_id = auth.uid()
    )
  );

create or replace function public.refresh_marketplace_creator_stats(target_creator uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.marketplace_creators c
  set follower_count = (
      select count(*)
      from public.marketplace_creator_follows f
      where f.creator_id = target_creator
    ),
    workflow_count = (
      select count(*)
      from public.marketplace_workflows w
      where w.publisher_id = target_creator
        and w.status = 'published'
    ),
    updated_at = now()
  where c.user_id = target_creator;
end;
$$;

create or replace function public.handle_marketplace_creator_follow_stats()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_marketplace_creator_stats(old.creator_id);
    return old;
  end if;

  perform public.refresh_marketplace_creator_stats(new.creator_id);
  return new;
end;
$$;

drop trigger if exists trg_marketplace_creator_follow_stats on public.marketplace_creator_follows;
create trigger trg_marketplace_creator_follow_stats
  after insert or delete on public.marketplace_creator_follows
  for each row execute function public.handle_marketplace_creator_follow_stats();

create or replace function public.handle_marketplace_creator_workflow_stats()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_marketplace_creator_stats(old.publisher_id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.publisher_id is distinct from new.publisher_id then
      perform public.refresh_marketplace_creator_stats(old.publisher_id);
    end if;
    if old.status is distinct from new.status or old.publisher_id is distinct from new.publisher_id then
      perform public.refresh_marketplace_creator_stats(new.publisher_id);
    end if;
    return new;
  end if;

  perform public.refresh_marketplace_creator_stats(new.publisher_id);
  return new;
end;
$$;

drop trigger if exists trg_marketplace_creator_workflow_stats on public.marketplace_workflows;
create trigger trg_marketplace_creator_workflow_stats
  after insert or update or delete on public.marketplace_workflows
  for each row execute function public.handle_marketplace_creator_workflow_stats();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketplace-media',
  'marketplace-media',
  true,
  104857600,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists marketplace_media_public_read on storage.objects;
create policy marketplace_media_public_read on storage.objects
  for select using (bucket_id = 'marketplace-media');

drop policy if exists marketplace_media_authenticated_insert on storage.objects;
create policy marketplace_media_authenticated_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'marketplace-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists marketplace_media_authenticated_update on storage.objects;
create policy marketplace_media_authenticated_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'marketplace-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'marketplace-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists marketplace_media_authenticated_delete on storage.objects;
create policy marketplace_media_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'marketplace-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
