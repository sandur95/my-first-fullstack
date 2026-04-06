import { useState, useCallback } from 'react'
import { useNavigate, NavLink } from 'react-router'
import { useDocuments } from '../hooks/useDocuments'
import { useProfile } from '../hooks/useProfile'
import ThemeToggle from './ThemeToggle'
import AvatarBubble from './AvatarBubble'

/**
 * Authenticated documents list view at `/documents`.
 *
 * Shows the document grid. Clicking a card navigates to `/documents/:id`.
 * The editor is now a separate route component (DocumentEditor).
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
  } = useDocuments(userId)

  const [saveError, setSaveError] = useState(null)

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
              <div
                key={doc.id}
                className="doc-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/documents/${doc.id}`)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate(`/documents/${doc.id}`)
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
                  <button
                    type="button"
                    className="btn-danger btn-small"
                    onClick={e => {
                      e.stopPropagation()
                      handleDelete(doc.id)
                    }}
                    aria-label={`Delete "${doc.title}"`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
