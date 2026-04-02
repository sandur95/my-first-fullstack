import { useState, useRef, useCallback, useTransition } from 'react'
import { useNotes } from '../hooks/useNotes'
import { useProfile } from '../hooks/useProfile'
import { useTags } from '../hooks/useTags'
import ThemeToggle from './ThemeToggle'
import NoteEditor from './NoteEditor'
import ProfileEditor from './ProfileEditor'
import NoteCard from './NoteCard'
import AvatarBubble from './AvatarBubble'

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

  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // Debounce timer ID stored in a ref — updating it never triggers a re-render.
  // (rerender-use-ref-transient-values)
  const debounceRef = useRef(null)
  const [toastMessage, setToastMessage] = useState(null)
  const toastTimeoutRef = useRef(null)
  const [isPending, startTransition] = useTransition()

  const { notes, loading, error, loadingMore, loadMore, hasMore, createNote, updateNote, pinNote, archiveNote, unarchiveNote, deleteNote, updateNoteTags, fetchNotes } = useNotes(userId, tab, debouncedSearch)
  const { fullName, avatarUrl, isUploading, uploadAvatar, updateFullName } = useProfile(userId)
  const { tags, createTag } = useTags(userId)
  const [editingNote, setEditingNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [activeTagId, setActiveTagId] = useState(null)

  async function handleSave({ title, content, tagIds }) {
    setSaving(true)
    setSaveError(null)
    try {
      if (editingNote !== null) {
        await Promise.all([
          updateNote(editingNote.id, { title, content }),
          updateNoteTags(editingNote.id, tagIds, tags),
        ])
      } else {
        const newId = await createNote(userId, { title, content })
        await updateNoteTags(newId, tagIds, tags)
      }
      setEditingNote(null)
      setView('list')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = useCallback(async (id) => {
    try {
      await deleteNote(id)
    } catch (err) {
      setSaveError(err.message)
    }
  }, [deleteNote])

  // showToast defined before the handlers that depend on it
  const showToast = useCallback((message) => {
    clearTimeout(toastTimeoutRef.current)
    setToastMessage(message)
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000)
  }, [])

  const handleArchive = useCallback(async (id) => {
    try {
      await archiveNote(id)
    } catch (err) {
      showToast(err.message)
    }
  }, [archiveNote, showToast])

  const handleUnarchive = useCallback(async (id) => {
    try {
      await unarchiveNote(id)
    } catch (err) {
      showToast(err.message)
    }
  }, [unarchiveNote, showToast])

  const handlePin = useCallback(async (id, currentPinned) => {
    try {
      await pinNote(id, currentPinned)
    } catch (err) {
      showToast(err.message)
    }
  }, [pinNote, showToast])

  const handleEdit = useCallback((note) => {
    setEditingNote(note)
    setSaveError(null)
    setView('edit')
  }, [])

  function handleCancel() {
    setEditingNote(null)
    setSaveError(null)
    setView('list')
  }

  const handleTagClick = useCallback((tagId) => {
    // Toggle: clicking the active tag clears the filter
    setActiveTagId(prev => (prev === tagId ? null : tagId))
  }, [])

  function clearSearch() {
    clearTimeout(debounceRef.current)
    setSearchInput('')
    setDebouncedSearch('')
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
  // Client-side tag filter — applied after fetch (small personal dataset)
  const displayedNotes = activeTagId !== null
    ? notes.filter(n => n.note_tags?.some(nt => nt.tag_id === activeTagId))
    : notes

  return (
    <div className="notes-layout">
      <header className="notes-header">
        <span className="notes-logo">Notes</span>
        <div className="notes-header-right">
          <button
            type="button"
            className="btn-avatar-profile"
            onClick={() => { setSaveError(null); setEditingNote(null); setView('profile') }}
            title="Edit profile"
            aria-label="Edit profile"
          >
            <AvatarBubble avatarUrl={avatarUrl} displayName={fullName ?? userEmail} size={20} />
            <span className="notes-user-email">
              {fullName !== null ? fullName : userEmail}
            </span>
          </button>
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
            allTags={tags}
            onCreateTag={createTag}
          />
        ) : showProfile ? (
          <ProfileEditor
            fullName={fullName}
            avatarUrl={avatarUrl}
            isUploading={isUploading}
            onSave={handleProfileSave}
            onUploadAvatar={uploadAvatar}
            onCancel={handleCancel}
            saving={saving}
          />
        ) : (loading && notes.length === 0 && !debouncedSearch) ? (
          <p className="centered-status">Loading notes…</p>
        ) : (
          // Dim stale content while the tab-switch transition loads new notes.
          // isPending is true only during startTransition — no flash, no empty state.
          // (rendering-usetransition-loading)
          <div style={{ opacity: isPending ? 0.5 : 1, transition: 'opacity 0.15s', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="notes-tab-bar">
              <button
                type="button"
                className={`notes-tab${tab === 'active' ? ' notes-tab--active' : ''}`}
                onClick={() => {
                  setSaveError(null)
                  startTransition(async () => {
                    setView('list')
                    await fetchNotes('active')
                  })
                }}
              >
                Active
              </button>
              <button
                type="button"
                className={`notes-tab${tab === 'archive' ? ' notes-tab--active' : ''}`}
                onClick={() => {
                  setSaveError(null)
                  startTransition(async () => {
                    clearSearch()
                    setView('archive')
                    await fetchNotes('archive')
                  })
                }}
              >
                Archived
              </button>
            </div>

            {tab === 'active' ? (
              <div className="notes-search">
                <input
                  type="search"
                  className="notes-search-input"
                  placeholder="Search notes…"
                  value={searchInput}
                  onChange={e => {
                    const value = e.target.value
                    setSearchInput(value)
                    clearTimeout(debounceRef.current)
                    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300)
                  }}
                  aria-label="Search notes"
                />
                {searchInput !== '' ? (
                  <button
                    type="button"
                    className="notes-search-clear"
                    onClick={clearSearch}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="notes-list-header">
              <h2 className="notes-list-title">
                {notes.length === 0
                  ? (tab === 'archive' ? 'No archived notes' : (debouncedSearch !== '' ? 'No results' : 'No notes yet'))
                  : tab === 'archive'
                    ? `${notes.length} archived`
                    : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
              </h2>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                {activeTagId !== null ? (
                  <button
                    type="button"
                    className="tag-filter-chip"
                    onClick={() => setActiveTagId(null)}
                  >
                    {tags.find(t => t.id === activeTagId)?.name} ×
                  </button>
                ) : null}
                {tab === 'active' ? (
                  <button
                    type="button"
                    onClick={() => { setSaveError(null); setView('compose') }}
                  >
                    + New note
                  </button>
                ) : null}
              </div>
            </div>

            {notes.length === 0 ? (
              <p className="empty-state">
                {tab === 'archive'
                  ? 'Archived notes will appear here.'
                  : debouncedSearch !== ''
                    ? 'No notes match your search.'
                    : 'Click \u201c+ New note\u201d to get started.'}
              </p>
            ) : (
              <>
                <div className="notes-grid">
                  {displayedNotes.map(note => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      isArchived={tab === 'archive'}
                      onEdit={handleEdit}
                      onPin={handlePin}
                      onArchive={handleArchive}
                      onUnarchive={handleUnarchive}
                      onDeletePermanent={handleDelete}
                      onTagClick={handleTagClick}
                    />
                  ))}
                </div>
                {hasMore && !debouncedSearch ? (
                  <div className="notes-load-more">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={loadingMore}
                      onClick={loadMore}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </main>
      {toastMessage !== null ? (
        <div className="toast-error" role="alert">{toastMessage}</div>
      ) : null}
    </div>
  )
}

