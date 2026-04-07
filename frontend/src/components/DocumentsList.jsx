import { useState, useCallback, useEffect, useRef, useTransition } from 'react'
import { useNavigate, NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocuments } from '../hooks/useDocuments'
import { useSharedDocuments } from '../hooks/useSharedDocuments'
import { useProfile } from '../hooks/useProfile'
import ThemeToggle from './ThemeToggle'
import AvatarBubble from './AvatarBubble'
import DocumentSharePanel from './DocumentSharePanel'

/**
 * Authenticated documents list view at `/documents`.
 *
 * Two tabs: "My documents" and "Shared with me" — mirrors NotesList structure.
 * Each owned document card has a ⋮ dropdown with Share and Delete actions.
 *
 * @param {{ userId: string, userEmail: string, onSignOut: Function }} props
 */
export default function DocumentsList({ userId, userEmail, onSignOut }) {
  const navigate = useNavigate()
  const { fullName, avatarUrl } = useProfile(userId)
  const {
    documents,
    loading,
    error,
    createDocument,
    deleteDocument,
    fetchDocuments,
  } = useDocuments(userId)

  const {
    sharedDocuments,
    loading: sharedLoading,
    error: sharedError,
    fetchSharedDocuments,
  } = useSharedDocuments(userId)

  // Fetch shared documents on mount.
  useEffect(() => { fetchSharedDocuments() }, [fetchSharedDocuments])

  const [view, setView] = useState('list')
  const showShared = view === 'shared'
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState(null)
  // Which document's SharePanel is currently open (null = closed).
  const [sharingDocId, setSharingDocId] = useState(null)

  async function handleNew() {
    try {
      const doc = await createDocument('Untitled document')
      navigate(`/documents/${doc.id}`)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  const handleDelete = useCallback(
    async (id) => {
      try {
        await deleteDocument(id)
      } catch (err) {
        setSaveError(err.message)
      }
    },
    [deleteDocument],
  )

  /** Returns the first ~120 chars of body text as a preview snippet. */
  function previewSnippet(body) {
    if (!body) return ''
    const text = body.replace(/[#*_>`~[\]()-]/g, '').trim()
    return text.length > 120 ? text.slice(0, 120) + '…' : text
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const navLinkClass = ({ isActive }) =>
    `section-toggle-btn${isActive ? ' section-toggle-btn--active' : ''}`

  return (
    <div className="notes-layout">
      {/* SharePanel modal */}
      {sharingDocId !== null ? (
        <DocumentSharePanel documentId={sharingDocId} onClose={() => setSharingDocId(null)} />
      ) : null}

      <header className="notes-header">
        <nav className="section-toggle" aria-label="Main sections">
          <NavLink to="/notes" className={navLinkClass}>Notes</NavLink>
          <NavLink to="/documents" className={navLinkClass}>Documents</NavLink>
        </nav>
        <div className="notes-header-right">
          <AvatarBubble avatarUrl={avatarUrl} displayName={fullName ?? userEmail} size={24} />
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

        <div className="notes-view" style={{ opacity: isPending ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          <div className="notes-tab-bar" role="tablist" aria-label="Document views">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              className={`notes-tab${view === 'list' ? ' notes-tab--active' : ''}`}
              onClick={() => {
                setSaveError(null)
                startTransition(async () => {
                  setView('list')
                  await fetchDocuments()
                })
              }}
            >
              My documents
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'shared'}
              className={`notes-tab${view === 'shared' ? ' notes-tab--active' : ''}`}
              onClick={() => {
                setSaveError(null)
                startTransition(async () => {
                  setView('shared')
                  await fetchSharedDocuments()
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
                  {sharedDocuments.length === 0
                    ? 'No documents shared with you'
                    : `${sharedDocuments.length} shared document${sharedDocuments.length === 1 ? '' : 's'}`}
                </h2>
              </div>
              {sharedLoading && sharedDocuments.length === 0 ? (
                <p className="centered-status">Loading…</p>
              ) : sharedError !== null ? (
                <p className="form-error" role="alert">{sharedError}</p>
              ) : sharedDocuments.length === 0 ? (
                <p className="empty-state">Documents shared with you will appear here.</p>
              ) : (
                <div className="doc-grid">
                  {sharedDocuments.map(doc => (
                    <SharedDocCard
                      key={doc.id}
                      doc={doc}
                      onNavigate={() => navigate(`/documents/${doc.id}`)}
                      formatDate={formatDate}
                      previewSnippet={previewSnippet}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="doc-list-header">
                <h2 className="notes-list-title">
                  {documents.length === 0
                    ? 'No documents yet'
                    : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
                </h2>
                <button type="button" className="btn-primary" onClick={handleNew}>
                  + New document
                </button>
              </div>

              {loading && documents.length === 0 ? (
                <p className="centered-status">Loading documents…</p>
              ) : documents.length === 0 ? (
                <p className="empty-state">
                  Click &quot;+ New document&quot; to get started.
                </p>
              ) : (
                <div className="doc-grid">
                  {documents.map(doc => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      onNavigate={() => navigate(`/documents/${doc.id}`)}
                      onShare={() => setSharingDocId(doc.id)}
                      onDelete={() => handleDelete(doc.id)}
                      formatDate={formatDate}
                      previewSnippet={previewSnippet}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/**
 * A shared-document card with owner avatar + name.
 *
 * Fetches the owner's avatar from storage (same pattern as NoteCard).
 * Defined at module top level. (rerender-no-inline-components)
 */
function SharedDocCard({ doc, onNavigate, formatDate, previewSnippet }) {
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState(null)
  const prevOwnerAvatarUrlRef = useRef(null)

  const ownerAvatarPath = doc.owner?.avatar_path ?? null
  const ownerName = doc.owner?.full_name ?? 'Unknown'

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

  return (
    <div
      className="doc-card doc-card--shared"
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate()
        }
      }}
    >
      <div className="doc-card-body">
        <div className="doc-card-shared-by">
          <AvatarBubble avatarUrl={ownerAvatarUrl} displayName={ownerName} size={16} />
          <span className="doc-card-shared-by-label">Shared by {ownerName}</span>
        </div>
        <h3 className="doc-card-title">{doc.title}</h3>
        {doc.body ? (
          <p className="doc-card-preview">{previewSnippet(doc.body)}</p>
        ) : null}
      </div>
      <div className="doc-card-footer">
        <span className="doc-card-date">
          {formatDate(doc.updated_at)}
        </span>
        <span className="share-badge">
          {doc.sharePermission === 'edit' ? 'Edit' : 'View'}
        </span>
      </div>
    </div>
  )
}

/**
 * A single owned-document card with a ⋮ action dropdown (Share, Delete).
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 */
function DocCard({ doc, onNavigate, onShare, onDelete, formatDate, previewSnippet }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuBelow, setMenuBelow] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

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
    <div
      className="doc-card"
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate()
        }
      }}
    >
      <div className="doc-card-body">
        <h3 className="doc-card-title">{doc.title}</h3>
        {doc.body ? (
          <p className="doc-card-preview">{previewSnippet(doc.body)}</p>
        ) : null}
      </div>
      <div className="doc-card-footer">
        <span className="doc-card-date">
          {formatDate(doc.updated_at)}
        </span>
        <div className="note-card-menu" ref={menuRef}>
          <button
            type="button"
            className="note-card-menu-trigger"
            aria-label="Document actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            ref={triggerRef}
            onClick={e => {
              e.stopPropagation()
              if (!menuOpen) {
                const rect = triggerRef.current?.getBoundingClientRect()
                setMenuBelow(rect ? rect.top < 200 : false)
              }
              setMenuOpen(o => !o)
              if (menuOpen) setPendingDelete(false)
            }}
          >
            ⋮
          </button>
          {menuOpen ? (
            <div className={`note-card-menu-dropdown${menuBelow ? ' note-card-menu-dropdown--below' : ''}`} role="menu">
              <button
                type="button"
                role="menuitem"
                className="note-card-menu-item"
                onClick={e => { e.stopPropagation(); onShare(); setMenuOpen(false) }}
              >
                Share
              </button>
              {pendingDelete ? (
                <div className="note-card-menu-confirm">
                  <span className="note-card-menu-confirm-label">Delete permanently?</span>
                  <div className="note-card-menu-confirm-actions">
                    <button
                      type="button"
                      className="btn-danger btn-small"
                      onClick={e => { e.stopPropagation(); onDelete(); setMenuOpen(false); setPendingDelete(false) }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-small"
                      onClick={e => { e.stopPropagation(); setPendingDelete(false) }}
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
                  onClick={e => { e.stopPropagation(); setPendingDelete(true) }}
                >
                  Delete
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
