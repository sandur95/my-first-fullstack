import { useState, useEffect, useCallback, useTransition } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches and manages the authenticated user's public profile,
 * including avatar upload to the private "avatars" storage bucket.
 *
 * Avatar design decisions:
 *  - Never persists signed URLs to the database; only avatar_path is stored.
 *  - Signed URLs are generated at display time with a 1-hour TTL.
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

  // useTransition replaces a manual isLoading boolean for the upload.
  // isPending resets automatically even if the transition throws.
  // (rendering-usetransition-loading)
  const [isUploading, startUploadTransition] = useTransition()

  // Fetch profile + generate signed URL on mount / userId change.
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
        if (data.avatar_path) {
          const { data: signed } = await supabase.storage
            .from('avatars')
            .createSignedUrl(data.avatar_path, 3600)
          if (signed) setAvatarUrl(signed.signedUrl)
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

        // Generate a fresh signed URL and update React state.
        const { data: signed } = await supabase.storage
          .from('avatars')
          .createSignedUrl(filePath, 3600)
        if (signed) setAvatarUrl(signed.signedUrl)
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

  return { fullName, avatarUrl, isUploading, uploadAvatar, updateFullName }
}
