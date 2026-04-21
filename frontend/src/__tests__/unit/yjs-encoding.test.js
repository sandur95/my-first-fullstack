import { describe, it, expect } from 'vitest'
import {
  uint8ArrayToBase64,
  base64ToUint8Array,
  uint8ArrayToHex,
  hexToUint8Array,
} from '../../lib/yjs-encoding'

const KNOWN_BYTES = new Uint8Array([0x00, 0x01, 0xff, 0xab, 0xcd, 0x42])

describe('yjs-encoding', () => {
  describe('base64 round-trip', () => {
    it('uint8Array → base64 → uint8Array produces the original bytes', () => {
      const encoded = uint8ArrayToBase64(KNOWN_BYTES)
      expect(typeof encoded).toBe('string')
      const decoded = base64ToUint8Array(encoded)
      expect(decoded).toEqual(KNOWN_BYTES)
    })

    it('encodes an empty array to an empty string', () => {
      const empty = new Uint8Array(0)
      const encoded = uint8ArrayToBase64(empty)
      const decoded = base64ToUint8Array(encoded)
      expect(decoded).toEqual(empty)
    })
  })

  describe('hex round-trip', () => {
    it('uint8Array → hex → uint8Array produces the original bytes', () => {
      const hex = uint8ArrayToHex(KNOWN_BYTES)
      expect(typeof hex).toBe('string')
      // uint8ArrayToHex uses the Postgres \x prefix for bytea columns
      expect(hex).toBe('\\x0001ffabcd42')
      const decoded = hexToUint8Array(hex)
      expect(decoded).toEqual(KNOWN_BYTES)
    })

    it('encodes an empty array to a \\x-only string', () => {
      const empty = new Uint8Array(0)
      const hex = uint8ArrayToHex(empty)
      expect(hex).toBe('\\x')
      const decoded = hexToUint8Array(hex)
      expect(decoded).toEqual(empty)
    })
  })
})
