import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 10

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
 * @param {string} [search=''] - Full-text search query; empty string disables search
 */
export function useNotes(userId, tab = 'active', search = '') {
  const [notes, setNotes] = useState([])
  const [totalCount, setTotalCount] = useState(null)
  // nextOffset tracks the DB boundary: how many rows have been fetched so far.
  // Reset to PAGE_SIZE by fetchNotes; incremented by PAGE_SIZE by loadMore.
  const [nextOffset, setNextOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  // Derived: unfetched rows exist when not searching and the DB count exceeds
  // the number of rows we have loaded so far. Search always returns all matches
  // at once so hasMore stays false during a search. (data-pagination)
  const hasMore = !search && totalCount !== null && nextOffset < totalCount

  const fetchNotes = useCallback(async () => {
    if (!userId) {
      setNotes([])
      setTotalCount(null)
      return
    }
    setLoading(true)
    setError(null)
    // Branch query by tab so each path matches its partial index exactly.
    // Active:  WHERE archived_at IS NULL   → notes_active_user_pinned_created_idx
    // Archive: WHERE archived_at IS NOT NULL → notes_archived_user_created_idx
    // (query-partial-indexes)
    // count: 'exact' asks PostgREST to return the total row count alongside data
    // so hasMore can be derived without a separate COUNT query. (data-pagination)
    let query = supabase
      .from('notes')
      .select('*, note_tags(tag_id, tags(id, name))', { count: 'exact' })
      .eq('user_id', userId)
    if (tab === 'archive') {
      query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false })
    } else {
      query = query
        .is('archived_at', null)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
      // Full-text search — only on active tab because the GIN index is partial
      // (WHERE archived_at IS NULL); applying textSearch to the archive tab would
      // force a sequential scan.  websearch_to_tsquery handles natural user input
      // (spaces = AND, "phrase", -exclude) without sanitisation on our side.
      // (advanced-full-text-search)
      if (search) {
        query = query.textSearch('search_vector', search, { type: 'websearch', config: 'english' })
      }
    }
    // Paginate only when not searching — search returns all matching rows at once.
    // Offset pagination is appropriate at personal-notes scale. (data-pagination)
    if (!search) {
      query = query.range(0, PAGE_SIZE - 1)
    }
    const { data, error, count } = await query
    if (error) {
      setError(error.message)
    } else {
      setNotes(data)
      setTotalCount(count)
      // For search: all results are in data, advance offset past the full set so
      // hasMore stays false. For normal fetch: advance by PAGE_SIZE.
      setNextOffset(search ? (data?.length ?? 0) : PAGE_SIZE)
    }
    setLoading(false)
  }, [userId, tab, search])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  /**
   * Fetches the next page and appends it to the existing list.
   * Only callable when hasMore is true; never called during a search.
   */
  const loadMore = useCallback(async () => {
    if (!userId) return
    setLoadingMore(true)
    setError(null)
    let query = supabase
      .from('notes')
      .select('*, note_tags(tag_id, tags(id, name))', { count: 'exact' })
      .eq('user_id', userId)
    if (tab === 'archive') {
      query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false })
    } else {
      query = query
        .is('archived_at', null)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
    }
    query = query.range(nextOffset, nextOffset + PAGE_SIZE - 1)
    const { data, error, count } = await query
    if (error) {
      setError(error.message)
    } else {
      setNotes(prev => [...prev, ...data])  // append — functional update (rerender-functional-setstate)
      setTotalCount(count)
      setNextOffset(prev => prev + PAGE_SIZE)
    }
    setLoadingMore(false)
  }, [userId, tab, nextOffset])

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
      [{ ...data, note_tags: [] }, ...prev].toSorted(
        (a, b) =>
          b.pinned - a.pinned ||
          new Date(b.created_at) - new Date(a.created_at)
      )
    )
    return data.id
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
    // Preserve existing note_tags — update only changed title/content
    setNotes(prev => prev.map(n => (n.id === id ? { ...data, note_tags: n.note_tags } : n)))
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
    // Preserve existing note_tags — pin toggle does not affect tags.
    // toSorted() returns a new array (immutable) — no stale closure risk.
    // (rerender-functional-setstate, js-tosorted-immutable)
    setNotes(prev =>
      prev
        .map(n => (n.id === id ? { ...data, note_tags: n.note_tags } : n))
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

  /**
   * Replaces all tag associations for a note (delete-then-insert).
   * Updates local state immediately without a refetch.
   * (rerender-functional-setstate)
   *
   * @param {number} noteId
   * @param {number[]} tagIds
   * @param {import('../lib/database.types').Tag[]} allTags
   * @returns {Promise<void>}
   */
  const updateNoteTags = useCallback(async (noteId, tagIds, allTags) => {
    const { error: delError } = await supabase
      .from('note_tags')
      .delete()
      .eq('note_id', noteId)
    if (delError) throw delError
    if (tagIds.length > 0) {
      const { error: insError } = await supabase
        .from('note_tags')
        .insert(tagIds.map(tid => ({ note_id: noteId, tag_id: tid })))
      if (insError) throw insError
    }
    const tagMap = new Map(allTags.map(t => [t.id, t]))
    setNotes(prev =>
      prev.map(n =>
        n.id === noteId
          ? { ...n, note_tags: tagIds.map(tid => ({ tag_id: tid, tags: tagMap.get(tid) })) }
          : n
      )
    )
  }, [])

  return { notes, loading, error, loadingMore, loadMore, hasMore, createNote, updateNote, deleteNote, pinNote, archiveNote, unarchiveNote, updateNoteTags }
}
