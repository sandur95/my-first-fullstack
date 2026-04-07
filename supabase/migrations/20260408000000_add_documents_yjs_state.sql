-- =============================================================================
-- Migration: add_documents_yjs_state
-- Adds a bytea column to persist the Yjs CRDT document state alongside the
-- existing plain-text body column.
--
-- Best practices applied:
--   - bytea for binary Yjs state (schema-data-types)
--   - Nullable: existing rows stay NULL and use the body fallback on load
--   - No index: blob is read/written whole, never queried or sorted
--   - No RLS changes: existing row-level policies on documents already cover
--     all columns, including this new one
-- =============================================================================

alter table public.documents
  add column yjs_state bytea;

comment on column public.documents.yjs_state is
  'Binary Yjs document state (Y.encodeStateAsUpdate). Used to initialise '
  'collaborative editing sessions. The body column is kept in sync as the '
  'plain-text export for search, preview, and non-collaborative access.';
