import { useState, useEffect, useCallback, useTransition, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches and manages the authenticated user's public profile,
 * including avatar upload to the private "avatars" storage bucket.
 *
 * Avatar design decisions:
 *  - Never persists URLs to the database; only avatar_path is stored.
 *  - Avatar is fetched via download() at display time — the storage SELECT policy
 *    is re-checked on every call using the user's active JWT. No shareable token.
 *  - useTransition provides isUploading without a manual useState bool.
 *    (rendering-usetransition-loading)
 *  - uploadAvatar calls onPreviewReady(blobUrl) synchronously so the caller
 *    can show an optimistic preview before the network upload completes.
 *    (rerender-move-effect-to-event)
 *  - useCallback deps include only userId — stable for the session lifetime.
 *    (rerender-functional-setstate)
 *
 * @param {string|null} userId - The authenticated user's UUID
 */
export function useProfile(userId) {
  const [fullName, setFullName] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarPath, setAvatarPath] = useState(null)

  // useTransition replaces a manual isLoading boolean for the upload.
  // isPending resets automatically even if the transition throws.
  // (rendering-usetransition-loading)
  const [isUploading, startUploadTransition] = useTransition()
  // Tracks the current avatar blob URL so it can be revoked when replaced.
  // (rerender-use-ref-transient-values)
  const avatarBlobUrlRef = useRef(null)

  // Revoke the avatar blob URL on unmount to free memory.
  useEffect(() => () => {
    if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current)
  }, [])

  // Fetch profile on mount / userId change.
  useEffect(() => {
    if (!userId) return
    supabase
      .from('users')
      .select('full_name, avatar_path')
      .eq('id', userId)
      .single()
      .then(async ({ data }) => {
        if (!data) return
        setFullName(data.full_name)
        setAvatarPath(data.avatar_path ?? null)
        if (data.avatar_path) {
          const { data: blob } = await supabase.storage
            .from('avatars')
            .download(data.avatar_path)
          if (blob) {
            if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current)
            const url = URL.createObjectURL(blob)
            avatarBlobUrlRef.current = url
            setAvatarUrl(url)
          }
        }
      })
  }, [userId])

  /**
   * Uploads a new avatar to the private "avatars" bucket, saves avatar_path in
   * the DB, and refreshes the signed URL in local state.
   *
   * Calls onPreviewReady(blobUrl) synchronously so the parent component can
   * render an optimistic preview immediately. The blob URL is revoked in the
   * finally block regardless of success or failure.
   *
   * Interaction logic lives here in a callback, not in a state+effect cycle.
   * (rerender-move-effect-to-event)
   *
   * @param {File}                           file           - The image file to upload
   * @param {(url: string|null) => void}     onPreviewReady - Called with blobUrl before upload,
   *                                                          then with null when done
   */
  const uploadAvatar = useCallback((file, onPreviewReady) => {
    // Create blob URL synchronously so the component can show a preview
    // before the upload starts. (optimistic UI)
    const blobUrl = URL.createObjectURL(file)
    onPreviewReady(blobUrl)

    startUploadTransition(async () => {
      try {
        const filePath = `${userId}/avatar.png`

        // upsert: true replaces an existing file rather than creating a duplicate.
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(filePath, file, { upsert: true })
        if (upErr) throw upErr

        // Persist only the storage path — never the signed URL.
        const { error: dbErr } = await supabase
          .from('users')
          .update({ avatar_path: filePath })
          .eq('id', userId)
        if (dbErr) throw dbErr

        // Download the uploaded file and derive a blob URL — no shareable token.
        const { data: blob } = await supabase.storage
          .from('avatars')
          .download(filePath)
        if (blob) {
          if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current)
          const url = URL.createObjectURL(blob)
          avatarBlobUrlRef.current = url
          setAvatarUrl(url)
        }
      } finally {
        // Always revoke the blob URL to free memory.
        URL.revokeObjectURL(blobUrl)
        onPreviewReady(null)
      }
    })
  }, [userId])

  /**
   * Persists a new full name and updates local state immediately — no refetch needed.
   * An empty string is stored as NULL; no ghost empty-string values in the DB.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  const updateFullName = useCallback(async (name) => {
    const trimmed = name.trim() || null
    const { error } = await supabase
      .from('users')
      .update({ full_name: trimmed })
      .eq('id', userId)
    if (error) throw error
    setFullName(trimmed)
  }, [userId])

  return { fullName, avatarUrl, avatarPath, isUploading, uploadAvatar, updateFullName }
}
