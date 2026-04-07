import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Finds the minimal edit between two strings by scanning for the longest
 * common prefix and suffix. O(n) where n = string length.
 *
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {{ pos: number, deleteCount: number, insert: string }}
 */
function computeDiff(oldStr, newStr) {
  let start = 0
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
    start++
  }

  let oldEnd = oldStr.length
  let newEnd = newStr.length
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  return {
    pos: start,
    deleteCount: oldEnd - start,
    insert: newStr.slice(start, newEnd),
  }
}

/**
 * Adjusts a cursor position based on a Yjs Y.Text delta (array of retain /
 * insert / delete operations). Used to preserve the caret when a remote peer
 * edits the document before the cursor.
 *
 * @param {number} cursorPos
 * @param {Array<{retain?: number, insert?: string, delete?: number}>} delta
 * @returns {number}
 */
function adjustCursor(cursorPos, delta) {
  let pos = 0
  let shift = 0

  for (const op of delta) {
    if (op.retain != null) {
      pos += op.retain
    } else if (op.insert != null) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1
      if (pos <= cursorPos) shift += len
      pos += len
    } else if (op.delete != null) {
      if (pos < cursorPos) {
        const deleteBefore = Math.min(op.delete, cursorPos - pos)
        shift -= deleteBefore
      }
    }
  }

  return Math.max(0, cursorPos + shift)
}

/**
 * Binds a Yjs Y.Text shared type to a React-controlled <textarea>.
 *
 * - Local edits (onChange) are diffed against Y.Text and applied as
 *   insert / delete operations inside a transaction with origin 'local'.
 * - Remote edits trigger a Y.Text observe callback that updates React state
 *   and preserves the textarea cursor position.
 *
 * Works gracefully when textareaRef.current is null (e.g. view-only mode) —
 * remote changes still update the returned `text` for rendering a preview.
 *
 * @param {import('yjs').Doc | null} ydoc
 * @param {import('react').RefObject<HTMLTextAreaElement | null>} textareaRef
 * @returns {{ text: string, handleChange: (e: { target: { value: string } }) => void }}
 */
export function useYjsTextarea(ydoc, textareaRef) {
  const [text, setText] = useState('')
  // Ref to always have the latest ydoc for stable callbacks
  const ydocRef = useRef(ydoc)
  useEffect(() => { ydocRef.current = ydoc })

  // Sync initial text when ydoc identity changes (React-recommended
  // "adjusting state based on props" pattern — no effect needed).
  const [prevYdoc, setPrevYdoc] = useState(null)
  if (ydoc !== prevYdoc) {
    setPrevYdoc(ydoc)
    if (ydoc) setText(ydoc.getText('body').toString())
  }

  // Observe remote changes
  useEffect(() => {
    if (!ydoc) return

    const ytext = ydoc.getText('body')

    function onObserve(event, transaction) {
      if (transaction.origin === 'local') return

      const newText = ytext.toString()
      const ta = textareaRef.current

      if (ta) {
        const selStart = ta.selectionStart
        const selEnd = ta.selectionEnd
        const adjStart = adjustCursor(selStart, event.delta)
        const adjEnd = adjustCursor(selEnd, event.delta)

        setText(newText)

        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = adjStart
            textareaRef.current.selectionEnd = adjEnd
          }
        })
      } else {
        setText(newText)
      }
    }

    ytext.observe(onObserve)
    return () => ytext.unobserve(onObserve)
  }, [ydoc, textareaRef])

  const handleChange = useCallback(
    (e) => {
      const doc = ydocRef.current
      if (!doc) return

      const newValue = e.target.value
      const ytext = doc.getText('body')
      const oldValue = ytext.toString()
      const { pos, deleteCount, insert } = computeDiff(oldValue, newValue)

      doc.transact(() => {
        if (deleteCount > 0) ytext.delete(pos, deleteCount)
        if (insert) ytext.insert(pos, insert)
      }, 'local')

      setText(newValue)
    },
    [],
  )

  return { text, handleChange }
}
