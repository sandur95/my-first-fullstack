-- =============================================================================
-- Migration: enable_notes_realtime
-- Adds the notes table to the supabase_realtime publication so that
-- INSERT/UPDATE/DELETE events are streamed to subscribed clients.
--
-- The client-side subscription filter (user_id=eq.<uid>) combined with RLS
-- ensures users only ever receive events for their own notes.
-- =============================================================================

alter publication supabase_realtime add table public.notes;
