// @vitest-environment node
/**
 * Integration tests for note_shares RLS policies.
 *
 * Prerequisites:
 *   - `supabase start` must be running
 *   - `supabase db seed` (or `supabase db reset`) must have seeded Alice, Bob, Carol
 *   - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_SERVICE_ROLE_KEY
 *     must be set (see frontend/.env.local)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { ALICE, BOB, adminClient, signInAs } from '../helpers/supabase-clients'

let aliceClient
let bobClient
let testNoteId

beforeAll(async () => {
  aliceClient = await signInAs(ALICE)
  bobClient   = await signInAs(BOB)
})

beforeEach(async () => {
  // Seed: create a note owned by Alice via admin (bypasses RLS)
  const { data, error } = await adminClient
    .from('notes')
    .insert({ user_id: ALICE.id, title: 'RLS test note', content: 'content' })
    .select('id')
    .single()

  if (error) throw new Error(`beforeEach seed failed: ${error.message}`)
  testNoteId = data.id
})

afterEach(async () => {
  // Clean up: delete the note and any share rows (cascade should handle shares)
  await adminClient.from('notes').delete().eq('id', testNoteId)
})

describe('note_shares RLS', () => {
  it('(a) owner (Alice) can insert a share row for Bob', async () => {
    const { error } = await aliceClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    expect(error).toBeNull()
  })

  it('(b) non-owner (Bob) cannot insert a share row for Alice\'s note', async () => {
    const { error } = await bobClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    expect(error).not.toBeNull()
  })

  it('(c) self-share attempt returns code 23514 (check_violation)', async () => {
    const { error } = await aliceClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: ALICE.id, permission: 'view' })

    expect(error).not.toBeNull()
    expect(error.code).toBe('23514')
  })

  it('(d) duplicate share attempt returns code 23505 (unique_violation)', async () => {
    // First share succeeds
    await aliceClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    // Second identical share should violate the unique constraint
    const { error } = await aliceClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'edit' })

    expect(error).not.toBeNull()
    expect(error.code).toBe('23505')
  })

  it('(e) owner (Alice) can delete a share row', async () => {
    // Create the share first
    await aliceClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    const { error } = await aliceClient
      .from('note_shares')
      .delete()
      .eq('note_id', testNoteId)
      .eq('shared_with_user_id', BOB.id)

    expect(error).toBeNull()
  })
})
