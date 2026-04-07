import { useState, useCallback, useDeferredValue, useRef, useEffect, lazy, Suspense } from 'react'
import { useParams, useNavigate, NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { useProfile } from '../hooks/useProfile'
import { useAutoSave } from '../hooks/useAutoSave'
import ThemeToggle from './ThemeToggle'
import AvatarBubble from './AvatarBubble'
import DocumentSharePanel from './DocumentSharePanel'

/** bundle-conditional — loaded only when the editor opens */
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

/**
 * Route component for editing a single document at `/documents/:documentId`.
 *
 * Fetches the document by ID from the URL param (not via route state) so that
 * shareable URLs work when navigated to directly.
 *
 * Subscribes to Realtime changes for the single document so external updates
 * (e.g. another browser tab) are reflected.
 *
 * @param {{ userId: string, userEmail: string, onSignOut: Function }} props
 */
export default function DocumentEditor({ userId, userEmail, onSignOut }) {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { fullName, avatarUrl } = useProfile(userId)

  // --- Document state ---
  const [doc, setDoc] = useState(null)
  const [docLoading, setDocLoading] = useState(true)
  const [docError, setDocError] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  // --- Sharing state ---
  const [shareOpen, setShareOpen] = useState(false)
  // null while loading, 'view' | 'edit' for sharees, undefined for owner
  const [sharePermission, setSharePermission] = useState(null)

  // rerender-use-deferred-value — preview renders a frame behind typing
  const deferredBody = useDeferredValue(editBody)

  // --- Refs (rerender-use-ref-transient-values) ---
  const textareaRef = useRef(null)
  const splitContainerRef = useRef(null)
  const docIdRef = useRef(null)
  const titleRef = useRef('')
  const bodyRef = useRef('')

  // Keep refs in sync — written in an effect so the react-hooks/refs rule is satisfied.
  useEffect(() => {
    docIdRef.current = documentId
    titleRef.current = editTitle
    bodyRef.current = editBody
  })

  // --- Fetch document by ID on mount ---
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('documents')
        .select('id, user_id, title, body, created_at, updated_at')
        .eq('id', documentId)
        .single()
      if (cancelled) return
      if (err) {
        setDocError(err.message)
        setDocLoading(false)
        return
      }
      setDoc(data)
      setEditTitle(data.title)
      setEditBody(data.body ?? '')
      // Determine share permission for non-owners
      if (data.user_id !== userId) {
        const { data: shareRow } = await supabase
          .from('document_shares')
          .select('permission')
          .eq('document_id', documentId)
          .eq('shared_with_user_id', userId)
          .maybeSingle()
        if (cancelled) return
        setSharePermission(shareRow?.permission ?? 'view')
      } else {
        setSharePermission(undefined)
      }
      setDocLoading(false)
    })()
    return () => { cancelled = true }
  }, [documentId, userId])

  // --- Realtime subscription for this single document ---
  useEffect(() => {
    if (!documentId) return
    const channel = supabase
      .channel(`document-${documentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'documents',
          filter: `id=eq.${documentId}`,
        },
        (payload) => {
          setDoc(payload.new)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'documents',
          filter: `id=eq.${documentId}`,
        },
        () => {
          // Document was deleted externally — go back to list
          navigate('/documents', { replace: true })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [documentId, navigate])

  // --- Auto-save ---
  const autoSaveFn = useCallback(async () => {
    if (docIdRef.current === null) return
    const { error: err } = await supabase
      .from('documents')
      .update({ title: titleRef.current, body: bodyRef.current })
      .eq('id', docIdRef.current)
    if (err) throw err
  }, [])

  const { status: autoSaveStatus, schedule: scheduleAutoSave, flush: flushAutoSave } =
    useAutoSave(autoSaveFn)

  // --- Editor handlers ---

  function handleClose() {
    flushAutoSave()
    navigate('/documents')
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
    splitContainerRef.current.style.setProperty('--split-left', `${clamped}%`)
  }

  // --- Derived sharing state ---
  const isOwner = doc !== null && doc.user_id === userId
  const canEdit = isOwner || sharePermission === 'edit'

  // --- Auto-save status label (rendering-conditional-render) ---
  const saveStatusLabel =
    autoSaveStatus === 'saving' ? 'Saving…' :
    autoSaveStatus === 'saved' ? '✓ Saved' :
    autoSaveStatus === 'error' ? 'Save failed' :
    null

  const navLinkClass = ({ isActive }) =>
    `section-toggle-btn${isActive ? ' section-toggle-btn--active' : ''}`

  // --- Loading state ---
  if (docLoading) {
    return <div className="centered-status">Loading document…</div>
  }

  // --- Error / not found ---
  if (docError !== null || doc === null) {
    return (
      <div className="notes-layout notes-layout--fullscreen doc-editor-enter">
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
          <p className="form-error" role="alert">
            {docError ?? 'Document not found.'}
          </p>
          <button type="button" className="btn-secondary" onClick={() => navigate('/documents')}>
            ← Back to documents
          </button>
        </main>
      </div>
    )
  }

  // --- Editor view ---
  return (
    <div className="notes-layout notes-layout--fullscreen doc-editor-enter">
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

      {/* onKeyDown on the editor container so Ctrl+S works from any child */}
      <main className="notes-main doc-editor-main" onKeyDown={canEdit ? handleEditorKeyDown : undefined}>
        <div className="doc-editor">
          <div className="doc-editor-toolbar">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              ← Back
            </button>
            {canEdit ? (
              <button
                type="button"
                className="btn-primary"
                disabled={autoSaveStatus === 'saving'}
                onClick={flushAutoSave}
              >
                Save
              </button>
            ) : null}
            {canEdit && saveStatusLabel !== null ? (
              <span
                className={`doc-autosave-status doc-autosave-status--${autoSaveStatus}`}
                role="status"
              >
                {saveStatusLabel}
              </span>
            ) : null}
            {isOwner ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShareOpen(true)}
              >
                Share
              </button>
            ) : null}
            {!isOwner ? (
              <span className="share-badge">
                {sharePermission === 'edit' ? 'Shared (edit)' : 'Shared (view)'}
              </span>
            ) : null}
          </div>

          {canEdit ? (
            <input
              type="text"
              className="doc-editor-title"
              value={editTitle}
              onChange={handleTitleChange}
              placeholder="Document title"
              aria-label="Document title"
            />
          ) : (
            <h1 className="doc-editor-title doc-editor-title--readonly">{editTitle}</h1>
          )}

          {canEdit ? (
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
          ) : (
            <div className="doc-editor-split doc-editor-split--readonly">
              <div className="doc-editor-preview" aria-label="Markdown preview" role="region">
                <Suspense fallback={<p className="centered-status">Loading preview…</p>}>
                  <MarkdownPreview markdown={deferredBody} />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </main>

      {shareOpen ? (
        <DocumentSharePanel
          documentId={Number(documentId)}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  )
}
