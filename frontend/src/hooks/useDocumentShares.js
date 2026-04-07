import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Manages the share list for a single document.
 *
 * Only usable by the document owner — the document_shares RLS policies allow
 * the owner to read, insert, update, and delete share rows for documents they own.
 *
 * @param {number|null} documentId - The document whose shares are being managed.
 */
export function useDocumentShares(documentId) {
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch all shares for this document, expanding the sharee's profile.
  // users_select_shared allows the owner to read the sharee's full_name + email.
  const fetchShares = useCallback(async () => {
    if (!documentId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('document_shares')
      .select('id, permission, created_at, users!shared_with_user_id(id, full_name, email)')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true })
    if (err) {
      setError(err.message)
    } else {
      setShares(data ?? [])
    }
    setLoading(false)
  }, [documentId])

  /**
   * Looks up the user by email (via the security-definer RPC) then inserts
   * a share row.
   *
   * @param {string} email
   * @param {'view'|'edit'} permission
   * @returns {Promise<string|null>} Error message string, or null on success.
   */
  const shareByEmail = useCallback(async (email, permission) => {
    if (!documentId) return 'No document selected.'

    // Resolve email → { id, full_name } via the security-definer RPC.
    const { data: userRows, error: lookupErr } = await supabase
      .rpc('get_user_id_by_email', { p_email: email.trim().toLowerCase() })
    if (lookupErr) return lookupErr.message
    if (!userRows || userRows.length === 0) return 'No account found with that email address.'

    const { id: shareeId } = userRows[0]

    const { data: inserted, error: insertErr } = await supabase
      .from('document_shares')
      .insert({ document_id: documentId, shared_with_user_id: shareeId, permission })
      .select('id, permission, created_at, users!shared_with_user_id(id, full_name, email)')
      .single()

    if (insertErr) {
      // 23505 = unique_violation: duplicate share for this (document, user) pair
      if (insertErr.code === '23505') return 'This document is already shared with that user.'
      // check_violation from the prevent_document_self_share trigger
      if (insertErr.code === '23514') return 'You cannot share a document with yourself.'
      return insertErr.message
    }

    // Optimistic state update — no refetch needed
    setShares(prev => [...prev, inserted])
    return null
  }, [documentId])

  /**
   * Updates the permission level of an existing share row.
   *
   * @param {number} shareId
   * @param {'view'|'edit'} permission
   * @returns {Promise<string|null>} Error message string, or null on success.
   */
  const updatePermission = useCallback(async (shareId, permission) => {
    const { data: updated, error: err } = await supabase
      .from('document_shares')
      .update({ permission })
      .eq('id', shareId)
      .select('id, permission, created_at, users!shared_with_user_id(id, full_name, email)')
      .single()
    if (err) return err.message
    setShares(prev => prev.map(s => (s.id === shareId ? updated : s)))
    return null
  }, [])

  /**
   * Revokes a share row, removing the sharee's access to the document.
   *
   * @param {number} shareId
   * @returns {Promise<string|null>} Error message string, or null on success.
   */
  const revokeShare = useCallback(async (shareId) => {
    const { error: err } = await supabase
      .from('document_shares')
      .delete()
      .eq('id', shareId)
    if (err) return err.message
    setShares(prev => prev.filter(s => s.id !== shareId))
    return null
  }, [])

  return { shares, loading, error, fetchShares, shareByEmail, updatePermission, revokeShare }
}
