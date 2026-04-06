import { useState, useRef, useCallback, useTransition } from 'react'
import { NavLink } from 'react-router'
import { useNotes } from '../hooks/useNotes'
import { useSharedNotes } from '../hooks/useSharedNotes'
import { uploadAttachment } from '../hooks/useAttachmentUpload'
import { useProfile } from '../hooks/useProfile'
import { useTags } from '../hooks/useTags'
import ThemeToggle from './ThemeToggle'
import NoteEditor from './NoteEditor'
import ProfileEditor from './ProfileEditor'
import NoteCard from './NoteCard'
import AvatarBubble from './AvatarBubble'
import SharePanel from './SharePanel'

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
  // view === 'archive' drives the archive tab; 'shared' drives the shared-with-me section;
  // all other views use the active tab.
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
  // Which note's SharePanel is currently open (null = closed).
  const [sharingNoteId, setSharingNoteId] = useState(null)

  const { notes, loading, error, loadingMore, loadMore, hasMore, createNote, updateNote, pinNote, archiveNote, unarchiveNote, deleteNote, updateNoteTags, fetchNotes, addAttachmentToNote, removeAttachmentFromNote } = useNotes(userId, tab, debouncedSearch)
  const { sharedNotes, loading: sharedLoading, error: sharedError, fetchSharedNotes, updateSharedNote } = useSharedNotes(userId)
  const { fullName, avatarUrl, isUploading, uploadAvatar, updateFullName } = useProfile(userId)
  const { tags, createTag } = useTags(userId)
  const [editingNote, setEditingNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [activeTagId, setActiveTagId] = useState(null)

  async function handleSave({ title, content, tagIds, pendingFiles, pendingDeletes }) {
    setSaving(true)
    setSaveError(null)
    try {
      // Shared-note edit: only title + content; RLS enforces edit permission at DB level.
      if (editingNote !== null && editingNote.sharePermission) {
        const err = await updateSharedNote(editingNote.id, { title, content })
        if (err) throw new Error(err)
        setEditingNote(null)
        setView('shared')
        return
      }
      if (editingNote !== null) {
        // Run all independent operations in parallel. (async-parallel)
        // Uploads and deletes are non-fatal — note title/content/tags save regardless.
        await Promise.all([
          updateNote(editingNote.id, { title, content }),
          updateNoteTags(editingNote.id, tagIds, tags),
          ...(pendingFiles ?? []).map(file =>
            uploadAttachment({ file, noteId: editingNote.id, userId })
              .then(row => addAttachmentToNote(editingNote.id, row))
              .catch(() => showToast(`Failed to attach "${file.name}" — please re-attach it.`))
          ),
          ...(pendingDeletes ?? []).map(att =>
            removeAttachmentFromNote(editingNote.id, att)
              .catch(() => showToast(`Failed to remove "${att.file_name}" — please try again.`))
          ),
        ])
      } else {
        const newId = await createNote(userId, { title, content })
        await updateNoteTags(newId, tagIds, tags)
        // Create mode: serial upload — noteId only known after createNote.
        for (const file of (pendingFiles ?? [])) {
          try {
            const row = await uploadAttachment({ file, noteId: newId, userId })
            addAttachmentToNote(newId, row)
          } catch {
            showToast(`Failed to attach "${file.name}" — please re-attach it.`)
          }
        }
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
    const returnView = editingNote?.sharePermission ? 'shared' : 'list'
    setEditingNote(null)
    setSaveError(null)
    setView(returnView)
  }

  const handleSharedEdit = useCallback((note) => {
    setEditingNote(note)
    setSaveError(null)
    setView('edit')
  }, [])

  const handleTagClick = useCallback((tagId) => {
    // Toggle: clicking the active tag clears the filter
    setActiveTagId(prev => (prev === tagId ? null : tagId))
  }, [])

  /**
   * Optimistically removes an attachment from both the notes list and (if the
   * editor is open) the editor's localAttachments via the parent state that
   * NoteEditor reads on next open.  Shows a toast on error.
   */
  const handleDeleteAttachment = useCallback(async (noteId, attachment) => {
    try {
      await removeAttachmentFromNote(noteId, attachment)
    } catch (err) {
      showToast(err.message)
    }
  }, [removeAttachmentFromNote, showToast])

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
  const showShared = view === 'shared'
  // Client-side tag filter — applied after fetch (small personal dataset)
  const displayedNotes = activeTagId !== null
    ? notes.filter(n => n.note_tags?.some(nt => nt.tag_id === activeTagId))
    : notes

  return (
    <div className="notes-layout">
      {/* SharePanel modal — rendered above everything when a note is being shared */}
      {sharingNoteId !== null ? (
        <SharePanel noteId={sharingNoteId} onClose={() => setSharingNoteId(null)} />
      ) : null}
      <header className="notes-header">
        <nav className="section-toggle" aria-label="Main sections">
          <NavLink to="/notes" className={({ isActive }) => `section-toggle-btn${isActive ? ' section-toggle-btn--active' : ''}`}>Notes</NavLink>
          <NavLink to="/documents" className={({ isActive }) => `section-toggle-btn${isActive ? ' section-toggle-btn--active' : ''}`}>Documents</NavLink>
        </nav>
        <div className="notes-header-right">
          <button
            type="button"
            className={`btn-avatar-profile${view === 'profile' ? ' btn-avatar-profile--active' : ''}`}
            onClick={() => { setSaveError(null); setEditingNote(null); setView('profile') }}
            aria-label="Edit profile"
            aria-pressed={view === 'profile'}
          >
            <AvatarBubble avatarUrl={avatarUrl} displayName={fullName ?? userEmail} size={24} />
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
            userId={userId}
            sharePermission={editingNote?.sharePermission ?? null}
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
        ) : (
          // Single unified notes-view — tab bar is always mounted, only content below switches.
          // Dimming via isPending covers all three tab transitions uniformly.
          // (rendering-usetransition-loading, rerender-no-inline-components)
          <div className="notes-view" style={{ opacity: isPending ? 0.5 : 1, transition: 'opacity 0.15s' }}>
            <div className="notes-tab-bar" role="tablist" aria-label="Notes views">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'list'}
                className={`notes-tab${view === 'list' ? ' notes-tab--active' : ''}`}
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
                role="tab"
                aria-selected={view === 'archive'}
                className={`notes-tab${view === 'archive' ? ' notes-tab--active' : ''}`}
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
              <button
                type="button"
                role="tab"
                aria-selected={view === 'shared'}
                className={`notes-tab${view === 'shared' ? ' notes-tab--active' : ''}`}
                onClick={() => {
                  setSaveError(null)
                  startTransition(async () => {
                    clearSearch()
                    setView('shared')
                    await fetchSharedNotes()
                  })
                }}
              >
                Shared with me
              </button>
            </div>

            {showShared ? (
              <>
                <div className="notes-list-header">
                  <h2 className="notes-list-title">
                    {sharedNotes.length === 0
                      ? 'No notes shared with you'
                      : `${sharedNotes.length} shared note${sharedNotes.length === 1 ? '' : 's'}`}
                  </h2>
                </div>
                {sharedLoading && sharedNotes.length === 0 ? (
                  <p className="centered-status">Loading…</p>
                ) : sharedError !== null ? (
                  <p className="form-error" role="alert">{sharedError}</p>
                ) : sharedNotes.length === 0 ? (
                  <p className="empty-state">Notes shared with you will appear here.</p>
                ) : (
                  <div className="notes-grid">
                    {sharedNotes.map(note => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        isArchived={false}
                        isOwner={false}
                        sharePermission={note.sharePermission}
                        ownerName={note.owner?.full_name ?? null}
                        ownerAvatarPath={note.owner?.avatar_path ?? null}
                        onEdit={note.sharePermission === 'edit' ? handleSharedEdit : () => {}}
                        onPin={() => {}}
                        onArchive={() => {}}
                        onUnarchive={() => {}}
                        onDeletePermanent={() => {}}
                        onTagClick={() => {}}
                        onDeleteAttachment={() => {}}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (loading && notes.length === 0 && !debouncedSearch) ? (
              <p className="centered-status">Loading notes…</p>
            ) : (
              <>
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
                  <div className="notes-list-actions">
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
                        className="btn-primary"
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
                          isOwner={true}
                          onShare={tab === 'active' ? (id) => setSharingNoteId(id) : null}
                          onEdit={handleEdit}
                          onPin={handlePin}
                          onArchive={handleArchive}
                          onUnarchive={handleUnarchive}
                          onDeletePermanent={handleDelete}
                          onTagClick={handleTagClick}
                          onDeleteAttachment={handleDeleteAttachment}
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

