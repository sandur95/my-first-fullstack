import { useState, useEffect } from 'react'

/**
 * Create / edit form — doubles as both depending on whether editingNote is set.
 *
 * @param {{
 *   editingNote: import('../lib/database.types').Note|null,
 *   onSave: Function,
 *   onCancel: Function,
 *   saving: boolean
 * }} props
 */
export default function NoteEditor({ editingNote, onSave, onCancel, saving }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  // Sync form fields when the edit target changes
  useEffect(() => {
    if (editingNote !== null) {
      setTitle(editingNote.title)
      setContent(editingNote.content ?? '')
    } else {
      setTitle('')
      setContent('')
    }
  }, [editingNote])

  async function handleSubmit(e) {
    e.preventDefault()
    await onSave({ title, content })
    // Clear fields only when creating (not editing)
    if (editingNote === null) {
      setTitle('')
      setContent('')
    }
  }

  const submitLabel = saving
    ? 'Saving…'
    : editingNote !== null
      ? 'Update'
      : 'Create'

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <h2>{editingNote !== null ? 'Edit note' : 'New note'}</h2>

      <label htmlFor="note-title">Title</label>
      <input
        id="note-title"
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Note title"
        required
      />

      <label htmlFor="note-content">Content</label>
      <textarea
        id="note-content"
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write your note…"
        rows={4}
      />

      <div className="note-editor-actions">
        <button type="submit" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
