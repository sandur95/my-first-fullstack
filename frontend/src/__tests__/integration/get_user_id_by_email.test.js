// @vitest-environment node
/**
 * Integration tests for the get_user_id_by_email RPC.
 *
 * Prerequisites:
 *   - `supabase start` must be running
 *   - `supabase db seed` (or `supabase db reset`) must have run to create
 *     Alice, Bob, and Carol in auth.users and public.users
 *   - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_SERVICE_ROLE_KEY
 *     must be set (see frontend/.env.local)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { ALICE, BOB, adminClient, signInAs } from '../helpers/supabase-clients'

let aliceClient

beforeAll(async () => {
  aliceClient = await signInAs(ALICE)
})

describe('get_user_id_by_email RPC', () => {
  it('(a) known email returns correct UUID and full_name', async () => {
    const { data, error } = await aliceClient.rpc('get_user_id_by_email', {
      p_email: BOB.email,
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(BOB.id)
    expect(typeof data[0].full_name).toBe('string')
  })

  it('(b) unknown email returns an empty array', async () => {
    const { data, error } = await aliceClient.rpc('get_user_id_by_email', {
      p_email: 'nobody-does-not-exist@example.com',
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('(c) admin can SELECT from public.users', async () => {
    const { data, error } = await adminClient
      .from('users')
      .select('id, email')
      .eq('id', BOB.id)
      .single()

    expect(error).toBeNull()
    expect(data.id).toBe(BOB.id)
    expect(data.email).toBe(BOB.email)
  })
})
