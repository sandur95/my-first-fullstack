-- =============================================================================
-- Migration: tags + note_tags tables with RLS
-- Best practices applied:
--   - (select auth.uid()) subquery in every policy — evaluated once per query,
--     not once per row  (security-rls-performance)
--   - FK indexes on every FK column not already covered by a PK
--     (schema-foreign-key-indexes)
--   - security-definer helper avoids a per-row join to notes inside note_tags
--     policies  (security-rls-performance)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tags table
--    One tag belongs to exactly one user; names are unique per user.
-- ---------------------------------------------------------------------------
create table public.tags (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references public.users (id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- FK index — user_id is not part of a primary key on tags (schema-foreign-key-indexes)
create index tags_user_id_idx on public.tags (user_id);

alter table public.tags enable row level security;
alter table public.tags force row level security;

-- Use (select auth.uid()) to hoist the function call outside the per-row loop
-- (security-rls-performance)
create policy "tags_select_own"
  on public.tags for select
  using ((select auth.uid()) = user_id);

create policy "tags_insert_own"
  on public.tags for insert
  with check ((select auth.uid()) = user_id);

create policy "tags_update_own"
  on public.tags for update
  using  ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "tags_delete_own"
  on public.tags for delete
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Security-definer helper: owns_note(p_note_id bigint)
--    Returns true when the calling user owns the note.
--    Avoids a correlated sub-query to public.notes inside every note_tags
--    policy row evaluation.  (security-rls-performance)
-- ---------------------------------------------------------------------------
create or replace function public.owns_note(p_note_id bigint)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from   public.notes
    where  id      = p_note_id
      and  user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Note_tags join table
--    Composite PK (note_id, tag_id) covers the note_id FK automatically;
--    we only need an extra index on tag_id.  (schema-foreign-key-indexes)
-- ---------------------------------------------------------------------------
create table public.note_tags (
  note_id bigint not null references public.notes (id) on delete cascade,
  tag_id  bigint not null references public.tags  (id) on delete cascade,
  primary key (note_id, tag_id)
);

-- FK index on tag_id (note_id already covered by composite PK)
create index note_tags_tag_id_idx on public.note_tags (tag_id);

alter table public.note_tags enable row level security;
alter table public.note_tags force row level security;

-- note_tags has no user_id column — ownership is determined via the note.
-- The security-definer helper prevents a per-row join to notes.
create policy "note_tags_select_own"
  on public.note_tags for select
  using (public.owns_note(note_id));

create policy "note_tags_insert_own"
  on public.note_tags for insert
  with check (public.owns_note(note_id));

create policy "note_tags_delete_own"
  on public.note_tags for delete
  using (public.owns_note(note_id));
-- No UPDATE policy — callers delete + re-insert to change tags.
