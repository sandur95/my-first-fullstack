import { useState, useCallback, useTransition } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Accepted MIME types for note attachments.
 * Validated client-side before any network call; the storage bucket also
 * enforces these via allowedMimeTypes.
 */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
])

/** 10 MB in bytes */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Validates a file against the allowed types and size limit.
 * Returns an error string, or null when the file is valid.
 * Exported so NoteEditor can call it synchronously for both create and edit modes.
 * (rerender-move-effect-to-event)
 *
 * @param {File} file
 * @returns {string|null}
 */
export function validateAttachmentFile(file) {
  if (!ALLOWED_TYPES.has(file.type)) {
    return (
      `File type "${file.type || 'unknown'}" is not supported. ` +
      'Please upload an image (JPEG, PNG, GIF, WebP) or a PDF.'
    )
  }
  if (file.size > MAX_BYTES) {
    return (
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
      'The maximum size is 10 MB.'
    )
  }
  return null
}

/**
 * Pure async function: uploads a validated file to the "attachments" bucket,
 * inserts the note_attachments metadata row, and returns the inserted row.
 *
 * Exported separately so NotesList can call it directly after note creation
 * (when the noteId is only known post-create).  Does NOT validate — callers
 * must call validateAttachmentFile first.
 *
 * @param {{ file: File, noteId: number, userId: string }} params
 * @returns {Promise<object>} The inserted note_attachments row
 */
export async function uploadAttachment({ file, noteId, userId }) {
  // Collision-safe filename: timestamp + 8-char random UUID slice + original name.
  const safeFilename = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${file.name}`
  const storagePath = `${userId}/${noteId}/${safeFilename}`

  const { error: upErr } = await supabase.storage
    .from('attachments')
    .upload(storagePath, file)
  if (upErr) throw upErr

  const { data: row, error: dbErr } = await supabase
    .from('note_attachments')
    .insert({
      note_id:      noteId,
      user_id:      userId,
      storage_path: storagePath,
      file_name:    file.name,
      mime_type:    file.type,
      file_size:    file.size,
    })
    .select()
    .single()
  if (dbErr) throw dbErr

  return row
}

/**
 * Hook for in-editor attachment upload (edit mode).
 *
 * Design decisions:
 *  - Validation runs synchronously before any async work so invalid files
 *    never touch the network.  (rerender-move-effect-to-event)
 *  - useTransition provides isUploading without a manual boolean useState —
 *    isPending resets automatically even if the transition throws.
 *    (rendering-usetransition-loading)
 *  - upload() is stable across renders (useCallback with [noteId, userId] deps).
 *    (rerender-functional-setstate)
 *
 * @param {number|null} noteId  - The note's bigint ID
 * @param {string|null} userId  - The authenticated user's UUID
 */
export function useAttachmentUpload(noteId, userId) {
  const [uploadError, setUploadError] = useState(null)
  const [isUploading, startUploadTransition] = useTransition()

  const clearError = useCallback(() => setUploadError(null), [])

  /**
   * @param {File}                  file
   * @param {(row: object) => void} onSuccess - Called with the inserted DB row
   */
  const upload = useCallback((file, onSuccess) => {
    const validationError = validateAttachmentFile(file)
    if (validationError) {
      setUploadError(validationError)
      return
    }

    setUploadError(null)

    startUploadTransition(async () => {
      try {
        const row = await uploadAttachment({ file, noteId, userId })
        onSuccess(row)
      } catch (err) {
        setUploadError(err.message ?? 'Upload failed. Please try again.')
      }
    })
  }, [noteId, userId])

  return { upload, isUploading, uploadError, clearError }
}
