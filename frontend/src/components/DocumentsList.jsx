import { useState, useCallback } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import { useProfile } from '../hooks/useProfile'
import ThemeToggle from './ThemeToggle'
import AvatarBubble from './AvatarBubble'

/**
 * Authenticated documents view — list + create button + placeholder editor.
 *
 * When no document is open, shows the document list.
 * When a document is open, shows a placeholder editor (title + textarea for body).
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 *
 * @param {{ userId: string, userEmail: string, section: 'notes'|'documents', onSectionChange: Function, onSignOut: Function }} props
 */
export default function DocumentsList({ userId, userEmail, section, onSectionChange, onSignOut }) {
  const { fullName, avatarUrl } = useProfile(userId)
  const {
    documents,
    loading,
    error,
    createDocument,
    updateDocument,
    deleteDocument,
  } = useDocuments(userId)

  // null = list view; object = editor view
  const [openDoc, setOpenDoc] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // --- Editor state ---
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  function openEditor(doc) {
    setEditTitle(doc.title)
    setEditBody(doc.body ?? '')
    setOpenDoc(doc)
    setSaveError(null)
  }

  async function handleNew() {
    try {
      const doc = await createDocument('Untitled document')
      openEditor(doc)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  async function handleSave() {
    if (openDoc === null) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateDocument(openDoc.id, { title: editTitle, body: editBody })
      setOpenDoc(prev => ({ ...prev, title: editTitle, body: editBody }))
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setOpenDoc(null)
    setSaveError(null)
  }

  const handleDelete = useCallback(
    async (id) => {
      try {
        await deleteDocument(id)
        // If the deleted document is currently open, close the editor.
        setOpenDoc(prev => (prev?.id === id ? null : prev))
      } catch (err) {
        setSaveError(err.message)
      }
    },
    [deleteDocument],
  )

  // --- Editor view -------------------------------------------------------
  if (openDoc !== null) {
    return (
      <div className="notes-layout">
        <header className="notes-header">
          <div className="section-toggle" role="tablist" aria-label="Main sections">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'notes'}
              className={`section-toggle-btn${section === 'notes' ? ' section-toggle-btn--active' : ''}`}
              onClick={() => onSectionChange('notes')}
            >
              Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'documents'}
              className={`section-toggle-btn${section === 'documents' ? ' section-toggle-btn--active' : ''}`}
              onClick={() => onSectionChange('documents')}
            >
              Documents
            </button>
          </div>
          <div className="notes-header-right">
            <AvatarBubble avatarUrl={avatarUrl} displayName={fullName ?? userEmail} size={24} />
            <ThemeToggle />
            <button type="button" className="btn-secondary" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="notes-main">
          <div className="doc-editor">
            <div className="doc-editor-toolbar">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                ← Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {saveError !== null ? (
              <p className="form-error" role="alert">{saveError}</p>
            ) : null}

            <input
              type="text"
              className="doc-editor-title"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Document title"
              aria-label="Document title"
            />
            <textarea
              className="doc-editor-body"
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              placeholder="Start writing Markdown…"
              aria-label="Document body"
            />
          </div>
        </main>
      </div>
    )
  }

  // --- List view ---------------------------------------------------------

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

  return (
    <div className="notes-layout">
      <header className="notes-header">
        <div className="section-toggle" role="tablist" aria-label="Main sections">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'notes'}
            className={`section-toggle-btn${section === 'notes' ? ' section-toggle-btn--active' : ''}`}
            onClick={() => onSectionChange('notes')}
          >
            Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'documents'}
            className={`section-toggle-btn${section === 'documents' ? ' section-toggle-btn--active' : ''}`}
            onClick={() => onSectionChange('documents')}
          >
            Documents
          </button>
        </div>
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
                onClick={() => openEditor(doc)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openEditor(doc)
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
