-- Migration: Add source column to conversations + sync preferences to profiles
-- 1. Add source column to conversations so we can filter workflow conversations from the agent list
-- 2. Add sync preference columns to profiles for user-controlled sync settings

-- ── 1. Conversation source ──────────────────────────────────────────────────
alter table public.conversations
  add column if not exists source text not null default 'stuard';

-- Index for fast filtering by source
create index if not exists idx_conversations_user_source
  on public.conversations (user_id, source, created_at desc);

-- ── 2. Sync preferences on profiles ─────────────────────────────────────────
alter table public.profiles
  add column if not exists sync_accounts boolean not null default false,
  add column if not exists sync_conversations boolean not null default true,
  add column if not exists sync_memories boolean not null default false;
