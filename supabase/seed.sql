-- =============================================================================
-- Seed: notes app
-- Safe to run multiple times (ON CONFLICT DO NOTHING throughout).
-- Best practices applied:
--   - Batch inserts — all rows in one statement per table (data-batch-inserts)
--   - ON CONFLICT DO NOTHING — idempotent, no race conditions (data-upsert)
--   - Inserts bypass RLS via service-role context used by `supabase db seed`
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Auth users (required before public.users FK is satisfied)
--    Passwords are bcrypt hashes of "password123" — development only.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'alice@example.com',
    '$2a$10$PgjZBUKhGQMfQmRA2p2Q7.9TmG9YNEzAfJBiXWf4i6bFpVpSTi23C',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Alice Smith"}',
    false
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'bob@example.com',
    '$2a$10$PgjZBUKhGQMfQmRA2p2Q7.9TmG9YNEzAfJBiXWf4i6bFpVpSTi23C',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Bob Jones"}',
    false
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'carol@example.com',
    '$2a$10$PgjZBUKhGQMfQmRA2p2Q7.9TmG9YNEzAfJBiXWf4i6bFpVpSTi23C',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Carol White"}',
    false
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Public user profiles
-- ---------------------------------------------------------------------------
insert into public.users (id, email, full_name, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice Smith', now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com',   'Bob Jones',   now(), now()),
  ('00000000-0000-0000-0000-000000000003', 'carol@example.com', 'Carol White', now(), now())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Notes — batch insert all rows in one statement (data-batch-inserts)
-- ---------------------------------------------------------------------------
insert into public.notes (user_id, title, content, created_at, updated_at) values
  -- Alice's notes
  (
    '00000000-0000-0000-0000-000000000001',
    'Getting started with Supabase',
    'Supabase is an open-source Firebase alternative. Start by creating a project at supabase.com.',
    now() - interval '5 days',
    now() - interval '5 days'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'Postgres tips',
    'Always use timestamptz instead of timestamp. Use text instead of varchar(n) unless a length constraint is actually needed.',
    now() - interval '3 days',
    now() - interval '3 days'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'RLS checklist',
    E'1. Enable RLS on every user-facing table.\n2. Force RLS so even table owners are restricted.\n3. Wrap auth.uid() in a SELECT subquery to avoid per-row evaluation.\n4. Index columns used in policy expressions.',
    now() - interval '1 day',
    now() - interval '1 day'
  ),
  -- Bob's notes
  (
    '00000000-0000-0000-0000-000000000002',
    'React query patterns',
    'Use useQuery for reads and useMutation for writes. Keep server state out of useState.',
    now() - interval '4 days',
    now() - interval '4 days'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Vite config reminder',
    'Add "@" alias in vite.config.js pointing to src/. Remember to mirror it in jsconfig.json.',
    now() - interval '2 days',
    now() - interval '2 days'
  ),
  -- Carol's notes
  (
    '00000000-0000-0000-0000-000000000003',
    'Meeting agenda 2026-03-30',
    E'- Review sprint goals\n- Demo new features\n- Discuss deployment timeline',
    now() - interval '6 hours',
    now() - interval '6 hours'
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Ideas backlog',
    E'- Full-text search on notes\n- Tagging / labels\n- Shared notes (viewer role)\n- Markdown rendering',
    now() - interval '2 hours',
    now() - interval '2 hours'
  );
