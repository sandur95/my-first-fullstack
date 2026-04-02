import { useState, useEffect, useRef } from 'react'
import AvatarBubble from './AvatarBubble'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Inline form for viewing and editing the user's display name and profile picture.
 *
 * Mirrors the NoteEditor pattern: same .note-editor / .note-editor-actions
 * CSS classes, same submit-while-saving guard, same cancel prop.
 *
 * Avatar upload design:
 *  - A hidden <input type="file"> is triggered by clicking the camera overlay.
 *  - Client-side validation (image MIME type + 2 MB limit) runs in the change
 *    handler before any network call. Interaction logic lives in the event
 *    handler, not a state+effect cycle. (rerender-move-effect-to-event)
 *  - localPreview holds a blob: URL created by the hook synchronously so the
 *    new image appears instantly. displaySrc is derived during render — no
 *    effect needed. (rerender-derived-state-no-effect)
 *  - Ternaries used throughout; never &&. (rendering-conditional-render)
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 *
 * @param {{
 *   fullName:        string|null,
 *   avatarUrl:       string|null,
 *   isUploading:     boolean,
 *   onSave:          Function,
 *   onUploadAvatar:  (file: File, onPreviewReady: (url: string|null) => void) => void,
 *   onCancel:        Function,
 *   saving:          boolean
 * }} props
 */
export default function ProfileEditor({
  fullName, avatarUrl, isUploading,
  onSave, onUploadAvatar, onCancel, saving
}) {
  const [name, setName] = useState('')
  const [localPreview, setLocalPreview] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef(null)

  // Sync name field once the fetch from useProfile resolves.
  useEffect(() => {
    setName(fullName ?? '')
  }, [fullName])

  // Derived during render — no effect needed. (rerender-derived-state-no-effect)
  // Shows the optimistic blob URL while uploading, then falls back to the
  // confirmed signed URL (or null if no avatar exists yet).
  const displaySrc = localPreview ?? avatarUrl

  // Interaction logic lives in the event handler. (rerender-move-effect-to-event)
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError('File must be an image (JPEG, PNG, WebP, etc.).')
      return
    }
    if (file.size > MAX_BYTES) {
      setUploadError('File must be under 2 MB.')
      return
    }

    setUploadError(null)
    // The hook creates the blob URL synchronously and calls setLocalPreview(blobUrl)
    // immediately so the new avatar appears before any network call completes.
    onUploadAvatar(file, setLocalPreview)

    // Reset the input so the same file can be re-selected if needed.
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    await onSave(name)
  }

  // Ternary — avoids falsy 0/NaN rendering (rendering-conditional-render)
  const submitLabel = saving ? 'Saving…' : 'Save'

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <h2>Profile</h2>

      {/* Avatar upload area */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '.5rem' }}>
        <span className="note-editor" style={{ fontSize: '.8125rem', fontWeight: 500, color: 'var(--text-muted)', background: 'none', border: 'none', boxShadow: 'none', padding: 0, gap: 0 }}>
          Profile picture
        </span>

        {/* Wrapper provides the relative context for the overlay */}
        <div
          className="avatar-upload-wrapper avatar-editor-circle"
          onClick={() => { if (!isUploading) fileInputRef.current?.click() }}
          role="button"
          aria-label="Change profile picture"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isUploading) fileInputRef.current?.click() } }}
        >
          {/* Avatar image or initials fallback — ternary not && */}
          {displaySrc !== null ? (
            <img
              src={displaySrc}
              alt="Avatar"
              width={80}
              height={80}
              className="avatar-bubble-img avatar-editor-circle"
              style={{ opacity: isUploading ? 0.4 : 1 }}
            />
          ) : (
            <div
              className="avatar-bubble-initials avatar-editor-circle"
              style={{ fontSize: '1.5rem' }}
            >
              {(fullName ?? '')
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map(w => w[0]?.toUpperCase() ?? '')
                .join('')}
            </div>
          )}

          {/* Spinner overlay — shown while isUploading (ternary not &&) */}
          {isUploading ? (
            <div className="avatar-spinner-overlay">
              <div className="avatar-spinner" role="status" aria-label="Uploading…" />
            </div>
          ) : null}

          {/* Camera icon overlay — hidden by CSS until hover, only shown when not uploading */}
          {!isUploading ? (
            <div className="avatar-camera-overlay" aria-hidden="true">📷</div>
          ) : null}
        </div>

        {/* Hidden file input — triggered by clicking the avatar wrapper */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          disabled={isUploading}
          onChange={handleFileChange}
        />

        {/* Client-side validation error (ternary not &&) */}
        {uploadError !== null ? (
          <p className="form-error" role="alert" style={{ margin: 0 }}>{uploadError}</p>
        ) : null}
      </div>

      <label htmlFor="profile-full-name">Display name</label>
      <input
        id="profile-full-name"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="name"
      />

      <div className="note-editor-actions">
        <button type="submit" disabled={saving || isUploading}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
