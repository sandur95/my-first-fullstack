import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads documents that have been shared with the authenticated user by other owners.
 *
 * Each result item is a normal document object extended with:
 *   - sharePermission: 'view' | 'edit'  — the level of access granted
 *   - owner: { id, full_name, avatar_path }
 *
 * Realtime: two channels keep the list live without page reload.
 *   1. document_shares — share granted (INSERT), revoked (DELETE), permission
 *      changed (UPDATE). Requires REPLICA IDENTITY FULL so DELETE payloads
 *      include document_id.
 *   2. documents (content channel) — UPDATE events on the currently-shared
 *      document IDs.
 *
 * @param {string|null} userId - The authenticated user's UUID (the sharee).
 */
export function useSharedDocuments(userId) {
  const [sharedDocuments, setSharedDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [allSharedDocIds, setAllSharedDocIds] = useState([])
  // Snapshot of sharedDocuments used inside Realtime handlers to avoid
  // adding sharedDocuments as an effect dependency. (rerender-use-ref-transient-values)
  const sharedDocsRef = useRef([])
  useEffect(() => { sharedDocsRef.current = sharedDocuments }, [sharedDocuments])

  const fetchSharedDocuments = useCallback(async () => {
    if (!userId) {
      setSharedDocuments([])
      return
    }
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('document_shares')
      .select(
        'id, permission, documents!inner(*, users!user_id(id, full_name, avatar_path))'
      )
      .eq('shared_with_user_id', userId)
      .order('documents(updated_at)', { ascending: false })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    // Flatten: merge the document fields with the share metadata so the list
    // receives a plain document object augmented with sharePermission + owner.
    const flattened = (data ?? []).map(shareRow => ({
      ...shareRow.documents,
      sharePermission: shareRow.permission,
      owner: shareRow.documents.users ?? null,
      users: undefined,
    }))

    setSharedDocuments(flattened)
    setAllSharedDocIds(flattened.map(d => d.id))
    setLoading(false)
  }, [userId])

  /**
   * Fetches a single share row by document_id — used by the Realtime INSERT
   * handler to get full document details for a newly-granted share.
   * Returns the flattened document object or null when not found.
   */
  const fetchOneSharedDoc = useCallback(async (documentId) => {
    const { data, error: err } = await supabase
      .from('document_shares')
      .select(
        'id, permission, documents!inner(*, users!user_id(id, full_name, avatar_path))'
      )
      .eq('shared_with_user_id', userId)
      .eq('document_id', documentId)
      .maybeSingle()
    if (err || !data) return null
    return {
      ...data.documents,
      sharePermission: data.permission,
      owner: data.documents.users ?? null,
      users: undefined,
    }
  }, [userId])

  /**
   * Updates the title and/or body of a shared document.
   * Only callable when permission === 'edit'.
   * The documents_update_shared RLS policy enforces this at the DB level;
   * any attempt to change user_id is blocked by the
   * document_owner_fields_unchanged WITH CHECK constraint.
   *
   * @param {number} docId
   * @param {{ title?: string, body?: string }} fields
   * @returns {Promise<string|null>} Error message string, or null on success.
   */
  const updateSharedDocument = useCallback(async (docId, fields) => {
    const { error: err } = await supabase
      .from('documents')
      .update(fields)
      .eq('id', docId)
    if (err) return err.message

    // Optimistic local update
    setSharedDocuments(prev =>
      prev.map(d => (d.id === docId ? { ...d, ...fields } : d))
    )
    return null
  }, [])

  // ---------------------------------------------------------------------------
  // Realtime channel 1: document_shares
  // Handles share granted (INSERT), revoked (DELETE), permission changed (UPDATE).
  //
  // Filter: shared_with_user_id=eq.${userId} — applied server-side for INSERT/UPDATE.
  // DELETE events are not server-side filterable (Supabase limitation); the
  // client-side filter is the safety net.
  // REPLICA IDENTITY FULL ensures payload.old.document_id is available on DELETE.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return

    const sharesChannel = supabase
      .channel(`document_shares:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_shares',
          filter: `shared_with_user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAllSharedDocIds(prev =>
              prev.includes(payload.new.document_id) ? prev : [...prev, payload.new.document_id]
            )
            fetchOneSharedDoc(payload.new.document_id).then(doc => {
              if (!doc) return
              setSharedDocuments(prev => {
                if (prev.some(d => d.id === doc.id)) return prev // deduplicate
                return [doc, ...prev]
              })
            })
          } else if (payload.eventType === 'DELETE') {
            setAllSharedDocIds(prev => prev.filter(id => id !== payload.old.document_id))
            setSharedDocuments(prev => prev.filter(d => d.id !== payload.old.document_id))
          } else if (payload.eventType === 'UPDATE') {
            setSharedDocuments(prev =>
              prev.map(d =>
                d.id === payload.new.document_id
                  ? { ...d, sharePermission: payload.new.permission }
                  : d
              )
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(sharesChannel) }
  }, [userId, fetchOneSharedDoc])

  // ---------------------------------------------------------------------------
  // Realtime channel 2: documents content
  // Listens for UPDATE events on ALL shared document IDs.
  //
  // allSharedDocIdsKey is a sorted comma-separated primitive string;
  // Object.is prevents channel recreation on content-only updates while
  // correctly recreating it when the share set changes.
  // ---------------------------------------------------------------------------
  const allSharedDocIdsKey = [...allSharedDocIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (!userId || !allSharedDocIdsKey) return

    const docsChannel = supabase
      .channel(`shared-docs-content:${userId}:${allSharedDocIdsKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'documents',
          filter: `id=in.(${allSharedDocIdsKey})`,
        },
        (payload) => {
          const updated = payload.new
          setSharedDocuments(prev =>
            prev.map(d =>
              d.id === updated.id
                ? { ...d, title: updated.title, body: updated.body, updated_at: updated.updated_at }
                : d
            )
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(docsChannel) }
  }, [userId, allSharedDocIdsKey])

  return { sharedDocuments, loading, error, fetchSharedDocuments, updateSharedDocument }
}
