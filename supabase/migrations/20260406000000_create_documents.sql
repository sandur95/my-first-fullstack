-- =============================================================================
-- Migration: create_documents
-- Creates the documents table for long-form Markdown content.
-- Independent from notes — no tags, archive, or pinning.
--
-- Best practices applied:
--   - bigint generated always as identity PK (schema-primary-keys)
--   - text for title + body; timestamptz for timestamps (schema-data-types)
--   - Composite index on (user_id, updated_at DESC) covers FK + default sort
--     (schema-foreign-key-indexes, query-composite-indexes)
--   - RLS enabled + forced (security-rls-basics)
--   - (select auth.uid()) subquery in every policy (security-rls-performance)
--   - Reuses existing set_updated_at() trigger from 20260330000000
--   - Added to supabase_realtime publication for live INSERT/UPDATE/DELETE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. documents table
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.documents is
  'Long-form Markdown documents. Each document belongs to exactly one user.';

-- ---------------------------------------------------------------------------
-- 2. Index
--    Composite (user_id, updated_at DESC) covers:
--      - FK lookups and ON DELETE CASCADE (schema-foreign-key-indexes)
--      - Default listing query ORDER BY updated_at DESC (query-composite-indexes)
--      - RLS policy filter on user_id (security-rls-performance)
-- ---------------------------------------------------------------------------
create index if not exists documents_user_id_updated_at_idx
  on public.documents (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- 3. Auto-update updated_at via existing trigger function
--    Reuses public.set_updated_at() created in 20260330000000.
-- ---------------------------------------------------------------------------
create or replace trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.documents force row level security;

create policy documents_select_own on public.documents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy documents_insert_own on public.documents
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy documents_update_own on public.documents
  for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy documents_delete_own on public.documents
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. Realtime
--    Adds documents to the supabase_realtime publication so that
--    INSERT/UPDATE/DELETE events are streamed to subscribed clients.
--    The client-side subscription filter (user_id=eq.<uid>) combined with RLS
--    ensures users only ever receive events for their own documents.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.documents;
