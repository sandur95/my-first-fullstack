import * as Y from 'yjs'
import { uint8ArrayToBase64, base64ToUint8Array } from './yjs-encoding'

/**
 * Custom Yjs sync provider built on Supabase Realtime Broadcast.
 *
 * Protocol:
 *   1. On subscribe → broadcasts a `yjs-state-request`.
 *   2. Existing peers respond with `yjs-state-response` (full encoded state).
 *   3. Incremental edits are exchanged via `yjs-update` events.
 *
 * If no peer responds within SYNC_TIMEOUT_MS the provider considers itself
 * synced (alone) — the caller should have already applied persisted DB state.
 *
 * Origin tags:
 *   - 'broadcast' — updates received from remote peers (skip re-broadcast)
 *   - any other origin — local edits that should be broadcast
 */

const SYNC_TIMEOUT_MS = 500

export class SupabaseBroadcastProvider {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
   * @param {string} channelName
   * @param {Y.Doc} ydoc
   */
  constructor(supabaseClient, channelName, ydoc) {
    this.supabase = supabaseClient
    this.ydoc = ydoc
    this.synced = false
    this.destroyed = false

    /** @type {Array<(synced: boolean) => void>} */
    this._syncHandlers = []

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._syncTimeout = null

    // --- Yjs update listener: broadcast local changes ---
    this._onUpdate = (update, origin) => {
      if (origin === 'broadcast' || this.destroyed) return
      this.channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: { update: uint8ArrayToBase64(update) },
      })
    }
    ydoc.on('update', this._onUpdate)

    // --- Broadcast channel ---
    this.channel = supabaseClient
      .channel(channelName)
      .on('broadcast', { event: 'yjs-update' }, ({ payload }) => {
        if (this.destroyed) return
        const update = base64ToUint8Array(payload.update)
        Y.applyUpdate(ydoc, update, 'broadcast')
      })
      .on('broadcast', { event: 'yjs-state-request' }, () => {
        if (this.destroyed) return
        // A peer just joined — send them the full state
        const state = Y.encodeStateAsUpdate(ydoc)
        this.channel.send({
          type: 'broadcast',
          event: 'yjs-state-response',
          payload: { state: uint8ArrayToBase64(state) },
        })
      })
      .on('broadcast', { event: 'yjs-state-response' }, ({ payload }) => {
        if (this.destroyed) return
        const state = base64ToUint8Array(payload.state)
        Y.applyUpdate(ydoc, state, 'broadcast')
        this._markSynced()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !this.destroyed) {
          // Ask existing peers for current state
          this.channel.send({
            type: 'broadcast',
            event: 'yjs-state-request',
            payload: {},
          })
          // Fallback: if no peer responds, consider ourselves synced (alone)
          this._syncTimeout = setTimeout(() => {
            this._markSynced()
          }, SYNC_TIMEOUT_MS)
        }
      })
  }

  /** Register a callback that fires once when the provider is synced. */
  onSynced(handler) {
    if (this.synced) {
      handler(true)
    } else {
      this._syncHandlers.push(handler)
    }
  }

  _markSynced() {
    if (this.synced) return
    this.synced = true
    clearTimeout(this._syncTimeout)
    this._syncTimeout = null
    for (const handler of this._syncHandlers) handler(true)
    this._syncHandlers = []
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    clearTimeout(this._syncTimeout)
    this.ydoc.off('update', this._onUpdate)
    this.supabase.removeChannel(this.channel)
  }
}
