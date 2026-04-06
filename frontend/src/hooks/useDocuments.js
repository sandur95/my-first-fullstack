import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Manages the documents list for the authenticated user.
 *
 * All mutation callbacks use the functional form of setDocuments —
 * `setDocuments(prev => ...)` — so they never close over a stale value and
 * can be wrapped in useCallback with a minimal dependency array.
 * (rerender-functional-setstate)
 *
 * @param {string|null} userId - The authenticated user's UUID
 */
export function useDocuments(userId) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchDocuments = useCallback(async () => {
    if (!userId) {
      setDocuments([])
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('documents')
      .select('id, user_id, title, body, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    if (err) {
      setError(err.message)
    } else {
      setDocuments(data ?? [])
    }
    setLoading(false)
  }, [userId])

  // Fetch on mount and when userId changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!userId) { setDocuments([]); return }
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('documents')
        .select('id, user_id, title, body, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (err) setError(err.message)
      else setDocuments(data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  // Realtime subscription: INSERT / UPDATE / DELETE on documents for this user.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('documents-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setDocuments(prev =>
              prev.some(d => d.id === payload.new.id) ? prev : [payload.new, ...prev]
            )
          } else if (payload.eventType === 'UPDATE') {
            setDocuments(prev =>
              prev.map(d => (d.id === payload.new.id ? payload.new : d))
            )
          } else if (payload.eventType === 'DELETE') {
            setDocuments(prev => prev.filter(d => d.id !== payload.old.id))
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  /** Creates a new empty document and returns it. */
  const createDocument = useCallback(async (title) => {
    const { data, error: err } = await supabase
      .from('documents')
      .insert({ user_id: userId, title, body: '' })
      .select()
      .single()
    if (err) throw err
    // Optimistic: Realtime INSERT handler will add it; but if Realtime
    // is delayed the user still sees the new document immediately.
    setDocuments(prev =>
      prev.some(d => d.id === data.id) ? prev : [data, ...prev]
    )
    return data
  }, [userId])

  /** Updates an existing document's title and/or body. */
  const updateDocument = useCallback(async (id, fields) => {
    const { error: err } = await supabase
      .from('documents')
      .update(fields)
      .eq('id', id)
    if (err) throw err
    // Optimistic update — Realtime will reconcile.
    setDocuments(prev =>
      prev.map(d => (d.id === id ? { ...d, ...fields } : d))
    )
  }, [])

  /** Deletes a document permanently. */
  const deleteDocument = useCallback(async (id) => {
    const { error: err } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
    if (err) throw err
    setDocuments(prev => prev.filter(d => d.id !== id))
  }, [])

  return {
    documents,
    loading,
    error,
    createDocument,
    updateDocument,
    deleteDocument,
    fetchDocuments,
  }
}
