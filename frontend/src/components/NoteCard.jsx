/**
 * Displays a single note with Edit and Delete actions.
 *
 * Defined at module top level — never inside another component.
 * Inline component definitions cause React to create a new component type
 * on every parent render, forcing full remounts and losing state.
 * (rerender-no-inline-components)
 *
 * @param {{ note: import('../lib/database.types').Note, onEdit: Function, onDelete: Function }} props
 */
export default function NoteCard({ note, onEdit, onDelete }) {
  return (
    <article className="note-card">
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
