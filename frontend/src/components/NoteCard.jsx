import { memo, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

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
 *   onEdit: Function,
 *   onPin: Function,
 *   onArchive: Function,
 *   onUnarchive: Function,
 *   onDeletePermanent: Function,
 *   onTagClick: Function,
 *   onDeleteAttachment: (noteId: number, attachment: object) => void
 * }} props
 */
export default memo(function NoteCard({ note, isArchived, onEdit, onPin, onArchive, onUnarchive, onDeletePermanent, onTagClick, onDeleteAttachment }) {
  // Map<storage_path, blob URL> — populated by authenticated download calls.
  // Keyed by storage_path so the render can look up any attachment's URL in O(1).
  // (js-index-maps)
  const [urlMap, setUrlMap] = useState(() => new Map())
  // Tracks the blob URLs from the previous effect run so they can be revoked
  // when note.note_attachments changes — prevents memory leaks.
  // (rerender-use-ref-transient-values)
  const prevUrlMapRef = useRef(new Map())

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
  return (
    <article className={`note-card${note.pinned && !isArchived ? ' note-card--pinned' : ''}`}>
      <div className="note-card-body">
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
                <button
                  type="button"
                  className="attachment-delete"
                  title="Delete attachment"
                  onClick={() => onDeleteAttachment(note.id, att)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <footer className="note-card-footer">
        <time className="note-card-date" dateTime={note.created_at}>
          {new Date(note.created_at).toLocaleDateString()}
        </time>
        <div className="note-card-actions">
          {isArchived ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onUnarchive(note.id)}
              >
                Unarchive
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => onDeletePermanent(note.id)}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`btn-secondary note-card-pin${note.pinned ? ' note-card-pin--active' : ''}`}
                title={note.pinned ? 'Unpin note' : 'Pin note'}
                onClick={() => onPin(note.id, note.pinned)}
              >
                📌
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onEdit(note)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onArchive(note.id)}
              >
                Archive
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  )
})
