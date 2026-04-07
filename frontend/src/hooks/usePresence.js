import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fixed 8-color palette chosen for contrast on both light and dark themes.
 * Index is derived deterministically from the userId hash.
 */
const PALETTE = [
  '#e06c75', // red
  '#e5c07b', // yellow
  '#61afef', // blue
  '#c678dd', // purple
  '#56b6c2', // cyan
  '#98c379', // green
  '#d19a66', // orange
  '#be5046', // rust
]

const HEARTBEAT_MS = 5_000
const STALE_MS = 10_000

/**
 * Deterministic color for a user — hashes the userId string into an index
 * of the fixed PALETTE. Same user always gets the same color.
 *
 * @param {string} userId
 * @returns {string} CSS color string
 */
export function getUserColor(userId) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/**
 * Manages ephemeral presence awareness over a SupabaseBroadcastProvider.
 *
 * - Broadcasts local user info + cursor position via `presence-update`.
 * - Listens for remote `presence-update` / `presence-leave` events.
 * - Heartbeat every 5 s keeps peers' lastSeen fresh.
 * - Stale entries (>10 s without update) are removed automatically.
 * - Sends `presence-leave` on unmount and `beforeunload`.
 *
 * @param {import('../lib/SupabaseBroadcastProvider').SupabaseBroadcastProvider | null} provider
 * @param {string} userId
 * @param {string} userEmail
 * @param {string | null} fullName
 * @param {string | null} avatarPath - storage path (NOT a blob URL) so peers can download independently
 * @param {boolean} canEdit - whether the local user has edit permission
 * @returns {{
 *   peers: Array<{ userId: string, name: string, avatarUrl: string|null, color: string, cursorIndex: number, canEdit: boolean }>,
 *   broadcastCursor: (index: number) => void,
 * }}
 */
export function usePresence(provider, userId, userEmail, fullName, avatarPath, canEdit) {
  const [peers, setPeers] = useState([])

  // Stable refs so callbacks always see the latest values without re-subscribing.
  const providerRef = useRef(provider)
  const userIdRef = useRef(userId)
  const peersMapRef = useRef(new Map())
  const cursorRef = useRef(0)
  // Cache of downloaded peer avatar blob URLs keyed by avatarPath.
  // Avoids re-downloading on every heartbeat.
  const avatarCacheRef = useRef(new Map())

  useEffect(() => { providerRef.current = provider }, [provider])
  useEffect(() => { userIdRef.current = userId }, [userId])

  // Revoke all cached blob URLs on unmount to free memory.
  useEffect(() => () => {
    for (const url of avatarCacheRef.current.values()) URL.revokeObjectURL(url)
    avatarCacheRef.current.clear()
  }, [])

  // Build the local state payload. Broadcasts avatarPath (not blob URL) so
  // peers can download independently from their own authenticated session.
  const localStateRef = useRef(null)
  useEffect(() => {
    localStateRef.current = {
      userId,
      name: fullName ?? userEmail,
      avatarPath,
      color: getUserColor(userId),
      cursorIndex: cursorRef.current,
      canEdit: !!canEdit,
    }
  }, [userId, userEmail, fullName, avatarPath, canEdit])

  // --- Core effect: wire provider callbacks, heartbeat, stale cleanup ---
  useEffect(() => {
    if (!provider) return

    const map = peersMapRef.current
    map.clear()

    function flushPeers() {
      const arr = []
      for (const entry of map.values()) arr.push(entry)
      setPeers(arr)
    }

    // --- Incoming presence-update ---
    provider._onPresenceUpdate = (state) => {
      if (state.userId === userIdRef.current) return
      const cache = avatarCacheRef.current
      const existing = map.get(state.userId)
      // If we already have a local blob URL for this peer, carry it forward.
      const cachedUrl = cache.get(state.avatarPath) ?? existing?.avatarUrl ?? null
      map.set(state.userId, {
        ...state,
        avatarUrl: cachedUrl,
        lastSeen: Date.now(),
      })
      flushPeers()
      // Download the avatar if we haven't yet and a path was provided.
      if (state.avatarPath && !cache.has(state.avatarPath)) {
        // Mark as in-progress so we don't fire duplicate downloads.
        cache.set(state.avatarPath, null)
        supabase.storage
          .from('avatars')
          .download(state.avatarPath)
          .then(({ data: blob }) => {
            if (!blob) return
            const url = URL.createObjectURL(blob)
            cache.set(state.avatarPath, url)
            // Update the peer entry if still present.
            const entry = map.get(state.userId)
            if (entry) {
              entry.avatarUrl = url
              flushPeers()
            }
          })
      }
    }

    // --- Incoming presence-leave ---
    provider._onPresenceLeave = (leftUserId) => {
      map.delete(leftUserId)
      flushPeers()
    }

    // --- Incoming presence-request: re-broadcast our state ---
    provider._onPresenceRequest = () => {
      if (localStateRef.current) {
        provider.broadcastPresence(localStateRef.current)
      }
    }

    // Initial announce
    if (localStateRef.current) {
      provider.broadcastPresence(localStateRef.current)
    }

    // Heartbeat — re-broadcast local state every HEARTBEAT_MS
    const heartbeat = setInterval(() => {
      if (localStateRef.current) {
        provider.broadcastPresence(localStateRef.current)
      }
    }, HEARTBEAT_MS)

    // Stale cleanup — remove peers not heard from in STALE_MS
    const cleanup = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [id, entry] of map) {
        if (now - entry.lastSeen > STALE_MS) {
          map.delete(id)
          changed = true
        }
      }
      if (changed) flushPeers()
    }, HEARTBEAT_MS)

    // --- beforeunload: broadcast leave so peers remove us immediately ---
    const onBeforeUnload = () => {
      provider.broadcastLeave(userIdRef.current)
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      clearInterval(heartbeat)
      clearInterval(cleanup)
      window.removeEventListener('beforeunload', onBeforeUnload)
      provider._onPresenceUpdate = null
      provider._onPresenceLeave = null
      provider._onPresenceRequest = null
      // Send leave on cleanup (React unmount / navigation away)
      provider.broadcastLeave(userIdRef.current)
      map.clear()
      setPeers([])
    }
  }, [provider])

  // --- Broadcast cursor position (called by the editor on select/change) ---
  const broadcastCursor = useCallback((index) => {
    cursorRef.current = index
    if (localStateRef.current) {
      localStateRef.current = { ...localStateRef.current, cursorIndex: index }
      providerRef.current?.broadcastPresence(localStateRef.current)
    }
  }, [])

  return { peers, broadcastCursor }
}
