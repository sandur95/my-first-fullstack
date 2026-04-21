import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY ?? ''

// ---------------------------------------------------------------------------
// Seed user fixtures (created by supabase/seed.sql)
// ---------------------------------------------------------------------------
export const ALICE = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  password: 'password123',
}

export const BOB = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'bob@example.com',
  password: 'password123',
}

export const CAROL = {
  id: '00000000-0000-0000-0000-000000000003',
  email: 'carol@example.com',
  password: 'password123',
}

// ---------------------------------------------------------------------------
// Admin (service-role) client — bypasses RLS, used for test fixture setup
// ---------------------------------------------------------------------------
export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Sign in a seed user and return an authenticated client.
// Each call creates a fresh client so tests are isolated.
// ---------------------------------------------------------------------------
export async function signInAs({ email, password }) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInAs(${email}) failed: ${error.message}`)
  return client
}
