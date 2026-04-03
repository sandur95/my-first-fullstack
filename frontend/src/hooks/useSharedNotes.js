import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads notes that have been shared with the authenticated user by other owners.
 *
 * The notes are fetched via note_shares (where shared_with_user_id = userId), with
 * nested selects for note content, tags, attachments, and the owner's profile row.
 *
 * RLS enforcement:
 *   - notes_select_shared: sharee can SELECT the note row (can_view_shared_note)
 *   - note_attachments_select_shared: sharee can SELECT metadata rows
 *   - users_select_shared: sharee can SELECT the owner's profile (has_share_relationship_with)
 *
 * Each result item is a normal note object extended with:
 *   - sharePermission: 'view' | 'edit'  — the level of access granted
 *   - owner: { id, full_name, avatar_path }
 *
 * No Realtime subscription — sharee sees updates on manual tab switch.
 *
 * @param {string|null} userId - The authenticated user's UUID (the sharee).
 */
export function useSharedNotes(userId) {
  const [sharedNotes, setSharedNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchSharedNotes = useCallback(async () => {
    if (!userId) {
      setSharedNotes([])
      return
    }
    setLoading(true)
    setError(null)

    // Join through note_shares to get the notes plus owner profile.
    // notes!inner ensures the join is INNER — share rows whose note was
    // deleted cascade-delete automatically, but this guards against stale rows.
    // Archived notes are excluded: archived_at IS NULL enforced at query time.
    // (data-n-plus-one: single query fetches notes + tags + attachments + owner)
    const { data, error: err } = await supabase
      .from('note_shares')
      .select(
        'id, permission, notes!inner(*, note_tags(tag_id, tags(id, name)), note_attachments(id, storage_path, file_name, mime_type, file_size), users!user_id(id, full_name, avatar_path))'
      )
      .eq('shared_with_user_id', userId)
      .is('notes.archived_at', null)
      .order('notes(created_at)', { ascending: false })

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
    setLoading(false)
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

  return { sharedNotes, loading, error, fetchSharedNotes, updateSharedNote }
}
