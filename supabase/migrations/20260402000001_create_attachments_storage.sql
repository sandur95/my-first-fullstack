-- =============================================================================
-- Migration: create_attachments_storage
-- Adds file attachment support to the notes app.
--
-- Best practices applied:
--   - bigint generated always as identity PK (schema-primary-keys)
--   - text columns for paths/names — no artificial varchar limit (schema-data-types)
--   - bigint for file_size — future-proof, int overflows at ~2 GB (schema-data-types)
--   - timestamptz for created_at (schema-data-types)
--   - FK indexes on note_id and user_id — Postgres does NOT auto-index FKs;
--     both are needed for fast JOINs and fast ON DELETE CASCADE (schema-foreign-key-indexes)
--   - Denormalised user_id enables zero-join RLS: (select auth.uid()) = user_id
--     (security-rls-performance)
--   - (select auth.uid()) subquery evaluated once per query, not once per row
--     (security-rls-performance)
--   - Private bucket (public = false) — files served via signed URLs only
--   - storage.foldername(name)[1] = first path segment = user UUID; lets the
--     storage policy enforce owner-only access without a join to public.users
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. note_attachments metadata table
--    One row per uploaded file; linked to a note via note_id.
--    Cascade deletes clean up metadata when notes or users are removed.
--    user_id is denormalised here so the RLS policy needs no join.
--    storage_path stores only the relative bucket path — never a signed URL.
-- ---------------------------------------------------------------------------
create table public.note_attachments (
  id           bigint      generated always as identity primary key,
  note_id      bigint      not null references public.notes  (id) on delete cascade,
  user_id      uuid        not null references public.users  (id) on delete cascade,
  storage_path text        not null,
  file_name    text        not null,
  mime_type    text,
  file_size    bigint,
  created_at   timestamptz not null default now()
);

comment on table public.note_attachments is
  'File attachment metadata. One row per file. '
  'storage_path is a relative path in the private "attachments" bucket — '
  'never a signed URL. Generate signed URLs at display time.';

comment on column public.note_attachments.storage_path is
  'Relative path inside the "attachments" bucket. '
  'Convention: ''<user_id>/<note_id>/<timestamp>_<random>_<original_name>''. '
  'Never store signed URLs here.';

-- ---------------------------------------------------------------------------
-- 2. Indexes on FK columns
--    note_id — primary fetch pattern ("give me all attachments for note X")
--              also required for fast ON DELETE CASCADE from notes
--    user_id — RLS policy lookup + fast ON DELETE CASCADE from users
--    (schema-foreign-key-indexes)
-- ---------------------------------------------------------------------------
create index note_attachments_note_id_idx on public.note_attachments (note_id);
create index note_attachments_user_id_idx on public.note_attachments (user_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--    user_id is denormalised onto the table so every policy is a direct
--    column comparison — no correlated sub-query to public.notes.
--    (select auth.uid()) is evaluated once per query, not per row.
--    (security-rls-basics, security-rls-performance)
--
--    No UPDATE policy: attachments are immutable once uploaded.
-- ---------------------------------------------------------------------------
alter table public.note_attachments enable row level security;
alter table public.note_attachments force row level security;

-- SELECT: owner can read their own attachment rows (needed for joined selects)
create policy "note_attachments_select_own"
  on public.note_attachments for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- INSERT: owner can only create rows that point at themselves
create policy "note_attachments_insert_own"
  on public.note_attachments for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- DELETE: owner can remove their own attachment rows
create policy "note_attachments_delete_own"
  on public.note_attachments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy — attachment rows are immutable after creation.

-- ---------------------------------------------------------------------------
-- 4. Private "attachments" storage bucket
--    public = false  →  no unauthenticated GET access; all reads require
--    a signed URL or a storage policy that passes auth.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Storage policies on storage.objects
--
--    Path convention: '<user_id>/<note_id>/<safeFilename>'
--    storage.foldername(name) splits the object name on '/' and returns an
--    array; element [1] is the first segment, which must equal auth.uid().
--
--    (select auth.uid()) — hoists the JWT claim evaluation outside the
--    per-row loop so it is called once per query. (security-rls-performance)
--
--    No UPDATE storage policy: files are never replaced (immutable).
-- ---------------------------------------------------------------------------

-- SELECT: owner can read their own files (required for createSignedUrl)
create policy "attachments_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- INSERT: owner can upload to their own user-id folder
create policy "attachments_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- DELETE: owner can remove their own files
create policy "attachments_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
