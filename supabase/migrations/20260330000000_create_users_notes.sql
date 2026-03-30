-- =============================================================================
-- Migration: create_users_notes
-- Creates the users and notes tables with RLS policies.
-- Best practices applied:
--   - bigint generated always as identity primary keys (schema-primary-keys)
--   - text instead of varchar(n); timestamptz for timestamps (schema-data-types)
--   - Index on notes.user_id FK column (schema-foreign-key-indexes)
--   - RLS enabled + force row level security (security-rls-basics)
--   - auth.uid() wrapped in SELECT subquery to avoid per-row evaluation (security-rls-performance)
--   - Index on notes.user_id supports RLS policy lookups (security-rls-performance)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- Extends Supabase auth.users with a public profile row.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Public user profiles, one row per auth.users entry.';

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  title      text not null,
  content    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is 'User notes. Each note belongs to exactly one user.';

-- Index the FK column: required for fast JOINs and ON DELETE CASCADE
-- (schema-foreign-key-indexes)
create index if not exists notes_user_id_idx on public.notes (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — users table
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.users force row level security;

-- Users can read only their own profile.
create policy users_select_own on public.users
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Users can update only their own profile.
create policy users_update_own on public.users
  for update
  to authenticated
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Row Level Security — notes table
-- ---------------------------------------------------------------------------
alter table public.notes enable row level security;
alter table public.notes force row level security;

-- Users can read only their own notes.
create policy notes_select_own on public.notes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Users can insert notes for themselves only.
create policy notes_insert_own on public.notes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Users can update only their own notes.
create policy notes_update_own on public.notes
  for update
  to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Users can delete only their own notes.
create policy notes_delete_own on public.notes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at via trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create or replace trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();
