-- =============================================================================
-- Migration: enable_attachments_realtime
-- Enables Realtime streaming for note_attachments so that attachment
-- INSERT/DELETE events propagate to all subscribed client tabs.
--
-- REPLICA IDENTITY FULL is required because the default identity only
-- includes the PK (id) in payload.old on DELETE.  Without it, the client
-- can't determine which note an attachment belonged to when removing it.
-- With FULL, payload.old contains all columns — including note_id — so the
-- client can patch the correct note's attachment list without a refetch.
-- =============================================================================

alter table public.note_attachments replica identity full;

alter publication supabase_realtime add table public.note_attachments;
