-- =============================================================================
-- Migration: create_avatars_storage
-- Adds avatar storage support to the notes app.
--
-- Best practices applied:
--   - text column (no artificial varchar length) for avatar_path (schema-data-types)
--   - Private bucket (public = false) — files served via signed URLs only
--   - storage.objects policies use (select auth.uid()) subquery to evaluate the
--     JWT claim once per query, not once per row (security-rls-performance)
--   - storage.foldername(name)[1] extracts the first path segment, which by
--     convention equals the uploading user's UUID (e.g. '<user_id>/avatar.png')
--     This lets the policy enforce owner-only access without a join to public.users
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add avatar_path column to public.users
--    Nullable — NULL means no avatar has been uploaded yet.
--    Stores the relative storage path only (e.g. '<user_id>/avatar.png').
--    Never stores a signed URL; signed URLs are derived at display time.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists avatar_path text default null;

comment on column public.users.avatar_path is
  'Relative path of the user''s avatar in the private "avatars" storage bucket. '
  'NULL = no avatar uploaded. e.g. ''<user_id>/avatar.png''. '
  'Never store signed URLs here — generate them from this path at display time.';

-- ---------------------------------------------------------------------------
-- 2. Create the private avatars bucket
--    public = false  →  no unauthenticated GET access; all reads require a
--    signed URL or a storage policy that passes auth.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Storage policies on storage.objects
--
--    Path convention: '<user_id>/avatar.png'
--    storage.foldername(name) splits the object name on '/' and returns an
--    array; element [1] is the first segment, which must equal auth.uid().
--
--    (select auth.uid()) — hoists the JWT claim evaluation outside the
--    per-row loop so it is called once per query (security-rls-performance).
-- ---------------------------------------------------------------------------

-- SELECT: owner can read (required for createSignedUrl to succeed)
create policy "avatars_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- INSERT: owner can upload to their own folder
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- UPDATE: owner can replace their own file (used by upsert)
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- DELETE: owner can remove their own avatar
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
