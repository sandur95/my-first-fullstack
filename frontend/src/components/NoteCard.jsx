/**
 * Displays a single note with Pin, Edit, and Delete actions.
 *
 * Defined at module top level — never inside another component.
 * Inline component definitions cause React to create a new component type
 * on every parent render, forcing full remounts and losing state.
 * (rerender-no-inline-components)
 *
 * @param {{ note: import('../lib/database.types').Note, onEdit: Function, onDelete: Function, onPin: Function }} props
 */
export default function NoteCard({ note, onEdit, onDelete, onPin }) {
  return (
    <article className={`note-card${note.pinned ? ' note-card--pinned' : ''}`}>
      <div className="note-card-body">
        <h3 className="note-card-title">{note.title}</h3>
        {note.content !== null ? (
          <p className="note-card-content">{note.content}</p>
        ) : null}
      </div>
      <footer className="note-card-footer">
        <time className="note-card-date" dateTime={note.created_at}>
          {new Date(note.created_at).toLocaleDateString()}
        </time>
        <div className="note-card-actions">
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
            className="btn-danger"
            onClick={() => onDelete(note.id)}
          >
            Delete
          </button>
        </div>
      </footer>
    </article>
  )
}
