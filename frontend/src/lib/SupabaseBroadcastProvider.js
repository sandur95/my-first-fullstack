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
 * Presence (ephemeral, never persisted):
 *   - `presence-update` — each client broadcasts user info + cursor position.
 *   - `presence-request` — a newly joined client asks others to re-broadcast.
 *   - `presence-leave` — sent on page unload so peers remove the user immediately.
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

    // --- Presence callbacks (set by usePresence) ---
    /** @type {((state: object) => void) | null} */
    this._onPresenceUpdate = null
    /** @type {((userId: string) => void) | null} */
    this._onPresenceLeave = null
    /** @type {(() => void) | null} */
    this._onPresenceRequest = null

    // --- Title callback (set by DocumentEditor) ---
    /** @type {((title: string) => void) | null} */
    this._onTitleUpdate = null

    // --- Yjs update listener: broadcast local changes ---
    this._onUpdate = (update, origin) => {
      if (origin === 'broadcast' || this.destroyed) return
      this._send('yjs-update', { update: uint8ArrayToBase64(update) })
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
        this._send('yjs-state-response', { state: uint8ArrayToBase64(state) })
      })
      .on('broadcast', { event: 'yjs-state-response' }, ({ payload }) => {
        if (this.destroyed) return
        const state = base64ToUint8Array(payload.state)
        Y.applyUpdate(ydoc, state, 'broadcast')
        this._markSynced()
      })
      // --- Presence events ---
      .on('broadcast', { event: 'presence-update' }, ({ payload }) => {
        if (this.destroyed) return
        this._onPresenceUpdate?.(payload)
      })
      .on('broadcast', { event: 'presence-request' }, () => {
        if (this.destroyed) return
        this._onPresenceRequest?.()
      })
      .on('broadcast', { event: 'presence-leave' }, ({ payload }) => {
        if (this.destroyed) return
        this._onPresenceLeave?.(payload.userId)
      })
      // --- Title events ---
      .on('broadcast', { event: 'title-update' }, ({ payload }) => {
        if (this.destroyed) return
        this._onTitleUpdate?.(payload.title)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !this.destroyed) {
          // Ask existing peers for current state
          this._send('yjs-state-request', {})
          // Ask existing peers for their presence
          this._send('presence-request', {})
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

  // --- Presence helpers ---

  /** Broadcast local presence state to all peers. */
  broadcastPresence(state) {
    if (this.destroyed) return
    this._send('presence-update', state)
  }

  /** Broadcast a leave event so peers remove this user immediately. */
  broadcastLeave(userId) {
    if (this.destroyed) return
    this._send('presence-leave', { userId })
  }

  /** Broadcast a title change to all peers. */
  broadcastTitleUpdate(title) {
    if (this.destroyed) return
    this._send('title-update', { title })
  }

  /**
   * Send a broadcast message, using the WebSocket push channel when available
   * and falling back to the HTTP endpoint otherwise.
   * Avoids the deprecation warning from channel.send() which auto-detects
   * transport.
   */
  _send(event, payload) {
    if (this.channel.channelAdapter?.canPush?.()) {
      this.channel.send({
        type: 'broadcast',
        event,
        payload,
      })
    } else {
      this.channel.httpSend(event, payload)
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
