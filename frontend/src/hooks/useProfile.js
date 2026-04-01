import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches and manages the authenticated user's public profile.
 *
 * updateFullName uses useCallback with [userId] in deps. userId is stable for
 * the lifetime of a session but is an external value, so it is included for
 * correctness. (rerender-functional-setstate)
 *
 * @param {string|null} userId - The authenticated user's UUID
 */
export function useProfile(userId) {
  const [fullName, setFullName] = useState(null)

  // Fetch once on mount / whenever userId changes
  useEffect(() => {
    if (!userId) return
    supabase
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data) setFullName(data.full_name)
      })
  }, [userId])

  /**
   * Persists a new full name and updates local state immediately — no refetch needed.
   * An empty string is stored as NULL; no ghost empty-string values in the DB.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  const updateFullName = useCallback(async (name) => {
    const trimmed = name.trim() || null
    const { error } = await supabase
      .from('users')
      .update({ full_name: trimmed })
      .eq('id', userId)
    if (error) throw error
    setFullName(trimmed)
  }, [userId])

  return { fullName, updateFullName }
}
