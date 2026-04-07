-- =============================================================================
-- Migration: create_document_shares
-- Adds document-sharing support: a document owner can grant another user either
-- view-only or edit access to a specific document.
--
-- Mirrors the note_shares pattern from 20260403000000 but for documents.
-- Documents are simpler — no pinned, archived_at, tags, or attachments.
--
-- Best practices applied:
--   - Reuses existing share_permission enum (renamed from note_permission)
--   - bigint generated always as identity PK (schema-primary-keys)
--   - timestamptz for created_at (schema-data-types)
--   - UNIQUE (document_id, shared_with_user_id): one share row per pair
--   - FK indexes on both FK columns (schema-foreign-key-indexes)
--   - RLS enabled + forced on document_shares (security-rls-basics)
--   - (select auth.uid()) subquery — evaluated once per query (security-rls-performance)
--   - security definer + set search_path = '' on all helpers (security-privileges)
--   - All new documents/users policies are additive; no existing policy is
--     dropped or replaced.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rename the permission enum to a resource-agnostic name.
--    ALTER TYPE … RENAME TO is metadata-only (updates pg_type.typname).
--    Postgres tracks types by OID, so note_shares.permission continues to
--    work without any column or policy change.
--    Unlike ALTER TYPE … ADD VALUE, RENAME can safely run inside a transaction.
-- ---------------------------------------------------------------------------
alter type public.note_permission rename to share_permission;

-- ---------------------------------------------------------------------------
-- 2. document_shares table
-- ---------------------------------------------------------------------------
create table public.document_shares (
  id                  bigint                 not null generated always as identity primary key,
  document_id         bigint                 not null references public.documents (id) on delete cascade,
  shared_with_user_id uuid                   not null references public.users (id) on delete cascade,
  permission          public.share_permission not null default 'view',
  created_at          timestamptz            not null default now(),
  unique (document_id, shared_with_user_id)
);

comment on table  public.document_shares is
  'Grants a user read (view) or write (edit) access to a document they do not own.';
comment on column public.document_shares.permission is
  'view = read-only (rendered Markdown preview only); '
  'edit = may change title and body. Delete remains owner-only.';

-- ---------------------------------------------------------------------------
-- 3. Indexes
--    document_id — required for ON DELETE CASCADE performance and owner-policy joins.
--    shared_with_user_id — used by every RLS helper lookup on this table.
--    (schema-foreign-key-indexes, security-rls-performance, query-missing-indexes)
-- ---------------------------------------------------------------------------
create index document_shares_document_id_idx
  on public.document_shares (document_id);

create index document_shares_shared_with_user_id_idx
  on public.document_shares (shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 4. Self-share prevention trigger
--    Fires before any INSERT or UPDATE on document_shares.
--    Raises an exception when the sharee is the document owner.
--    security definer + set search_path = '': prevents search-path injection.
--    (security-privileges, security-rls-basics)
-- ---------------------------------------------------------------------------
create or replace function public.prevent_document_self_share()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (
    select 1
    from   public.documents
    where  id      = new.document_id
      and  user_id = new.shared_with_user_id
  ) then
    raise exception
      'Cannot share a document with its owner (document_id=%, user_id=%)',
      new.document_id, new.shared_with_user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger document_shares_prevent_self_share
  before insert or update on public.document_shares
  for each row execute function public.prevent_document_self_share();

-- ---------------------------------------------------------------------------
-- 5. owns_document(p_document_id) — security-definer helper
--    Mirrors owns_note() from 20260401000002_create_tags.sql.
--    (security-rls-performance)
-- ---------------------------------------------------------------------------
create or replace function public.owns_document(p_document_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.documents
    where  id      = p_document_id
      and  user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security — document_shares
-- ---------------------------------------------------------------------------
alter table public.document_shares enable row level security;
alter table public.document_shares force row level security;

-- Owner sees all shares for documents they own.
create policy document_shares_select_owner on public.document_shares
  for select to authenticated
  using (public.owns_document(document_id));

-- Owner can create shares for documents they own.
create policy document_shares_insert_owner on public.document_shares
  for insert to authenticated
  with check (public.owns_document(document_id));

-- Owner can change the permission level of an existing share.
create policy document_shares_update_owner on public.document_shares
  for update to authenticated
  using      (public.owns_document(document_id))
  with check (public.owns_document(document_id));

-- Owner can revoke shares for documents they own.
create policy document_shares_delete_owner on public.document_shares
  for delete to authenticated
  using (public.owns_document(document_id));

-- Sharee can see their own share row (needed for the client to read
-- the permission level and for useSharedDocuments to build the list).
create policy document_shares_select_sharee on public.document_shares
  for select to authenticated
  using ((select auth.uid()) = shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 7. Security-definer helpers used by documents RLS policies
--
--    All functions:
--      - security definer: bypass caller's RLS on document_shares / documents,
--        preventing recursive policy evaluation (security-rls-performance)
--      - set search_path = '': blocks search-path injection (security-privileges)
--      - (select auth.uid()) inside the body: hoisted by the planner, evaluated
--        once per query instead of once per row (security-rls-performance)
-- ---------------------------------------------------------------------------

-- can_view_shared_document(p_document_id)
-- True when auth.uid() has any share row (view OR edit) for this document.
create or replace function public.can_view_shared_document(p_document_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.document_shares
    where  document_id         = p_document_id
      and  shared_with_user_id = (select auth.uid())
  );
$$;

-- can_edit_shared_document(p_document_id)
-- True only when the share row carries 'edit' permission.
create or replace function public.can_edit_shared_document(p_document_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.document_shares
    where  document_id         = p_document_id
      and  shared_with_user_id = (select auth.uid())
      and  permission          = 'edit'
  );
$$;

-- document_owner_fields_unchanged(p_document_id, p_user_id)
-- Documents only have user_id as an owner-only field (no pinned/archived_at).
-- In a WITH CHECK expression, column references resolve to the NEW (proposed)
-- row values. This function receives the NEW user_id and compares it against
-- the currently stored row, preventing a sharee from transferring ownership.
create or replace function public.document_owner_fields_unchanged(
  p_document_id bigint,
  p_user_id     uuid
)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.documents
    where  id      = p_document_id
      and  user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 8. Extend documents policies (additive — existing policies are NOT touched)
--
--    Postgres ORs all permissive policies for the same command:
--    a row is visible/writable if ANY permissive policy passes.
--    The existing documents_select_own / documents_update_own policies handle
--    the owner path; these two policies handle only the sharee path.
--
--    documents_update_shared uses both USING and WITH CHECK:
--      USING      — which existing rows the sharee can target (must have edit share)
--      WITH CHECK — whether the new row written is still permitted (user_id must
--                   be identical to the current stored value)
--    Without WITH CHECK a sharee could change user_id.
-- ---------------------------------------------------------------------------
create policy documents_select_shared on public.documents
  for select to authenticated
  using (public.can_view_shared_document(id));

create policy documents_update_shared on public.documents
  for update to authenticated
  using (public.can_edit_shared_document(id))
  with check (
    public.can_edit_shared_document(id)
    and public.document_owner_fields_unchanged(id, user_id)
  );

-- ---------------------------------------------------------------------------
-- 9. Extend has_share_relationship_with() to cover document shares
--
--    The existing function (from 20260403000000) only checks note_shares.
--    CREATE OR REPLACE adds an OR branch for document_shares so that the
--    existing users_select_shared policy — which calls this function —
--    also allows profile visibility for document sharing relationships.
--
--    No new policy is needed on public.users; the existing policy re-evaluates
--    using this updated function body.
-- ---------------------------------------------------------------------------
create or replace function public.has_share_relationship_with(p_other_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    -- Note sharing relationships (original)
    select 1
    from   public.note_shares ns
    join   public.notes        n  on n.id = ns.note_id
    where (
      (n.user_id = (select auth.uid()) and ns.shared_with_user_id = p_other_id)
      or
      (n.user_id = p_other_id and ns.shared_with_user_id = (select auth.uid()))
    )
  )
  or exists (
    -- Document sharing relationships (new)
    select 1
    from   public.document_shares ds
    join   public.documents        d  on d.id = ds.document_id
    where (
      (d.user_id = (select auth.uid()) and ds.shared_with_user_id = p_other_id)
      or
      (d.user_id = p_other_id and ds.shared_with_user_id = (select auth.uid()))
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 10. Realtime
--     REPLICA IDENTITY FULL is required so that DELETE payloads include all
--     columns (document_id, shared_with_user_id) — not just the PK id.
--     Without it, the sharee client cannot determine which document a deleted
--     share belonged to.
-- ---------------------------------------------------------------------------
alter table public.document_shares replica identity full;

alter publication supabase_realtime add table public.document_shares;
