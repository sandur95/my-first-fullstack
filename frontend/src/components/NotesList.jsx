import { useState } from 'react'
import { useNotes } from '../hooks/useNotes'
import { useProfile } from '../hooks/useProfile'
import ThemeToggle from './ThemeToggle'
import NoteEditor from './NoteEditor'
import ProfileEditor from './ProfileEditor'
import NoteCard from './NoteCard'

/**
 * Authenticated main view — composites NoteEditor + NoteCard list.
 *
 * Uses a `view` state ('list' | 'archive' | 'compose' | 'edit' | 'profile') to
 * control what is displayed. 'archive' shows the archived-notes tab.
 *
 * Interaction logic lives in event handlers, not state+effect cycles.
 * (rerender-move-effect-to-event)
 *
 * All sub-components imported at module level — never inline.
 * (rerender-no-inline-components)
 *
 * @param {{ userId: string, userEmail: string, onSignOut: Function }} props
 */
export default function NotesList({ userId, userEmail, onSignOut }) {
  // Derive tab during render — no extra useState needed (rerender-derived-state-no-effect)
  // view === 'archive' drives the archive tab; all other views use the active tab.
  const [view, setView] = useState('list')
  const tab = view === 'archive' ? 'archive' : 'active'

  const { notes, loading, error, createNote, updateNote, pinNote, archiveNote, unarchiveNote, deleteNote } = useNotes(userId, tab)
  const { fullName, updateFullName } = useProfile(userId)
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

  async function handleArchive(id) {
    try {
      await archiveNote(id)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  async function handleUnarchive(id) {
    try {
      await unarchiveNote(id)
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

  async function handleProfileSave(name) {
    setSaving(true)
    setSaveError(null)
    try {
      await updateFullName(name)
      setView('list')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Derived during render — which overlay is active (rerender-derived-state-no-effect)
  const showEditor = view === 'compose' || view === 'edit'
  const showProfile = view === 'profile'

  return (
    <div className="notes-layout">
      <header className="notes-header">
        <span className="notes-logo">Notes</span>
        <div className="notes-header-right">
          <span className="notes-user-email">
            {fullName !== null ? fullName : userEmail}
          </span>
          <ThemeToggle />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setSaveError(null); setEditingNote(null); setView('profile') }}
          >
            Profile
          </button>
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
        ) : showProfile ? (
          <ProfileEditor
            fullName={fullName}
            onSave={handleProfileSave}
            onCancel={handleCancel}
            saving={saving}
          />
        ) : loading ? (
          <p className="centered-status">Loading notes…</p>
        ) : (
          <>
            <div className="notes-tab-bar">
              <button
                type="button"
                className={`notes-tab${tab === 'active' ? ' notes-tab--active' : ''}`}
                onClick={() => { setSaveError(null); setView('list') }}
              >
                Active
              </button>
              <button
                type="button"
                className={`notes-tab${tab === 'archive' ? ' notes-tab--active' : ''}`}
                onClick={() => { setSaveError(null); setView('archive') }}
              >
                Archived
              </button>
            </div>

            <div className="notes-list-header">
              <h2 className="notes-list-title">
                {notes.length === 0
                  ? (tab === 'archive' ? 'No archived notes' : 'No notes yet')
                  : tab === 'archive'
                    ? `${notes.length} archived`
                    : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
              </h2>
              {tab === 'active' ? (
                <button
                  type="button"
                  onClick={() => { setSaveError(null); setView('compose') }}
                >
                  + New note
                </button>
              ) : null}
            </div>

            {notes.length === 0 ? (
              <p className="empty-state">
                {tab === 'archive'
                  ? 'Archived notes will appear here.'
                  : 'Click \u201c+ New note\u201d to get started.'}
              </p>
            ) : (
              <div className="notes-grid">
                {notes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    isArchived={tab === 'archive'}
                    onEdit={handleEdit}
                    onPin={handlePin}
                    onArchive={handleArchive}
                    onUnarchive={handleUnarchive}
                    onDeletePermanent={handleDelete}
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

