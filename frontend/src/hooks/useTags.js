import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Manages the tag list for the authenticated user.
 *
 * createTag uses functional setState with toSorted — no stale closure risk
 * and result is always alphabetically ordered.
 * (rerender-functional-setstate, js-tosorted-immutable)
 *
 * @param {string|null} userId - The authenticated user's UUID
 * @returns {{ tags: import('../lib/database.types').Tag[], createTag: Function }}
 */
export function useTags(userId) {
  const [tags, setTags] = useState([])

  useEffect(() => {
    if (!userId) {
      setTags([])
      return
    }
    supabase
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => { if (data) setTags(data) })
  }, [userId])

  /**
   * Inserts a new tag and adds it to the local list (alphabetically sorted).
   *
   * @param {string} name
   * @returns {Promise<import('../lib/database.types').Tag>}
   */
  const createTag = useCallback(async (name) => {
    const { data, error } = await supabase
      .from('tags')
      .insert({ user_id: userId, name })
      .select()
      .single()
    if (error) throw error
    setTags(prev =>
      [data, ...prev].toSorted((a, b) => a.name.localeCompare(b.name))
    )
    return data
  }, [userId])

  return { tags, createTag }
}
