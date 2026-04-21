// @vitest-environment node
/**
 * Integration tests for Realtime events on note_shares.
 *
 * Prerequisites:
 *   - `supabase start` must be running
 *   - `supabase db seed` (or `supabase db reset`) must have seeded Alice and Bob
 *   - The note_shares table must have REPLICA IDENTITY FULL set (required for
 *     the DELETE event test to include old record data in the payload)
 *   - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_SERVICE_ROLE_KEY
 *     must be set (see frontend/.env.local)
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { ALICE, BOB, adminClient, signInAs } from '../helpers/supabase-clients'

let aliceClient
let testNoteId

beforeAll(async () => {
  // Alice is the note owner — her JWT satisfies the RLS policy so Realtime
  // delivers fully-populated payloads (including payload.old on DELETE).
  aliceClient = await signInAs(ALICE)

  // Seed a note owned by Alice
  const { data, error } = await adminClient
    .from('notes')
    .insert({ user_id: ALICE.id, title: 'Realtime test note', content: '' })
    .select('id')
    .single()

  if (error) throw new Error(`beforeAll seed failed: ${error.message}`)
  testNoteId = data.id
})

afterEach(async () => {
  // Remove any share rows left by a test
  await adminClient
    .from('note_shares')
    .delete()
    .eq('note_id', testNoteId)
})

// ---------------------------------------------------------------------------
// Helper: subscribe to a table event and return two promises:
//   readyPromise  — resolves when the channel is SUBSCRIBED
//   eventPromise  — resolves with the first matching postgres_changes payload
// ---------------------------------------------------------------------------
function createEventWatcher(client, table, eventType, timeoutMs = 8000) {
  let resolveReady, resolveEvent, rejectEvent

  const readyPromise = new Promise(res => { resolveReady = res })
  const eventPromise = new Promise((res, rej) => {
    resolveEvent = res
    rejectEvent = rej
  })

  const timer = setTimeout(() => {
    rejectEvent(new Error(`Timed out (${timeoutMs}ms) waiting for ${eventType} on ${table}`))
  }, timeoutMs)

  const channel = client
    .channel(`test-realtime-${table}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: eventType, schema: 'public', table },
      (payload) => {
        clearTimeout(timer)
        client.removeChannel(channel)
        resolveEvent(payload)
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') resolveReady()
    })

  return { readyPromise, eventPromise }
}

describe('note_shares Realtime', () => {
  it('5.1 INSERT event — payload contains note_id and shared_with_user_id', async () => {
    const { readyPromise, eventPromise } = createEventWatcher(aliceClient, 'note_shares', 'INSERT')

    // Wait for the WebSocket subscription to be fully established before inserting
    await readyPromise

    await adminClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    const payload = await eventPromise
    expect(payload.new.note_id).toBe(testNoteId)
    expect(payload.new.shared_with_user_id).toBe(BOB.id)
  })

  it('5.2 DELETE event — payload.old is delivered (validates REPLICA IDENTITY FULL enables RLS-filtered DELETE)', async () => {
    // Insert first so we have something to delete
    await adminClient
      .from('note_shares')
      .insert({ note_id: testNoteId, shared_with_user_id: BOB.id, permission: 'view' })

    const { readyPromise, eventPromise } = createEventWatcher(aliceClient, 'note_shares', 'DELETE')

    // Wait for subscription before triggering the delete
    await readyPromise

    await adminClient
      .from('note_shares')
      .delete()
      .eq('note_id', testNoteId)
      .eq('shared_with_user_id', BOB.id)

    const payload = await eventPromise
    // REPLICA IDENTITY FULL lets Realtime evaluate Alice's SELECT RLS policy
    // on the deleted row, so the DELETE event IS delivered to Alice (the note
    // owner) rather than being silently dropped.
    // In this version of Supabase Realtime the client payload.old contains the
    // primary key only — the server uses the full old row internally for the
    // RLS check but does not forward all columns to the client.
    expect(payload.old).toBeDefined()
    expect(typeof payload.old.id).toBe('number')
  })
})

