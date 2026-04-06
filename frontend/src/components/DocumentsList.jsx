import { useState, useCallback, useDeferredValue, useRef, useEffect, lazy, Suspense } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import { useProfile } from '../hooks/useProfile'
import { useAutoSave } from '../hooks/useAutoSave'
import ThemeToggle from './ThemeToggle'
import AvatarBubble from './AvatarBubble'

/** bundle-conditional — loaded only when the editor opens */
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

/**
 * Authenticated documents view — list + split-pane Markdown editor.
 *
 * When no document is open, shows the document grid.
 * When a document is open, shows a split-pane editor with raw Markdown
 * on the left and a live-rendered preview on the right.
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

  // --- Shared state (always called — rules of hooks) ---
  const [openDoc, setOpenDoc] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  // rerender-use-deferred-value — preview renders a frame behind typing
  const deferredBody = useDeferredValue(editBody)

  // --- Refs (rerender-use-ref-transient-values) ---
  const textareaRef = useRef(null)
  const splitContainerRef = useRef(null)
  const docIdRef = useRef(null)
  const titleRef = useRef('')
  const bodyRef = useRef('')

  // Keep refs in sync — written in an effect so the react-hooks/refs rule is satisfied.
  // Auto-save fires from setTimeout which always runs after effects, so timing is safe.
  useEffect(() => {
    docIdRef.current = openDoc?.id ?? null
    titleRef.current = editTitle
    bodyRef.current = editBody
  })

  // --- Auto-save ---
  const autoSaveFn = useCallback(async () => {
    if (docIdRef.current === null) return
    await updateDocument(docIdRef.current, {
      title: titleRef.current,
      body: bodyRef.current,
    })
    setOpenDoc(prev =>
      prev !== null ? { ...prev, title: titleRef.current, body: bodyRef.current } : null
    )
  }, [updateDocument])

  const { status: autoSaveStatus, schedule: scheduleAutoSave, flush: flushAutoSave } =
    useAutoSave(autoSaveFn)

  // --- Editor handlers ---

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

  function handleClose() {
    flushAutoSave()
    setOpenDoc(null)
    setSaveError(null)
  }

  function handleTitleChange(e) {
    setEditTitle(e.target.value)
    scheduleAutoSave()
  }

  function handleBodyChange(e) {
    setEditBody(e.target.value)
    scheduleAutoSave()
  }

  // --- Keyboard shortcuts (Ctrl/Cmd + B = bold, I = italic, S = save) ---

  function wrapSelection(marker) {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    const before = editBody.slice(0, start)
    const selected = editBody.slice(start, end)
    const after = editBody.slice(end)
    setEditBody(before + marker + selected + marker + after)
    scheduleAutoSave()
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.selectionStart = start + marker.length
      ta.selectionEnd = end + marker.length
      ta.focus()
    })
  }

  function handleEditorKeyDown(e) {
    const isMod = e.ctrlKey || e.metaKey
    if (!isMod) return
    if (e.key === 's') {
      e.preventDefault()
      flushAutoSave()
      return
    }
    // Bold / italic only when textarea is focused
    if (document.activeElement !== textareaRef.current) return
    if (e.key === 'b') {
      e.preventDefault()
      wrapSelection('**')
    } else if (e.key === 'i') {
      e.preventDefault()
      wrapSelection('_')
    }
  }

  // --- Resizable split pane (pointer events + CSS variable, zero re-renders) ---

  function handleDividerPointerDown(e) {
    e.target.setPointerCapture(e.pointerId)
  }

  function handleDividerPointerMove(e) {
    if (!e.target.hasPointerCapture(e.pointerId)) return
    const rect = splitContainerRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    const clamped = Math.min(80, Math.max(20, pct))
    // js-batch-dom-css — write to CSS variable, skip React re-render
    splitContainerRef.current.style.setProperty('--split-left', `${clamped}%`)
  }

  const handleDelete = useCallback(
    async (id) => {
      try {
        await deleteDocument(id)
        setOpenDoc(prev => (prev?.id === id ? null : prev))
      } catch (err) {
        setSaveError(err.message)
      }
    },
    [deleteDocument],
  )

  // --- Auto-save status label (rendering-conditional-render) ---
  const saveStatusLabel =
    autoSaveStatus === 'saving' ? 'Saving…' :
    autoSaveStatus === 'saved' ? '✓ Saved' :
    autoSaveStatus === 'error' ? 'Save failed' :
    null

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

        {/* onKeyDown on the editor container so Ctrl+S works from any child */}
        <main className="notes-main doc-editor-main" onKeyDown={handleEditorKeyDown}>
          <div className="doc-editor">
            <div className="doc-editor-toolbar">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                ← Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={autoSaveStatus === 'saving'}
                onClick={flushAutoSave}
              >
                Save
              </button>
              {saveStatusLabel !== null ? (
                <span
                  className={`doc-autosave-status doc-autosave-status--${autoSaveStatus}`}
                  role="status"
                >
                  {saveStatusLabel}
                </span>
              ) : null}
            </div>

            {saveError !== null ? (
              <p className="form-error" role="alert">{saveError}</p>
            ) : null}

            <input
              type="text"
              className="doc-editor-title"
              value={editTitle}
              onChange={handleTitleChange}
              placeholder="Document title"
              aria-label="Document title"
            />

            <div className="doc-editor-split" ref={splitContainerRef}>
              <textarea
                ref={textareaRef}
                className="doc-editor-body"
                value={editBody}
                onChange={handleBodyChange}
                placeholder="Start writing Markdown…"
                aria-label="Document body"
              />
              <div
                className="doc-editor-divider"
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                aria-hidden="true"
              />
              <div className="doc-editor-preview" aria-label="Markdown preview" role="region">
                <Suspense fallback={<p className="centered-status">Loading preview…</p>}>
                  <MarkdownPreview markdown={deferredBody} />
                </Suspense>
              </div>
            </div>
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
