import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribes to Supabase Auth state and exposes the current session.
 *
 * Uses a single useEffect that:
 *  1. Loads the initial session with getSession()
 *  2. Subscribes to onAuthStateChange for subsequent changes
 *  3. Cleans up the subscription on unmount
 *
 * Combining both into one effect prevents a race condition where the
 * onAuthStateChange listener could fire before the initial getSession()
 * call resolves, causing a flicker between authenticated and unauthenticated states.
 *
 * @returns {{ session: import('@supabase/supabase-js').Session|null, loading: boolean }}
 */
export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load current session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Keep session in sync with any auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { session, loading }
}
