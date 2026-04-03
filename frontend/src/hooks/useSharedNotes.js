import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads notes that have been shared with the authenticated user by other owners.
 *
 * Each result item is a normal note object extended with:
 *   - sharePermission: 'view' | 'edit'  — the level of access granted
 *   - owner: { id, full_name, avatar_path }
 *
 * Realtime: two channels keep the list live without page reload.
 *   1. note_shares — share granted (INSERT), revoked (DELETE), permission changed (UPDATE).
 *      Requires ALTER TABLE note_shares REPLICA IDENTITY FULL (migration 20260403000001)
 *      so that DELETE payloads include note_id (not just the PK id).
 *   2. notes (content channel) — UPDATE events on the currently-shared note IDs.
 *      sharedNoteIdsKey is a sorted comma-separated primitive string computed inline;
 *      Object.is prevents channel recreation on content-only updates while correctly
 *      recreating it when the share set changes. (rerender-dependencies)
 *
 * @param {string|null} userId - The authenticated user's UUID (the sharee).
 */
export function useSharedNotes(userId) {
  const [sharedNotes, setSharedNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // All note IDs shared with this user — including archived ones.
  // Channel 2 subscribes to this wider set so that an unarchive UPDATE
  // is received even after the note was removed from the visible list.
  const [allSharedNoteIds, setAllSharedNoteIds] = useState([])
  // Snapshot of sharedNotes used inside Realtime handlers to tell
  // "visible" from "shared but archived" without adding sharedNotes
  // as an effect dependency. (rerender-use-ref-transient-values)
  const sharedNotesRef = useRef([])
  useEffect(() => { sharedNotesRef.current = sharedNotes }, [sharedNotes])

  const fetchSharedNotes = useCallback(async () => {
    if (!userId) {
      setSharedNotes([])
      return
    }
    setLoading(true)
    setError(null)

    // Run both queries in parallel:
    //   - visible notes (archived_at IS NULL, full nested select)
    //   - all shared note IDs without any archived filter, for widening
    //     the Channel 2 subscription so unarchive UPDATEs are received.
    // (async-parallel)
    const [
      { data, error: err },
      { data: allIdsData },
    ] = await Promise.all([
      supabase
        .from('note_shares')
        .select(
          'id, permission, notes!inner(*, note_tags(tag_id, tags(id, name)), note_attachments(id, storage_path, file_name, mime_type, file_size), users!user_id(id, full_name, avatar_path))'
        )
        .eq('shared_with_user_id', userId)
        .is('notes.archived_at', null)
        .order('notes(created_at)', { ascending: false }),
      supabase
        .from('note_shares')
        .select('note_id')
        .eq('shared_with_user_id', userId),
    ])

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    // Flatten: merge the note fields with the share metadata so NoteCard
    // receives a plain note object augmented with sharePermission + owner.
    const flattened = (data ?? []).map(shareRow => ({
      ...shareRow.notes,
      sharePermission: shareRow.permission,
      owner: shareRow.notes.users ?? null,
      // Remove the nested users key from the note object so it isn't
      // accidentally accessed as note.users elsewhere.
      users: undefined,
    }))

    setSharedNotes(flattened)
    setAllSharedNoteIds((allIdsData ?? []).map(r => r.note_id))
    setLoading(false)
  }, [userId])

  /**
   * Fetches a single share row by note_id — used by the Realtime INSERT handler to
   * get full note details (tags, attachments, owner) for a newly-granted share.
   * Returns the flattened note object or null when not found / archived.
   */
  const fetchOneSharedNote = useCallback(async (noteId) => {
    const { data, error: err } = await supabase
      .from('note_shares')
      .select(
        'id, permission, notes!inner(*, note_tags(tag_id, tags(id, name)), note_attachments(id, storage_path, file_name, mime_type, file_size), users!user_id(id, full_name, avatar_path))'
      )
      .eq('shared_with_user_id', userId)
      .eq('note_id', noteId)
      .is('notes.archived_at', null)
      .maybeSingle()
    if (err || !data) return null
    return {
      ...data.notes,
      sharePermission: data.permission,
      owner: data.notes.users ?? null,
      users: undefined,
    }
  }, [userId])

  /**
   * Updates the title and/or content of a shared note.
   * Only callable when permission === 'edit'.
   * The notes_update_shared RLS policy enforces this at the DB level;
   * any attempt to change user_id, pinned, or archived_at is blocked by
   * the note_owner_fields_unchanged WITH CHECK constraint.
   *
   * @param {number} noteId
   * @param {{ title: string, content: string }} fields
   * @returns {Promise<string|null>} Error message string, or null on success.
   */
  const updateSharedNote = useCallback(async (noteId, { title, content }) => {
    const { error: err } = await supabase
      .from('notes')
      .update({ title, content })
      .eq('id', noteId)
    if (err) return err.message

    // Optimistic local update
    setSharedNotes(prev =>
      prev.map(n => (n.id === noteId ? { ...n, title, content } : n))
    )
    return null
  }, [])

  // ---------------------------------------------------------------------------
  // Realtime channel 1: note_shares
  // Handles share granted (INSERT), revoked (DELETE), permission changed (UPDATE).
  //
  // Filter: shared_with_user_id=eq.${userId} — applied server-side for INSERT/UPDATE.
  // DELETE events are not server-side filterable (Supabase limitation); the
  // client-side filter `n.id !== payload.old.note_id` is the safety net — if the
  // deletion belongs to another user, the note_id won't be in the list → no-op.
  // REPLICA IDENTITY FULL ensures payload.old.note_id is available on DELETE.
  //
  // Channel is created once per user login/logout. (rerender-functional-setstate)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return

    const sharesChannel = supabase
      .channel(`note_shares:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'note_shares',
          filter: `shared_with_user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // New share granted → track ID for Channel 2, fetch full note, prepend.
            setAllSharedNoteIds(prev =>
              prev.includes(payload.new.note_id) ? prev : [...prev, payload.new.note_id]
            )
            fetchOneSharedNote(payload.new.note_id).then(note => {
              if (!note) return
              setSharedNotes(prev => {
                if (prev.some(n => n.id === note.id)) return prev // deduplicate
                return [note, ...prev]
              })
            })
          } else if (payload.eventType === 'DELETE') {
            // Share revoked — REPLICA IDENTITY FULL gives us note_id in payload.old.
            setAllSharedNoteIds(prev => prev.filter(id => id !== payload.old.note_id))
            setSharedNotes(prev => prev.filter(n => n.id !== payload.old.note_id))
          } else if (payload.eventType === 'UPDATE') {
            // Permission level changed.
            setSharedNotes(prev =>
              prev.map(n =>
                n.id === payload.new.note_id
                  ? { ...n, sharePermission: payload.new.permission }
                  : n
              )
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(sharesChannel) }
  }, [userId, fetchOneSharedNote])

  // ---------------------------------------------------------------------------
  // Realtime channel 2: notes content
  // Listens for UPDATE events on ALL shared note IDs — including archived ones.
  //
  // allSharedNoteIdsKey is derived from allSharedNoteIds (which includes archived
  // notes). This ensures that when the owner unarchives a shared note, the UPDATE
  // event is delivered and the note is re-added to the visible list.
  //
  // The primitive string dep means Object.is prevents channel recreation on
  // content-only updates (IDs unchanged); the channel IS recreated when the share
  // set changes. (rerender-dependencies)
  //
  // Supabase Realtime `in` filter supports up to 100 values — fine at personal scale.
  // ---------------------------------------------------------------------------
  const allSharedNoteIdsKey = [...allSharedNoteIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (!userId || !allSharedNoteIdsKey) return

    const notesChannel = supabase
      .channel(`shared-notes-content:${userId}:${allSharedNoteIdsKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notes',
          filter: `id=in.(${allSharedNoteIdsKey})`,
        },
        (payload) => {
          const updated = payload.new
          // Archived → remove from visible list.
          if (updated.archived_at) {
            setSharedNotes(prev => prev.filter(n => n.id !== updated.id))
            return
          }
          // sharedNotesRef lets us check visibility without adding sharedNotes
          // as a dep (which would recreate the channel on every content update).
          // (rerender-use-ref-transient-values)
          if (!sharedNotesRef.current.some(n => n.id === updated.id)) {
            // Note was archived (not in visible list) and is now unarchived →
            // fetch full details (tags, attachments, owner) and re-add.
            fetchOneSharedNote(updated.id).then(note => {
              if (!note) return
              setSharedNotes(prev =>
                prev.some(n => n.id === note.id) ? prev : [note, ...prev]
              )
            })
            return
          }
          // In-place content update for a visible note.
          // Fetch fresh tags + attachments in parallel, preserving sharePermission
          // and owner (they are not on the notes row). (async-parallel)
          Promise.all([
            supabase.from('note_tags').select('tag_id, tags(id, name)').eq('note_id', updated.id),
            supabase.from('note_attachments').select('id, storage_path, file_name, mime_type, file_size').eq('note_id', updated.id),
          ]).then(([{ data: tagData }, { data: attachData }]) => {
            setSharedNotes(prev =>
              prev.map(n =>
                n.id === updated.id
                  ? {
                      ...updated,
                      sharePermission: n.sharePermission,
                      owner: n.owner,
                      note_tags: tagData ?? n.note_tags,
                      note_attachments: attachData ?? n.note_attachments,
                    }
                  : n
              )
            )
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(notesChannel) }
  }, [userId, allSharedNoteIdsKey, fetchOneSharedNote]) // allSharedNoteIdsKey is a primitive string

  // ---------------------------------------------------------------------------
  // Realtime channel 3: note_attachments
  // Listens for INSERT and DELETE on note_attachments for all shared note IDs.
  //
  // Why a separate channel: uploading or deleting an attachment does not touch
  // the notes row, so Channel 2 (UPDATE on notes) never fires for these events.
  // note_attachments is already in the Realtime publication with REPLICA IDENTITY
  // FULL (migration 20260402000002), and the note_attachments_select_shared RLS
  // policy lets the sharee pass Realtime's row-visibility check (migration
  // 20260403000000).
  //
  // INSERT → append the new attachment to the matching note's list.
  // DELETE → REPLICA IDENTITY FULL provides payload.old with note_id + id, so
  //          the client can remove the exact attachment without a refetch.
  //
  // Channel is recreated when the share set changes (allSharedNoteIdsKey changes).
  // (rerender-dependencies)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!userId || !allSharedNoteIdsKey) return

    const attachmentsChannel = supabase
      .channel(`shared-notes-attachments:${userId}:${allSharedNoteIdsKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'note_attachments',
          filter: `note_id=in.(${allSharedNoteIdsKey})`,
        },
        (payload) => {
          const att = payload.new
          setSharedNotes(prev =>
            prev.map(n =>
              n.id === att.note_id
                ? { ...n, note_attachments: [...(n.note_attachments ?? []), att] }
                : n
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'note_attachments',
          filter: `note_id=in.(${allSharedNoteIdsKey})`,
        },
        (payload) => {
          const att = payload.old
          setSharedNotes(prev =>
            prev.map(n =>
              n.id === att.note_id
                ? { ...n, note_attachments: (n.note_attachments ?? []).filter(a => a.id !== att.id) }
                : n
            )
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(attachmentsChannel) }
  }, [userId, allSharedNoteIdsKey]) // allSharedNoteIdsKey is a primitive string

  return { sharedNotes, loading, error, fetchSharedNotes, updateSharedNote }
}
