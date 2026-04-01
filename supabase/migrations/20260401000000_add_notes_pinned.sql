-- =============================================================================
-- Migration: add_notes_pinned
-- Adds a boolean `pinned` flag to the notes table.
--
-- Best practices applied:
--   - boolean NOT NULL DEFAULT false (schema-data-types: boolean over varchar)
--   - Composite index (user_id, pinned DESC, created_at DESC) replaces the
--     single-column notes_user_id_idx so the ORDER BY pinned DESC, created_at DESC
--     can be served entirely from the index without a runtime sort step.
--     (query-composite-indexes, query-missing-indexes)
--   - No RLS changes needed: the existing notes_update_own policy already
--     covers any column update performed by the row owner. (security-rls-basics)
-- =============================================================================

alter table public.notes
  add column pinned boolean not null default false;

comment on column public.notes.pinned is
  'When true, the note is pinned and displayed before unpinned notes.';

-- ---------------------------------------------------------------------------
-- Replace the single-column FK index with a composite index that covers
-- both the RLS/JOIN filter (user_id) and the full ORDER BY clause.
-- The composite index is a superset of the old one for any query that
-- filters by user_id, so dropping the single-column index loses nothing.
-- ---------------------------------------------------------------------------
drop index if exists public.notes_user_id_idx;

create index notes_user_pinned_created_idx
  on public.notes (user_id, pinned desc, created_at desc);
