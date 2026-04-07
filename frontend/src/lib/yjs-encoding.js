/**
 * Encode/decode helpers for transporting Yjs binary state (Uint8Array).
 *
 * Two encoding formats are needed:
 *   - Base64: for Supabase Broadcast JSON payloads (compact, JSON-safe)
 *   - Hex (\x prefix): for Postgres bytea columns via PostgREST
 *
 * PostgREST reads and writes bytea as Postgres hex literals (\x…).
 * Sending raw base64 to a bytea column would be misinterpreted as an
 * escape-format literal, causing a double-encoding mismatch on read.
 *
 * Uses loops instead of String.fromCharCode(...arr) to avoid
 * stack-overflow on large documents (> ~100 KB).
 */

// ---------------------------------------------------------------------------
// Base64  (used by SupabaseBroadcastProvider for JSON payloads)
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array to a base64 string.
 * @param {Uint8Array} uint8Array
 * @returns {string}
 */
export function uint8ArrayToBase64(uint8Array) {
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary)
}

/**
 * Decode a base64 string to a Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Hex  (used by DocumentEditor for Postgres bytea read/write via PostgREST)
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array to a Postgres hex-encoded bytea string (\x prefix).
 * @param {Uint8Array} uint8Array
 * @returns {string}
 */
export function uint8ArrayToHex(uint8Array) {
  let hex = '\\x'
  for (let i = 0; i < uint8Array.length; i++) {
    hex += uint8Array[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Decode a Postgres hex-encoded bytea string (\x prefix) to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToUint8Array(hex) {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16)
  }
  return bytes
}
