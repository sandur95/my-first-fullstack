-- =============================================================================
-- Migration: create_note_shares
-- Adds note-sharing support: a note owner can grant another user either
-- view-only or edit access to a specific note.
--
-- Best practices applied:
--   - CREATE TYPE … AS ENUM for permission: database-enforced valid values
--     (schema-data-types). IMPORTANT: ALTER TYPE … ADD VALUE cannot run inside
--     a transaction — future permission additions need a standalone migration.
--   - bigint generated always as identity PK (schema-primary-keys)
--   - timestamptz for created_at (schema-data-types)
--   - UNIQUE (note_id, shared_with_user_id): one share row per pair
--   - FK indexes on both FK columns (schema-foreign-key-indexes)
--   - RLS enabled + forced on note_shares (security-rls-basics)
--   - (select auth.uid()) subquery — evaluated once per query (security-rls-performance)
--   - security definer + set search_path = '' on all helpers (security-privileges)
--   - Reuses existing owns_note() security-definer helper for owner policies
--     (security-rls-performance)
--   - All new notes/users/note_attachments/storage policies are additive;
--     no existing policy is dropped or replaced.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum type — database enforces 'view' | 'edit', no other value accepted.
--    NOTE: ALTER TYPE … ADD VALUE cannot run inside a transaction.
--    Future permission additions require a standalone migration.
-- ---------------------------------------------------------------------------
create type public.note_permission as enum ('view', 'edit');

-- ---------------------------------------------------------------------------
-- 2. note_shares table
-- ---------------------------------------------------------------------------
create table public.note_shares (
  id                  bigint                not null generated always as identity primary key,
  note_id             bigint                not null references public.notes (id) on delete cascade,
  shared_with_user_id uuid                  not null references public.users (id) on delete cascade,
  permission          public.note_permission not null default 'view',
  created_at          timestamptz           not null default now(),
  unique (note_id, shared_with_user_id)
);

comment on table  public.note_shares is
  'Grants a user read (view) or write (edit) access to a note they do not own.';
comment on column public.note_shares.permission is
  'view = read-only; edit = may change title and content only. '
  'Pin, archive, delete, tag management, and attachment uploads remain owner-only.';

-- ---------------------------------------------------------------------------
-- 3. Indexes
--    note_id — required for ON DELETE CASCADE performance and owner-policy joins.
--    shared_with_user_id — used by every RLS helper lookup on this table;
--      without it, each query on notes produces a full seq-scan on note_shares.
--    users.email — required by get_user_id_by_email().
--    (schema-foreign-key-indexes, security-rls-performance, query-missing-indexes)
-- ---------------------------------------------------------------------------
create index note_shares_note_id_idx
  on public.note_shares (note_id);

create index note_shares_shared_with_user_id_idx
  on public.note_shares (shared_with_user_id);

-- Index on users.email for the email-lookup RPC.
-- Idiomatic: CREATE INDEX IF NOT EXISTS avoids failure on repeated runs.
create index if not exists users_email_idx
  on public.users (email);

-- ---------------------------------------------------------------------------
-- 4. Self-share prevention trigger
--    Fires before any INSERT or UPDATE on note_shares.
--    Raises an exception when the sharee is the note owner, preventing
--    a user from sharing a note with themselves.
--    security definer + set search_path = '': prevents search-path injection.
--    (security-privileges, security-rls-basics)
-- ---------------------------------------------------------------------------
create or replace function public.prevent_self_share()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (
    select 1
    from   public.notes
    where  id      = new.note_id
      and  user_id = new.shared_with_user_id
  ) then
    raise exception
      'Cannot share a note with its owner (note_id=%, user_id=%)',
      new.note_id, new.shared_with_user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger note_shares_prevent_self_share
  before insert or update on public.note_shares
  for each row execute function public.prevent_self_share();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security — note_shares
-- ---------------------------------------------------------------------------
alter table public.note_shares enable row level security;
alter table public.note_shares force row level security;

-- Owner sees all shares for notes they own.
-- Reuses owns_note() defined in 20260401000002_create_tags.sql.
-- (security-rls-performance: security-definer helper avoids per-row join to notes)
create policy note_shares_select_owner on public.note_shares
  for select to authenticated
  using (public.owns_note(note_id));

-- Owner can create shares for notes they own.
create policy note_shares_insert_owner on public.note_shares
  for insert to authenticated
  with check (public.owns_note(note_id));

-- Owner can change the permission level of an existing share.
create policy note_shares_update_owner on public.note_shares
  for update to authenticated
  using      (public.owns_note(note_id))
  with check (public.owns_note(note_id));

-- Owner can revoke shares for notes they own.
create policy note_shares_delete_owner on public.note_shares
  for delete to authenticated
  using (public.owns_note(note_id));

-- Sharee can see their own share row (needed for the client to read
-- the permission level and for useSharedNotes to build the list).
create policy note_shares_select_sharee on public.note_shares
  for select to authenticated
  using ((select auth.uid()) = shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 6. Security-definer helpers used by notes and storage RLS policies
--
--    All functions:
--      - security definer: bypass caller's RLS on note_shares / notes,
--        preventing recursive policy evaluation (security-rls-performance)
--      - set search_path = '': blocks search-path injection (security-privileges)
--      - (select auth.uid()) inside the body: hoisted by the planner, evaluated
--        once per query instead of once per row (security-rls-performance)
-- ---------------------------------------------------------------------------

-- can_view_shared_note(p_note_id)
-- True when auth.uid() has any share row (view OR edit) for this note.
-- Used by: notes_select_shared, note_attachments_select_shared,
--           attachments_select_shared (storage).
create or replace function public.can_view_shared_note(p_note_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.note_shares
    where  note_id             = p_note_id
      and  shared_with_user_id = (select auth.uid())
  );
$$;

-- can_edit_shared_note(p_note_id)
-- True only when the share row carries 'edit' permission.
-- Used by: notes_update_shared USING clause.
create or replace function public.can_edit_shared_note(p_note_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.note_shares
    where  note_id             = p_note_id
      and  shared_with_user_id = (select auth.uid())
      and  permission          = 'edit'
  );
$$;

-- note_owner_fields_unchanged(p_note_id, p_user_id, p_pinned, p_archived_at)
-- Used by: notes_update_shared WITH CHECK clause.
--
-- In a WITH CHECK expression, column references resolve to the NEW (proposed)
-- row values being written. This function receives those NEW values and compares
-- them against the currently stored row.
--
-- Returns true only when all owner-only columns are unchanged, preventing a
-- sharee from:
--   • transferring ownership  (user_id)
--   • pinning / unpinning     (pinned)
--   • archiving / unarchiving (archived_at)
--
-- IS NOT DISTINCT FROM is used for archived_at because a plain = comparison
-- returns NULL (not false) when either side is NULL, which would silently
-- allow the update instead of blocking it.
create or replace function public.note_owner_fields_unchanged(
  p_note_id     bigint,
  p_user_id     uuid,
  p_pinned      boolean,
  p_archived_at timestamptz
)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.notes
    where  id          = p_note_id
      and  user_id     = p_user_id
      and  pinned      = p_pinned
      and  archived_at is not distinct from p_archived_at
  );
$$;

-- shares_a_note_with_owner(p_owner_id)
-- True when auth.uid() has at least one share row on any note owned by p_owner_id.
-- Used by: avatars_select_shared (storage) — if you can read any of my notes,
--           you can see my avatar.
--
-- Execution plan (all indexed):
--   a) note_shares.shared_with_user_id_idx → rows for auth.uid()
--   b) PK join to notes(id = note_id)      → O(log n) per match
--   c) Filter notes.user_id = p_owner_id   → stops at first hit (EXISTS)
create or replace function public.shares_a_note_with_owner(p_owner_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.note_shares ns
    join   public.notes        n  on n.id = ns.note_id
    where  n.user_id              = p_owner_id
      and  ns.shared_with_user_id = (select auth.uid())
  );
$$;

-- has_share_relationship_with(p_other_id)
-- True when auth.uid() and p_other_id are in any sharing relationship —
-- either direction (owner→sharee or sharee→owner).
-- Used by: users_select_shared — allows the owner to read the sharee's profile
--           (email, full_name) in the SharePanel, and the sharee to read the
--           owner's profile (full_name, avatar_path) on the shared note card.
create or replace function public.has_share_relationship_with(p_other_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.note_shares ns
    join   public.notes        n  on n.id = ns.note_id
    where (
      -- auth.uid() is the owner, p_other_id is the sharee
      (n.user_id = (select auth.uid()) and ns.shared_with_user_id = p_other_id)
      or
      -- auth.uid() is the sharee, p_other_id is the owner
      (n.user_id = p_other_id and ns.shared_with_user_id = (select auth.uid()))
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. get_user_id_by_email(p_email) — email-to-user lookup RPC
--
--    Returns the UUID and display name for the given email.
--    The caller (authenticated user) never issues a SELECT on public.users
--    for a foreign email — the security-definer function is the only path.
--    Returns an empty result set when no matching account exists (no error).
--    lower(trim()) normalises the input; the users_email_idx covers the lookup.
--    (security-rls-basics, security-privileges, query-missing-indexes)
-- ---------------------------------------------------------------------------
create or replace function public.get_user_id_by_email(p_email text)
  returns table (id uuid, full_name text)
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select u.id, u.full_name
  from   public.users u
  where  u.email = lower(trim(p_email))
  limit  1;
$$;

-- EXECUTE only — authenticated users can call it but cannot SELECT public.users
-- directly for foreign emails.
grant execute on function public.get_user_id_by_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Extend notes policies (additive — existing policies are NOT touched)
--
--    Postgres ORs all permissive policies for the same command:
--    a row is visible/writable if ANY permissive policy passes.
--    The existing notes_select_own / notes_update_own policies handle the
--    owner path; these two policies handle only the sharee path.
--
--    notes_update_shared uses both USING and WITH CHECK:
--      USING      — which existing rows the sharee can target (must have edit share)
--      WITH CHECK — whether the new row written is still permitted (owner-only
--                   columns must be identical to the current stored values)
--    Without WITH CHECK a sharee could change user_id, pinned, or archived_at.
-- ---------------------------------------------------------------------------
create policy notes_select_shared on public.notes
  for select to authenticated
  using (public.can_view_shared_note(id));

create policy notes_update_shared on public.notes
  for update to authenticated
  using (public.can_edit_shared_note(id))
  with check (
    public.can_edit_shared_note(id)
    and public.note_owner_fields_unchanged(id, user_id, pinned, archived_at)
  );

-- ---------------------------------------------------------------------------
-- 9. Extend public.users SELECT policy (additive)
--
--    The existing users_select_own policy lets a user see only their own row.
--    This additive policy allows a user to read the profile row of anyone they
--    have a share relationship with — owner sees sharee's email + full_name
--    (needed for the SharePanel list); sharee sees owner's full_name + avatar_path
--    (needed for the "Shared by" label and avatar on the note card).
-- ---------------------------------------------------------------------------
create policy users_select_shared on public.users
  for select to authenticated
  using (public.has_share_relationship_with(id));

-- ---------------------------------------------------------------------------
-- 10. Extend note_attachments SELECT policy (additive)
--
--     A sharee must be able to SELECT attachment metadata rows to obtain
--     storage_path before calling createSignedUrl. Without this the storage
--     policy alone is useless — the client has no path to sign.
--     can_view_shared_note() uses an indexed lookup on note_shares(note_id).
-- ---------------------------------------------------------------------------
create policy note_attachments_select_shared on public.note_attachments
  for select to authenticated
  using (public.can_view_shared_note(note_id));

-- ---------------------------------------------------------------------------
-- 11. Extend storage SELECT policies (additive — write policies untouched)
--
--     attachments bucket path convention: '<user_id>/<note_id>/<filename>'
--       storage.foldername(name)[2] = note_id (second path segment)
--
--     avatars bucket path convention: '<user_id>/avatar.png'
--       storage.foldername(name)[1] = owner user_id (first path segment)
--
--     (select auth.uid()) is not used directly here — the helper functions
--     handle the hoisting internally. The bucket_id guard ensures each policy
--     fires only for its own bucket.
--     (security-rls-performance, security-rls-basics)
-- ---------------------------------------------------------------------------

-- Sharee can download attachments that belong to notes shared with them.
create policy attachments_select_shared
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_view_shared_note(
      (storage.foldername(name))[2]::bigint
    )
  );

-- Sharee can download the note owner's avatar when they have any share
-- on any of that owner's notes.
create policy avatars_select_shared
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.shares_a_note_with_owner(
      (storage.foldername(name))[1]::uuid
    )
  );
