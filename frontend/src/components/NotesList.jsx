import { useState } from 'react'
import { useNotes } from '../hooks/useNotes'
import ThemeToggle from './ThemeToggle'
import NoteEditor from './NoteEditor'
import NoteCard from './NoteCard'

/**
 * Authenticated main view — composites NoteEditor + NoteCard list.
 *
 * Uses a `view` state ('list' | 'compose' | 'edit') to show either the notes
 * grid OR the editor — never both at the same time.
 *
 * Delete is immediate — no confirm dialog. Interaction logic lives in the
 * event handler, not a state+effect cycle. (rerender-move-effect-to-event)
 *
 * All sub-components imported at module level — never inline.
 * (rerender-no-inline-components)
 *
 * @param {{ userId: string, userEmail: string, onSignOut: Function }} props
 */
export default function NotesList({ userId, userEmail, onSignOut }) {
  const { notes, loading, error, createNote, updateNote, deleteNote, pinNote } = useNotes(userId)
  // 'list' | 'compose' | 'edit'
  const [view, setView] = useState('list')
  const [editingNote, setEditingNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  async function handleSave({ title, content }) {
    setSaving(true)
    setSaveError(null)
    try {
      if (editingNote !== null) {
        await updateNote(editingNote.id, { title, content })
      } else {
        await createNote(userId, { title, content })
      }
      setEditingNote(null)
      setView('list')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteNote(id)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  async function handlePin(id, currentPinned) {
    try {
      await pinNote(id, currentPinned)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  function handleEdit(note) {
    setEditingNote(note)
    setSaveError(null)
    setView('edit')
  }

  function handleCancel() {
    setEditingNote(null)
    setSaveError(null)
    setView('list')
  }

  // Derived during render — which view is active (rerender-derived-state-no-effect)
  const showEditor = view === 'compose' || view === 'edit'

  return (
    <div className="notes-layout">
      <header className="notes-header">
        <span className="notes-logo">Notes</span>
        <div className="notes-header-right">
          <span className="notes-user-email">{userEmail}</span>
          <ThemeToggle />
          <button type="button" className="btn-secondary" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="notes-main">
        {saveError !== null ? (
          <p className="form-error" role="alert">{saveError}</p>
        ) : null}

        {error !== null ? (
          <p className="form-error" role="alert">{error}</p>
        ) : null}

        {showEditor ? (
          <NoteEditor
            editingNote={editingNote}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
          />
        ) : loading ? (
          <p className="centered-status">Loading notes…</p>
        ) : (
          <>
            <div className="notes-list-header">
              <h2 className="notes-list-title">
                {notes.length === 0
                  ? 'No notes yet'
                  : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
              </h2>
              <button
                type="button"
                onClick={() => { setSaveError(null); setView('compose') }}
              >
                + New note
              </button>
            </div>

            {notes.length === 0 ? (
              <p className="empty-state">Click "+ New note" to get started.</p>
            ) : (
              <div className="notes-grid">
                {notes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onPin={handlePin}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

