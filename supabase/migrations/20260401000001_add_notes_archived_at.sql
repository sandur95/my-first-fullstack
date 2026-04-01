-- =============================================================================
-- Migration: add_notes_archived_at
-- Adds soft-delete support to the notes table via an `archived_at` timestamp.
--
-- Best practices applied:
--   - timestamptz (not timestamp) for timezone-aware storage (schema-data-types)
--   - Two partial indexes replace the previous full-table composite index:
--       1. Active notes  (archived_at IS NULL)  — covers the primary fetch query
--       2. Archived notes (archived_at IS NOT NULL) — covers the archive-tab query
--     Partial indexes are 5-20x smaller than full-table indexes and serve
--     queries that consistently filter on the same condition. (query-partial-indexes)
--   - No RLS changes needed: archiving is a plain UPDATE; the existing
--     notes_update_own policy already covers any column update by the row owner.
-- =============================================================================

alter table public.notes
  add column archived_at timestamptz default null;

comment on column public.notes.archived_at is
  'NULL = active note. Set to now() to soft-delete (archive); set back to NULL to unarchive.';

-- ---------------------------------------------------------------------------
-- Replace the previous full-table composite index with two partial indexes,
-- one per query pattern. Each index includes only the rows it will serve.
-- ---------------------------------------------------------------------------
drop index if exists public.notes_user_pinned_created_idx;

-- Primary fetch (active tab): user_id filter + pinned-first + newest-first
-- Exact match for: WHERE user_id = ? AND archived_at IS NULL
--                  ORDER BY pinned DESC, created_at DESC
create index notes_active_user_pinned_created_idx
  on public.notes (user_id, pinned desc, created_at desc)
  where archived_at is null;

-- Archive fetch: user_id filter + most-recently-archived-first
-- Exact match for: WHERE user_id = ? AND archived_at IS NOT NULL
--                  ORDER BY archived_at DESC
create index notes_archived_user_created_idx
  on public.notes (user_id, archived_at desc)
  where archived_at is not null;
