-- =============================================================================
-- Migration: create_user_profile_trigger
-- Automatically creates a public.users profile row whenever a new user
-- signs up via Supabase Auth (any method: email, OAuth, magic link, etc.).
--
-- Why a trigger instead of application code:
--   - Works for every auth method without per-method app logic
--   - Atomic with the auth.users insert — no window where a user exists
--     in auth but not in public.users (which would break the FK constraint)
--   - security definer + explicit search_path prevents search-path injection
-- =============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
