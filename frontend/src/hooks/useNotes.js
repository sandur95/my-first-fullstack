import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Manages the notes list for the authenticated user.
 *
 * All mutation callbacks use the functional form of setNotes — `setNotes(prev => ...)` —
 * so they never close over a stale `notes` value and can be wrapped in useCallback with
 * an empty dependency array. This keeps their references stable and prevents unnecessary
 * child re-renders. (rerender-functional-setstate)
 *
 * @param {string|null} userId - The authenticated user's UUID
 * @param {'active'|'archive'} [tab='active'] - Which set of notes to load
 */
export function useNotes(userId, tab = 'active') {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchNotes = useCallback(async () => {
    if (!userId) {
      setNotes([])
      return
    }
    setLoading(true)
    setError(null)
    // Branch query by tab so each path matches its partial index exactly.
    // Active:  WHERE archived_at IS NULL   → notes_active_user_pinned_created_idx
    // Archive: WHERE archived_at IS NOT NULL → notes_archived_user_created_idx
    // (query-partial-indexes)
    let query = supabase.from('notes').select('*').eq('user_id', userId)
    if (tab === 'archive') {
      query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false })
    } else {
      query = query
        .is('archived_at', null)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
    }
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setNotes(data)
    }
    setLoading(false)
  }, [userId, tab])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  /**
   * @param {string} userId
   * @param {{ title: string, content: string }} fields
   * @returns {Promise<void>}
   */
  const createNote = useCallback(async (userId, { title, content }) => {
    const { data, error } = await supabase
      .from('notes')
      .insert({ user_id: userId, title, content })
      .select()
      .single()
    if (error) throw error
    // Prepend to list — functional update, no stale closure risk
    setNotes(prev =>
      [data, ...prev].toSorted(
        (a, b) =>
          b.pinned - a.pinned ||
          new Date(b.created_at) - new Date(a.created_at)
      )
    )
  }, [])

  /**
   * @param {number} id
   * @param {{ title: string, content: string }} fields
   * @returns {Promise<void>}
   */
  const updateNote = useCallback(async (id, { title, content }) => {
    const { data, error } = await supabase
      .from('notes')
      .update({ title, content })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    // Replace the updated note in the list — functional update
    setNotes(prev => prev.map(n => (n.id === id ? data : n)))
  }, [])

  /**
   * @param {number} id
   * @param {boolean} currentPinned - current value of note.pinned
   * @returns {Promise<void>}
   */
  const pinNote = useCallback(async (id, currentPinned) => {
    const { data, error } = await supabase
      .from('notes')
      .update({ pinned: !currentPinned })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    // Update in-place then re-sort: pinned DESC, created_at DESC.
    // toSorted() returns a new array (immutable) — no stale closure risk.
    // (rerender-functional-setstate, js-tosorted-immutable)
    setNotes(prev =>
      prev
        .map(n => (n.id === id ? data : n))
        .toSorted(
          (a, b) =>
            b.pinned - a.pinned ||
            new Date(b.created_at) - new Date(a.created_at)
        )
    )
  }, [])

  /**
   * @param {number} id
   * @returns {Promise<void>}
   */
  const deleteNote = useCallback(async (id) => {
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) throw error
    // Remove by id — functional update
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  /**
   * Soft-deletes a note by setting archived_at to now().
   * Removes it from the active list immediately. (rerender-functional-setstate)
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  const archiveNote = useCallback(async (id) => {
    const { error } = await supabase
      .from('notes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  /**
   * Restores a note by setting archived_at back to null.
   * Removes it from the archive list immediately. (rerender-functional-setstate)
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  const unarchiveNote = useCallback(async (id) => {
    const { error } = await supabase
      .from('notes')
      .update({ archived_at: null })
      .eq('id', id)
    if (error) throw error
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  return { notes, loading, error, createNote, updateNote, deleteNote, pinNote, archiveNote, unarchiveNote }
}
