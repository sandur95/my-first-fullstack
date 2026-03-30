import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in your values.'
  )
}

/**
 * Singleton Supabase client.
 *
 * Always import from this file instead of constructing a new createClient()
 * elsewhere. Multiple clients cause duplicate onAuthStateChange subscriptions
 * and independent session caches that can drift out of sync.
 *
 * The anon key is intentionally public — Row Level Security on the database
 * controls what data each authenticated user can access.
 *
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
