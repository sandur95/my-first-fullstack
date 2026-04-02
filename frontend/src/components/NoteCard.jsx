import { memo } from 'react'

/**
 * Displays a single note with context-appropriate actions.
 *
 * Active view:   📌 Pin  |  Edit  |  Archive
 * Archive view:  Unarchive  |  Delete permanently
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
 *   onTagClick: Function
 * }} props
 */
export default memo(function NoteCard({ note, isArchived, onEdit, onPin, onArchive, onUnarchive, onDeletePermanent, onTagClick }) {
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
