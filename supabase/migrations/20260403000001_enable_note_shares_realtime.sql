-- =============================================================================
-- Migration: enable_note_shares_realtime
-- Enables Realtime streaming for note_shares so that share grant / revoke /
-- permission-change events propagate immediately to subscribed sharee clients.
--
-- REPLICA IDENTITY FULL is required because:
--   - The default identity only includes the PK (id) in payload.old on DELETE.
--   - Without it, the sharee client cannot determine which note a deleted share
--     belonged to (note_id is not in the WAL payload).
--   - With FULL, payload.old contains all columns including note_id and
--     shared_with_user_id, so the client removes the correct note from the
--     "Shared with me" list without a full refetch.
--
-- Note: Supabase Realtime DELETE events cannot be server-side filtered due to
-- a Postgres WAL limitation. The client-side handler uses client filtering
-- (note_id not in list → no-op) as the safety net. REPLICA IDENTITY FULL
-- ensures those client-side guards have the columns they need.
-- =============================================================================

alter table public.note_shares replica identity full;

alter publication supabase_realtime add table public.note_shares;
