import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'

const DEBOUNCE_MS = 1500
const SAVED_DISPLAY_MS = 2000

/**
 * Debounced auto-save hook. Call `schedule()` on every content change.
 * Returns status for UI feedback and `flush()` for immediate save.
 *
 * The save function is stored in a ref so callers don't need to
 * memoise it perfectly — the latest version is always used.
 * (advanced-use-latest pattern)
 *
 * @param {() => Promise<void>} saveFn
 * @returns {{ status: 'idle'|'saving'|'saved'|'error', schedule: () => void, flush: () => void }}
 */
export function useAutoSave(saveFn) {
  const [status, setStatus] = useState('idle')
  const debounceRef = useRef(null)
  const savedRef = useRef(null)
  const saveFnRef = useRef(saveFn)
  useLayoutEffect(() => { saveFnRef.current = saveFn })

  const runSave = useCallback(async () => {
    setStatus('saving')
    try {
      await saveFnRef.current()
      setStatus('saved')
      clearTimeout(savedRef.current)
      savedRef.current = setTimeout(() => setStatus('idle'), SAVED_DISPLAY_MS)
    } catch {
      setStatus('error')
    }
  }, [])

  const schedule = useCallback(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runSave, DEBOUNCE_MS)
  }, [runSave])

  const flush = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      runSave()
    }
  }, [runSave])

  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    clearTimeout(savedRef.current)
  }, [])

  return { status, schedule, flush }
}
