import { memo, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import AvatarBubble from './AvatarBubble'

/**
 * Displays a single note with context-appropriate actions.
 *
 * Active view:   📌 Pin  |  Edit  |  Archive
 * Archive view:  Unarchive  |  Delete permanently
 *
 * Attachments section (when note has attachments):
 *  - Images: shown as 48×48 thumbnails fetched via authenticated download() calls.
 *  - PDFs: shown as a 📄 icon.
 *  - Files are fetched using the user's active JWT — the storage SELECT policy is
 *    enforced on every request. The resulting blob: URLs are tab-scoped and cannot
 *    be used by any other user even if they obtain the URL string.
 *  - storage_path is the only thing persisted; blob: URLs are derived at render time.
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 *
 * @param {{
 *   note: import('../lib/database.types').Note,
 *   isArchived: boolean,
 *   isOwner?: boolean,
 *   sharePermission?: 'view'|'edit'|null,
 *   onShare?: Function|null,
 *   ownerName?: string|null,
 *   ownerAvatarPath?: string|null,
 *   onEdit: Function,
 *   onPin: Function,
 *   onArchive: Function,
 *   onUnarchive: Function,
 *   onDeletePermanent: Function,
 *   onTagClick: Function,
 *   onDeleteAttachment: (noteId: number, attachment: object) => void
 * }} props
 */
export default memo(function NoteCard({ note, isArchived, isOwner = true, sharePermission = null, onShare = null, ownerName = null, ownerAvatarPath = null, onEdit, onPin, onArchive, onUnarchive, onDeletePermanent, onTagClick, onDeleteAttachment }) {
  // Map<storage_path, blob URL> — populated by authenticated download calls.
  // Keyed by storage_path so the render can look up any attachment's URL in O(1).
  // (js-index-maps)
  const [urlMap, setUrlMap] = useState(() => new Map())
  // Tracks the blob URLs from the previous effect run so they can be revoked
  // when note.note_attachments changes — prevents memory leaks.
  // (rerender-use-ref-transient-values)
  const prevUrlMapRef = useRef(new Map())

  // Blob URL for the note owner's avatar (only populated on shared notes).
  // Fetched via the authenticated storage download path; revoked on path change.
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState(null)
  const prevOwnerAvatarUrlRef = useRef(null)

  // Three-dots actions dropdown. (rerender-functional-setstate)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuBelow, setMenuBelow] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  // Download all attachments whenever the list changes.
  // Each download() uses the user's active JWT; the storage SELECT policy is
  // re-checked on every call. blob: URLs are tab-scoped and cannot be shared.
  // All downloads run in parallel. (async-parallel)
  useEffect(() => {
    const attachments = note.note_attachments
    // Revoke blob URLs from the previous run before creating new ones.
    prevUrlMapRef.current.forEach(url => URL.revokeObjectURL(url))
    prevUrlMapRef.current = new Map()

    if (!attachments || attachments.length === 0) {
      setUrlMap(new Map())
      return
    }

    let cancelled = false

    Promise.all(
      attachments.map(att =>
        supabase.storage.from('attachments').download(att.storage_path)
          .then(({ data }) => data ? { path: att.storage_path, url: URL.createObjectURL(data) } : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) {
        // Effect re-triggered before downloads finished — discard new blob URLs.
        results.forEach(r => r && URL.revokeObjectURL(r.url))
        return
      }
      const map = new Map()
      results.forEach(r => { if (r) map.set(r.path, r.url) })
      prevUrlMapRef.current = map
      setUrlMap(map)
    })

    return () => { cancelled = true }
  }, [note.note_attachments])

  // Fetch the note owner's avatar when ownerAvatarPath is provided (shared notes).
  // avatars_select_shared storage policy allows this download.
  useEffect(() => {
    if (prevOwnerAvatarUrlRef.current) {
      URL.revokeObjectURL(prevOwnerAvatarUrlRef.current)
      prevOwnerAvatarUrlRef.current = null
    }
    if (!ownerAvatarPath) {
      setOwnerAvatarUrl(null)
      return
    }
    let cancelled = false
    supabase.storage.from('avatars').download(ownerAvatarPath)
      .then(({ data }) => {
        if (cancelled || !data) return
        const url = URL.createObjectURL(data)
        prevOwnerAvatarUrlRef.current = url
        setOwnerAvatarUrl(url)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ownerAvatarPath])

  // Close dropdown on outside click — listener only active while menu is open.
  // (client-event-listeners)
  useEffect(() => {
    if (!menuOpen) return
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
        setPendingDelete(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [menuOpen])

  return (
    <article className={`note-card${note.pinned && !isArchived ? ' note-card--pinned' : ''}${sharePermission !== null ? ' note-card--shared' : ''}`}>
      <div className="note-card-body">
        {sharePermission !== null ? (
          <div className="note-card-shared-by">
            <AvatarBubble avatarUrl={ownerAvatarUrl} displayName={ownerName ?? '?'} size={16} />
            <span className="note-card-shared-by-label">Shared by {ownerName ?? 'Unknown'}</span>
          </div>
        ) : null}
        <h3 className="note-card-title">{note.title}</h3>
        {note.content !== null ? (
          <p className="note-card-content">{note.content}</p>
        ) : null}
        {note.note_tags && note.note_tags.length > 0 ? (
          <div className="note-card-tags">
            {note.note_tags.map(nt => (
              <button
                key={nt.tag_id}
                type="button"
                className="tag-pill"
                onClick={() => onTagClick(nt.tag_id)}
              >
                {nt.tags.name}
              </button>
            ))}
          </div>
        ) : null}
        {note.note_attachments && note.note_attachments.length > 0 ? (
          <div className="note-attachments">
            {note.note_attachments.map(att => (
              <div key={att.id} className="attachment-item">
                {/* Wrap the visual + name in a link so users can open/download.
                    href is undefined (not '') until the blob URL is ready —
                    prevents an empty href attribute. (rendering-conditional-render) */}
                <a
                  href={urlMap.get(att.storage_path) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-link"
                  aria-label={`Open ${att.file_name}`}
                >
                  {att.mime_type?.startsWith('image/') ? (
                    urlMap.get(att.storage_path)
                      ? <img src={urlMap.get(att.storage_path)} alt={att.file_name} className="attachment-thumb" />
                      : <span className="attachment-thumb attachment-thumb--loading" aria-hidden="true" />
                  ) : (
                    <span className="attachment-pdf-icon" aria-hidden="true">📄</span>
                  )}
                  <span className="attachment-name" title={att.file_name}>
                    {att.file_name}
                  </span>
                </a>
                {isOwner ? (
                  <button
                    type="button"
                    className="attachment-delete"
                    title="Delete attachment"
                    onClick={() => onDeleteAttachment(note.id, att)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <footer className="note-card-footer">
        <time className="note-card-date" dateTime={note.created_at}>
          {new Date(note.created_at).toLocaleDateString()}
        </time>
        {/* Hide the ··· trigger entirely when no actions exist for this viewer.
            View-only sharees have nothing to act on. (rendering-conditional-render) */}
        {(isArchived ? isOwner : isOwner || sharePermission === 'edit') ? (
          <div className="note-card-menu" ref={menuRef}>
            <button
              type="button"
              className="note-card-menu-trigger"
              aria-label="Note actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              ref={triggerRef}
              onClick={() => {
                if (!menuOpen) {
                  const rect = triggerRef.current?.getBoundingClientRect()
                  setMenuBelow(rect ? rect.top < 200 : false)
                }
                setMenuOpen(o => !o)
                if (menuOpen) setPendingDelete(false)
              }}>
              ⋮
            </button>
            {menuOpen ? (
              <div className={`note-card-menu-dropdown${menuBelow ? ' note-card-menu-dropdown--below' : ''}`} role="menu">
                {isArchived ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="note-card-menu-item"
                      onClick={() => { onUnarchive(note.id); setMenuOpen(false); setPendingDelete(false) }}
                    >
                      Unarchive
                    </button>
                    {pendingDelete ? (
                      <div className="note-card-menu-confirm">
                        <span className="note-card-menu-confirm-label">Delete permanently?</span>
                        <div className="note-card-menu-confirm-actions">
                          <button
                            type="button"
                            className="btn-danger btn-small"
                            onClick={() => { onDeletePermanent(note.id); setMenuOpen(false); setPendingDelete(false) }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-small"
                            onClick={() => setPendingDelete(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className="note-card-menu-item note-card-menu-item--danger"
                        onClick={() => setPendingDelete(true)}
                      >
                        Delete permanently
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {isOwner && onShare !== null ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="note-card-menu-item"
                        onClick={() => { onShare(note.id); setMenuOpen(false) }}
                      >
                        Share
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button
                        type="button"
                        role="menuitem"
                        className={`note-card-menu-item${note.pinned ? ' note-card-menu-item--active' : ''}`}
                        onClick={() => { onPin(note.id, note.pinned); setMenuOpen(false) }}
                      >
                        {note.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    ) : null}
                    {isOwner || sharePermission === 'edit' ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="note-card-menu-item"
                        onClick={() => { onEdit(note); setMenuOpen(false) }}
                      >
                        Edit
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="note-card-menu-item"
                        onClick={() => { onArchive(note.id); setMenuOpen(false) }}
                      >
                        Archive
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </footer>
    </article>
  )
})
