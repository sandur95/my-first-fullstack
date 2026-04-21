import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { SupabaseBroadcastProvider } from '../../lib/SupabaseBroadcastProvider'
import { uint8ArrayToBase64 } from '../../lib/yjs-encoding'

// ---------------------------------------------------------------------------
// Fake Supabase channel factory
// ---------------------------------------------------------------------------
function buildFakeChannel() {
  const handlers = {} // event → handler

  const sendSpy = vi.fn()
  const httpSendSpy = vi.fn()

  const fakeChannel = {
    on: vi.fn((type, { event }, cb) => {
      handlers[event] = cb
      return fakeChannel
    }),
    // Fire the callback asynchronously (microtask) so that `this.channel`
    // is fully assigned before `_send` is called inside the subscribe callback.
    // Real Supabase subscribe fires after the WebSocket handshake (async).
    subscribe: vi.fn((cb) => {
      Promise.resolve().then(() => cb('SUBSCRIBED'))
      return fakeChannel
    }),
    send: sendSpy,
    httpSend: httpSendSpy,
    unsubscribe: vi.fn(),
    // canPush → true so _send() uses channel.send() (not httpSend)
    channelAdapter: { canPush: vi.fn(() => true) },
  }

  return { fakeChannel, handlers, sendSpy, httpSendSpy }
}

function buildFakeSupabase(fakeChannel) {
  return {
    channel: vi.fn(() => fakeChannel),
    removeChannel: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SupabaseBroadcastProvider', () => {
  let ydoc
  let fakeChannel
  let handlers
  let sendSpy

  beforeEach(() => {
    vi.useFakeTimers()
    ydoc = new Y.Doc()
    const built = buildFakeChannel()
    fakeChannel = built.fakeChannel
    handlers = built.handlers
    sendSpy = built.sendSpy
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('(a) yjs-state-response sets synced=true and applies remote state', async () => {
    const remoteDoc = new Y.Doc()
    remoteDoc.getText('body').insert(0, 'hello from peer')
    const remoteState = Y.encodeStateAsUpdate(remoteDoc)

    const provider = new SupabaseBroadcastProvider(
      buildFakeSupabase(fakeChannel),
      'test-channel',
      ydoc,
    )

    // Flush microtasks so subscribe callback fires and this.channel is usable
    await Promise.resolve()

    expect(provider.synced).toBe(false)

    // Simulate a peer responding with its full state
    handlers['yjs-state-response']({
      payload: { state: uint8ArrayToBase64(remoteState) },
    })

    expect(provider.synced).toBe(true)
    expect(ydoc.getText('body').toString()).toBe('hello from peer')
  })

  it('(b) 500 ms timeout self-syncs when no peer responds', async () => {
    const provider = new SupabaseBroadcastProvider(
      buildFakeSupabase(fakeChannel),
      'test-channel',
      ydoc,
    )

    await Promise.resolve() // flush microtasks (subscribe callback fires)
    expect(provider.synced).toBe(false)
    vi.advanceTimersByTime(500)
    expect(provider.synced).toBe(true)
  })

  it('(c) local Yjs edit calls channel.send with a yjs-update event', async () => {
    new SupabaseBroadcastProvider(buildFakeSupabase(fakeChannel), 'ch', ydoc)
    // Flush microtasks so subscribe callback fires (sends state-request, presence-request)
    await Promise.resolve()
    // Clear sends triggered by subscribe()
    sendSpy.mockClear()

    // Local edit — origin is not 'broadcast', so it should be broadcast
    ydoc.getText('body').insert(0, 'local edit')

    expect(sendSpy).toHaveBeenCalledOnce()
    const call = sendSpy.mock.calls[0][0]
    expect(call.event).toBe('yjs-update')
    expect(typeof call.payload.update).toBe('string')
  })

  it('(d) remote yjs-update (origin=broadcast) does NOT re-broadcast', async () => {
    new SupabaseBroadcastProvider(buildFakeSupabase(fakeChannel), 'ch', ydoc)
    await Promise.resolve() // flush microtasks
    sendSpy.mockClear()

    // Simulate receiving an update from a remote peer
    const remoteDoc = new Y.Doc()
    remoteDoc.getText('body').insert(0, 'remote edit')
    const update = Y.encodeStateAsUpdate(remoteDoc)
    handlers['yjs-update']({ payload: { update: uint8ArrayToBase64(update) } })

    expect(sendSpy).not.toHaveBeenCalled()
    // The text should have been applied locally
    expect(ydoc.getText('body').toString()).toBe('remote edit')
  })
})
