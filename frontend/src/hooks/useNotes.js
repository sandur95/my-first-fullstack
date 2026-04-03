import { useState, useEffect, useCallback, useRef } from 'react'
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

  // Refs for the Realtime handler — lets the handler read current tab/search values
  // without being listed as effect dependencies. This prevents the subscription from
  // being torn down and recreated on every tab switch or keypress.
  // (rerender-use-ref-transient-values)
  const tabRef = useRef(tab)
  const searchRef = useRef(search)
  // Tracks which tab was fetched manually inside a startTransition, so the
  // auto-fetch effect can skip the redundant re-fetch after the transition commits.
  // (rendering-usetransition-loading)
  const transitionFetchedRef = useRef(null)
  useEffect(() => { tabRef.current = tab }, [tab])
  useEffect(() => { searchRef.current = search }, [search])

  const fetchNotes = useCallback(async (tabOverride) => {
    // When called with an explicit tab (from a startTransition), record it so the
    // auto-fetch effect skips the redundant re-fetch after the transition commits.
    // Only set when actually switching tabs to avoid stale-skip bugs.
    // (rendering-usetransition-loading)
    if (tabOverride !== undefined && tabOverride !== tab) {
      transitionFetchedRef.current = tabOverride
    }
    if (!userId) {
      setNotes([])
      setTotalCount(null)
      return
    }
    const effectiveTab = tabOverride ?? tab
    // Archive never uses the search term (the GIN index is partial on archived_at IS NULL).
    const effectiveSearch = effectiveTab === 'archive' ? '' : search
    setLoading(true)
    // Clear notes only for non-transition fetches (initial load, search change) so the
    // loading guard in NotesList shows "Loading…" instead of stale content.
    // Transition fetches keep old notes visible (dimmed via isPending) until the new
    // ones arrive — no empty intermediate state. (rendering-usetransition-loading)
    if (tabOverride === undefined) setNotes([])
    setError(null)
    // Branch query by tab so each path matches its partial index exactly.
    // Active:  WHERE archived_at IS NULL   → notes_active_user_pinned_created_idx
    // Archive: WHERE archived_at IS NOT NULL → notes_archived_user_created_idx
    // (query-partial-indexes)
    // count: 'exact' asks PostgREST to return the total row count alongside data
    // so hasMore can be derived without a separate COUNT query. (data-pagination)
    let query = supabase
      .from('notes')
      .select('*, note_tags(tag_id, tags(id, name)), note_attachments(id, storage_path, file_name, mime_type, file_size)', { count: 'exact' })
      .eq('user_id', userId)
    if (effectiveTab === 'archive') {
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
      if (effectiveSearch) {
        query = query.textSearch('search_vector', effectiveSearch, { type: 'websearch', config: 'english' })
      }
    }
    // Paginate only when not searching — search returns all matching rows at once.
    // Offset pagination is appropriate at personal-notes scale. (data-pagination)
    if (!effectiveSearch) {
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
      setNextOffset(effectiveSearch ? (data?.length ?? 0) : PAGE_SIZE)
    }
    setLoading(false)
  }, [userId, tab, search])

  // Skip the auto-fetch when a startTransition already fetched notes for the
  // incoming tab, to prevent a redundant double-fetch after the transition commits.
  // (rendering-usetransition-loading)
  useEffect(() => {
    if (transitionFetchedRef.current === tabRef.current) {
      transitionFetchedRef.current = null
      return
    }
    fetchNotes()
  }, [fetchNotes])

  // Realtime subscription — applies INSERT/UPDATE/DELETE events from other browser
  // tabs directly to local state without refetching the whole list.
  // One channel per userId covers all tabs; tabRef/searchRef let the handler read
  // the current tab and search term without being listed as effect dependencies,
  // so the WebSocket channel is only (re)created when the user logs in or out.
  // (rerender-use-ref-transient-values, rerender-functional-setstate)
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`notes:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const currentTab = tabRef.current

          if (payload.eventType === 'INSERT') {
            setNotes(prev => {
              // Deduplicate: createNote() already inserted the row optimistically
              if (prev.some(n => n.id === payload.new.id)) return prev
              // Skip inserts while searching — can't validate the note against
              // the current FTS query client-side; user will see it on clear.
              if (searchRef.current) return prev
              // New notes always have archived_at IS NULL → active tab only
              if (currentTab !== 'active') return prev
              return [{ ...payload.new, note_tags: [] }, ...prev]
                .toSorted((a, b) => b.pinned - a.pinned || new Date(b.created_at) - new Date(a.created_at))
            })
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new
            // archived_at is either a timestamp string (truthy) or null/undefined (falsy).
            // Using truthy/falsy guards instead of strict === null because Supabase Realtime
            // may deliver archived_at as undefined (field omitted) rather than explicit null
            // when the column is set back to NULL.  Both undefined and null mean "not archived".
            //
            // Tab-switch cases are handled synchronously — no tag fetch needed.
            // Note moved out of the current tab (archive/unarchive) → remove immediately.
            if (currentTab === 'active' && updated.archived_at) {
              // Note archived — archived_at became a timestamp; remove from active list.
              setNotes(prev => prev.filter(n => n.id !== updated.id))
            } else if (currentTab === 'archive' && !updated.archived_at) {
              // Note unarchived — archived_at became null/undefined; remove from archive list.
              setNotes(prev => prev.filter(n => n.id !== updated.id))
            } else {
              // In-place update (note stays in current tab), OR note entering current tab
              // from the other side (e.g. another tab unarchived a note while we're on active).
              // Fetch fresh note_tags AND note_attachments in parallel so tag changes and
              // attachment deletions from other tabs are reflected without a full refetch.
              // tabRef is re-read inside setNotes to guard against a tab change during fetches.
              // (async-parallel, rerender-use-ref-transient-values)
              Promise.all([
                supabase.from('note_tags').select('tag_id, tags(id, name)').eq('note_id', updated.id),
                supabase.from('note_attachments').select('id, storage_path, file_name, mime_type, file_size').eq('note_id', updated.id),
              ]).then(([{ data: tagData }, { data: attachData }]) => {
                setNotes(prev => {
                  const cur = tabRef.current
                  // Re-check tab after async gap (user may have switched tabs).
                  if (cur === 'active' && updated.archived_at) {
                    return prev.filter(n => n.id !== updated.id)
                  }
                  if (cur === 'archive' && !updated.archived_at) {
                    return prev.filter(n => n.id !== updated.id)
                  }
                  // Note not in list yet: insert if it now belongs here.
                  // Happens when another tab unarchives a note — the active tab
                  // receives the UPDATE but the note was never in its list.
                  // Skip while searching — can't validate the note against the
                  // current FTS query client-side. (rerender-functional-setstate)
                  if (!prev.some(n => n.id === updated.id)) {
                    if (cur === 'active' && !updated.archived_at && !searchRef.current) {
                      const newNote = { ...updated, note_tags: tagData ?? [], note_attachments: attachData ?? [] }
                      return [...prev, newNote]
                        .toSorted((a, b) => b.pinned - a.pinned || new Date(b.created_at) - new Date(a.created_at))
                    }
                    return prev
                  }
                  const sort = cur === 'archive'
                    ? (a, b) => new Date(b.archived_at) - new Date(a.archived_at)
                    : (a, b) => b.pinned - a.pinned || new Date(b.created_at) - new Date(a.created_at)
                  return prev
                    .map(n => n.id === updated.id
                      ? { ...updated, note_tags: tagData ?? n.note_tags, note_attachments: attachData ?? n.note_attachments }
                      : n
                    )
                    .toSorted(sort)
                })
              })
            }
          } else if (payload.eventType === 'DELETE') {
            // payload.old contains only the PK (id) without REPLICA IDENTITY FULL
            setNotes(prev => prev.filter(n => n.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Realtime subscription for note_attachments — keeps attachment lists in sync
  // across tabs without requiring a full note refetch.
  //
  // REPLICA IDENTITY FULL is set on note_attachments (migration 20260402000002) so
  // payload.old on DELETE contains all columns, including note_id.
  // The channel is keyed by userId and is only (re)created on login/logout.
  // (rerender-use-ref-transient-values, rerender-functional-setstate)
  //
  // Only INSERT events are handled here.  DELETE sync is driven via the notes
  // Realtime channel instead: removeAttachmentFromNote touches notes.updated_at
  // after every deletion, which fires a notes UPDATE event that all tabs receive.
  // That UPDATE handler fetches fresh note_attachments from the DB, giving Tab 2
  // the authoritative post-deletion list.
  //
  // Why not use the note_attachments Realtime DELETE event?
  // Supabase Realtime authorises DELETE event delivery by running a SELECT on the
  // live table with the subscribing user's JWT.  The row is already gone by then,
  // so the SELECT returns 0 rows, the auth check "fails", and the event is silently
  // dropped on all tabs except the one that initiated the delete.  REPLICA IDENTITY
  // FULL ensures payload.old has all columns, but the local Realtime server still
  // does a live-table lookup rather than evaluating the policy against WAL data.
  useEffect(() => {
    if (!userId) return

    const attachmentChannel = supabase
      .channel(`note_attachments:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'note_attachments',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new
          setNotes(prev => prev.map(n => {
            if (n.id !== row.note_id) return n
            // Deduplicate: addAttachmentToNote / handleSave may have already
            // appended this row optimistically before Realtime fires.
            if ((n.note_attachments ?? []).some(a => a.id === row.id)) return n
            return { ...n, note_attachments: [...(n.note_attachments ?? []), row] }
          }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(attachmentChannel) }
  }, [userId])

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
      .select('*, note_tags(tag_id, tags(id, name)), note_attachments(id, storage_path, file_name, mime_type, file_size)', { count: 'exact' })
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
    // Preserve existing note_tags and note_attachments — update only changed title/content
    setNotes(prev => prev.map(n => (n.id === id ? { ...data, note_tags: n.note_tags, note_attachments: n.note_attachments } : n)))
  }, [])

  /**
   * @param {number} id
   * @param {boolean} currentPinned - current value of note.pinned
   * @returns {Promise<void>}
   */
  const pinNote = useCallback(async (id, currentPinned) => {
    let snapshot
    setNotes(prev => {
      snapshot = prev
      return prev
        .map(n => (n.id === id ? { ...n, pinned: !currentPinned } : n))
        .toSorted((a, b) => b.pinned - a.pinned || new Date(b.created_at) - new Date(a.created_at))
    })
    const { data, error } = await supabase
      .from('notes')
      .update({ pinned: !currentPinned })
      .eq('id', id)
      .select()
      .single()
    if (error) { setNotes(snapshot); throw error }
    // Reconcile with server row; preserve note_tags.
    setNotes(prev =>
      prev
        .map(n => (n.id === id ? { ...data, note_tags: n.note_tags } : n))
        .toSorted((a, b) => b.pinned - a.pinned || new Date(b.created_at) - new Date(a.created_at))
    )
  }, [])

  /**
   * @param {number} id
   * @returns {Promise<void>}
   */
  const deleteNote = useCallback(async (id) => {
    // Capture storage paths and a snapshot before optimistically removing the note.
    // note_attachments are always loaded alongside each note row (no separate pagination).
    let storagePaths = []
    let snapshot
    setNotes(prev => {
      snapshot = prev
      const note = prev.find(n => n.id === id)
      storagePaths = (note?.note_attachments ?? []).map(a => a.storage_path)
      return prev.filter(n => n.id !== id)
    })
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) { setNotes(snapshot); throw error }
    // ON DELETE CASCADE already removed all note_attachments rows in the DB.
    // Now clean up the storage objects. Fire-and-forget — a missed deletion leaves
    // orphaned objects that are permanently inaccessible (no DB row → no signed URL).
    if (storagePaths.length > 0) {
      supabase.storage.from('attachments').remove(storagePaths).then(null, () => {})
    }
  }, [])

  /**
   * Soft-deletes a note by setting archived_at to now().
   * Removes it from the active list immediately. (rerender-functional-setstate)
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  const archiveNote = useCallback(async (id) => {
    let snapshot
    setNotes(prev => { snapshot = prev; return prev.filter(n => n.id !== id) })
    const { error } = await supabase
      .from('notes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { setNotes(snapshot); throw error }
  }, [])

  /**
   * Restores a note by setting archived_at back to null.
   * Removes it from the archive list immediately. (rerender-functional-setstate)
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  const unarchiveNote = useCallback(async (id) => {
    let snapshot
    setNotes(prev => { snapshot = prev; return prev.filter(n => n.id !== id) })
    const { error } = await supabase
      .from('notes')
      .update({ archived_at: null })
      .eq('id', id)
    if (error) { setNotes(snapshot); throw error }
  }, [])

  /**
   * Replaces all tag associations for a note (delete-then-insert), then bumps
   * notes.updated_at so the existing Realtime channel broadcasts an UPDATE event
   * to all other tabs — they re-fetch the note's tags and patch their local state.
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
    // Touch notes.updated_at AFTER note_tags rows are committed so the Realtime
    // UPDATE event arrives on other tabs only once the new tags are readable.
    const { error: touchError } = await supabase
      .from('notes')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', noteId)
    if (touchError) throw touchError
    // Update the originating tab's state immediately without waiting for the
    // Realtime echo — builds tag objects from the already-available allTags list.
    // (js-index-maps: Map for O(1) lookups)
    const tagMap = new Map(allTags.map(t => [t.id, t]))
    setNotes(prev =>
      prev.map(n =>
        n.id === noteId
          ? { ...n, note_tags: tagIds.map(tid => ({ tag_id: tid, tags: tagMap.get(tid) })) }
          : n
      )
    )
  }, [])

  /**
   * Appends a newly-uploaded attachment row to a note's local attachment list.
   * Called by NotesList after a successful upload to update list state immediately.
   * Functional setNotes — no stale-closure risk. (rerender-functional-setstate)
   *
   * @param {number} noteId
   * @param {object} row - The inserted note_attachments row
   */
  const addAttachmentToNote = useCallback((noteId, row) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId
        ? { ...n, note_attachments: [...(n.note_attachments ?? []), row] }
        : n
    ))
  }, [])

  /**
   * Optimistically removes an attachment from local state, then deletes the
   * storage object and the metadata row.  Restores the snapshot on any error.
   * (rerender-functional-setstate)
   *
   * Deletes storage first so that if the DB delete fails we don't end up with
   * a live DB row pointing at a deleted file.
   *
   * @param {number} noteId
   * @param {{ id: number, storage_path: string }} attachment
   */
  const removeAttachmentFromNote = useCallback(async (noteId, attachment) => {
    let snapshot
    setNotes(prev => {
      snapshot = prev
      return prev.map(n =>
        n.id === noteId
          ? { ...n, note_attachments: (n.note_attachments ?? []).filter(a => a.id !== attachment.id) }
          : n
      )
    })
    try {
      const { error: storageErr } = await supabase.storage
        .from('attachments')
        .remove([attachment.storage_path])
      if (storageErr) throw storageErr

      const { error: dbErr } = await supabase
        .from('note_attachments')
        .delete()
        .eq('id', attachment.id)
      if (dbErr) throw dbErr
    } catch (err) {
      setNotes(snapshot)
      throw err
    }

    // Touch notes.updated_at so all other tabs receive a notes Realtime UPDATE
    // event and re-fetch note_attachments from the DB — this is the reliable
    // cross-tab deletion sync path (see channel comment above).
    // Fire-and-forget: the delete already succeeded; sync failure is non-fatal.
    supabase
      .from('notes')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .then(null, () => {})
  }, [])

  return { notes, loading, error, loadingMore, loadMore, hasMore, createNote, updateNote, deleteNote, pinNote, archiveNote, unarchiveNote, updateNoteTags, fetchNotes, addAttachmentToNote, removeAttachmentFromNote }
}
