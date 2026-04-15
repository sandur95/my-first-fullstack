import { useState, useCallback, useDeferredValue, useRef, useEffect, useLayoutEffect, lazy, Suspense } from 'react'
import getCaretCoordinates from 'textarea-caret'
import { useParams, useNavigate, NavLink } from 'react-router'
import * as Y from 'yjs'
import { supabase } from '../lib/supabase'
import { useProfile } from '../hooks/useProfile'
import { useAutoSave } from '../hooks/useAutoSave'
import { useYjsTextarea } from '../hooks/useYjsTextarea'
import { SupabaseBroadcastProvider } from '../lib/SupabaseBroadcastProvider'
import { uint8ArrayToHex, hexToUint8Array } from '../lib/yjs-encoding'
import { usePresence } from '../hooks/usePresence'
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
 * Uses Yjs (CRDT) for real-time collaborative editing with a custom
 * Supabase Broadcast provider. Persists both the Yjs binary state and
 * the plain-text body on auto-save.
 *
 * @param {{ userId: string, userEmail: string, onSignOut: Function }} props
 */
export default function DocumentEditor({ userId, userEmail, onSignOut }) {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { fullName, avatarUrl, avatarPath } = useProfile(userId)

  // --- Document state ---
  const [doc, setDoc] = useState(null)
  const [docLoading, setDocLoading] = useState(true)
  const [docError, setDocError] = useState(null)
  const [editTitle, setEditTitle] = useState('')

  // --- Sharing state ---
  const [shareOpen, setShareOpen] = useState(false)
  // null while loading, 'view' | 'edit' for sharees, undefined for owner
  const [sharePermission, setSharePermission] = useState(null)

  // --- Derived sharing state (computed early so usePresence can reference canEdit) ---
  const isOwner = doc !== null && doc.user_id === userId
  const canEdit = isOwner || sharePermission === 'edit'

  // --- Yjs state ---
  // ydoc is stored in state so that useYjsTextarea re-runs when it's created.
  // ydocRef provides stable access inside callbacks (auto-save, wrapSelection).
  const [ydoc, setYdoc] = useState(null)
  const ydocRef = useRef(null)
  const providerRef = useRef(null)

  // --- Refs ---
  const textareaRef = useRef(null)
  const splitContainerRef = useRef(null)
  const docIdRef = useRef(null)
  const titleRef = useRef('')

  // Bind Yjs Y.Text to the textarea — returns { text, handleChange }
  const { text: editBody, handleChange: onYjsBodyChange } = useYjsTextarea(ydoc, textareaRef)

  // rerender-use-deferred-value — preview renders a frame behind typing
  const deferredBody = useDeferredValue(editBody)

  // --- Presence awareness: avatar bar + remote cursors ---
  const { peers, broadcastCursor } = usePresence(
    providerRef.current, userId, userEmail, fullName, avatarPath, canEdit,
  )
  // Keep refs in sync — written in an effect so the react-hooks/refs rule is satisfied.
  useEffect(() => {
    docIdRef.current = documentId
    titleRef.current = editTitle
  })

  // --- Zero-lag remote cursor scroll sync ---
  // Bypasses React state entirely: a native passive scroll listener applies
  // a CSS transform directly to the overlay inner div so the cursor highlights
  // move in the same frame as the textarea scroll (client-passive-event-listeners).
  const overlayInnerRef = useRef(null)
  useLayoutEffect(() => {
    const ta = textareaRef.current
    const inner = overlayInnerRef.current
    if (!ta || !inner) return
    const onScroll = () => {
      inner.style.transform = `translateY(-${ta.scrollTop}px)`
    }
    // Apply immediately so existing scroll offset is reflected before the first scroll event
    onScroll()
    ta.addEventListener('scroll', onScroll, { passive: true })
    return () => ta.removeEventListener('scroll', onScroll)
  }, [canEdit])

  // --- Fetch document + initialise Yjs doc & Broadcast provider ---
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('documents')
        .select('id, user_id, title, body, yjs_state, created_at, updated_at')
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

      // Initialise Y.Doc
      const newYdoc = new Y.Doc()
      if (data.yjs_state) {
        try {
          Y.applyUpdate(newYdoc, hexToUint8Array(data.yjs_state))
        } catch {
          // Corrupted/stale binary state — fall back to plain-text body.
          // The next auto-save will write a valid yjs_state.
          newYdoc.getText('body').insert(0, data.body ?? '')
        }
      } else {
        // Migration path for pre-Yjs documents — seed from plain-text body
        newYdoc.getText('body').insert(0, data.body ?? '')
      }
      ydocRef.current = newYdoc
      setYdoc(newYdoc)

      // Start Broadcast provider for collaborative sync
      const provider = new SupabaseBroadcastProvider(
        supabase,
        `doc-yjs-${documentId}`,
        newYdoc,
      )
      providerRef.current = provider

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
    return () => {
      cancelled = true
      providerRef.current?.destroy()
      providerRef.current = null
      ydocRef.current?.destroy()
      ydocRef.current = null
      setYdoc(null)
    }
  }, [documentId, userId])

  // --- Realtime subscription: document DELETE only ---
  // (UPDATE sync is handled by the Yjs Broadcast provider)
  useEffect(() => {
    if (!documentId) return
    const channel = supabase
      .channel(`document-delete-${documentId}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'documents',
          filter: `id=eq.${documentId}`,
        },
        () => {
          navigate('/documents', { replace: true })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [documentId, navigate])

  // --- Auto-save: persists both plain-text body and Yjs binary state ---
  const autoSaveFn = useCallback(async () => {
    if (docIdRef.current === null || !ydocRef.current) return
    const ytext = ydocRef.current.getText('body')
    const { error: err } = await supabase
      .from('documents')
      .update({
        title: titleRef.current,
        body: ytext.toString(),
        yjs_state: uint8ArrayToHex(Y.encodeStateAsUpdate(ydocRef.current)),
      })
      .eq('id', docIdRef.current)
    if (err) throw err
  }, [])

  const { status: autoSaveStatus, schedule: scheduleAutoSave, flush: flushAutoSave } =
    useAutoSave(autoSaveFn)

  // --- Safety-net: flush auto-save on page unload ---
  useEffect(() => {
    const onBeforeUnload = () => flushAutoSave()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [flushAutoSave])

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
    onYjsBodyChange(e)
    scheduleAutoSave()
    broadcastCursor(e.target.selectionStart)
  }

  function handleSelect(e) {
    broadcastCursor(e.target.selectionStart)
  }

  // --- Keyboard shortcuts (Ctrl/Cmd + B = bold, I = italic, S = save) ---

  function wrapSelection(marker) {
    const ta = textareaRef.current
    const ydoc = ydocRef.current
    if (!ta || !ydoc) return
    const { selectionStart: start, selectionEnd: end } = ta
    const ytext = ydoc.getText('body')
    // Insert markers via Yjs so the edit is broadcast to peers
    ydoc.transact(() => {
      ytext.insert(end, marker)
      ytext.insert(start, marker)
    }, 'local')
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

  // --- Jump to peer cursor: scrolls the textarea to centre on the peer's last cursor position ---
  function scrollToPeer(peer) {
    const ta = textareaRef.current
    if (!ta || typeof peer.cursorIndex !== 'number') return
    const coords = getCaretCoordinates(ta, peer.cursorIndex)
    ta.scrollTo({ top: coords.top - ta.clientHeight / 2, behavior: 'smooth' })
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

  // --- Save button label — merges auto-save status into the button text
  // so it doesn't push other toolbar elements around. ---
  const saveButtonLabel =
    autoSaveStatus === 'saving' ? 'Saving…' :
    autoSaveStatus === 'saved'  ? '✓ Saved' :
    autoSaveStatus === 'error'  ? 'Save failed' :
    'Save'

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
                className={`btn-primary doc-save-btn--${autoSaveStatus ?? 'idle'}`}
                disabled={autoSaveStatus === 'saving'}
                onClick={flushAutoSave}
              >
                {saveButtonLabel}
              </button>
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
            {peers.length > 0 ? (
              <div className="doc-presence-bar" aria-label="Connected users">
                {peers.map((peer) => (
                  <button
                    key={peer.userId}
                    type="button"
                    className="doc-presence-avatar"
                    style={{ color: peer.color }}
                    title={`Jump to ${peer.name}'s cursor`}
                    aria-label={`Jump to ${peer.name}'s cursor`}
                    onClick={() => scrollToPeer(peer)}
                  >
                    <AvatarBubble
                      avatarUrl={peer.avatarUrl}
                      displayName={peer.name}
                      size={28}
                    />
                  </button>
                ))}
              </div>
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
              <div className="doc-textarea-wrapper">
                <textarea
                  ref={textareaRef}
                  className="doc-editor-body"
                  value={editBody}
                  onChange={handleBodyChange}
                  onSelect={handleSelect}
                  placeholder="Start writing Markdown…"
                  aria-label="Document body"
                />
                <div className="doc-cursor-overlay" aria-hidden="true">
                  {/* Inner div is always rendered so overlayInnerRef is populated when canEdit is true,
                      allowing the scroll listener (useLayoutEffect) to attach on the first render. */}
                  <div ref={overlayInnerRef} style={{ position: 'absolute', inset: 0 }}>
                    {peers.filter((p) => p.canEdit).map((peer) => {
                        if (!textareaRef.current || typeof peer.cursorIndex !== 'number') return null;
                        const clampedIndex = Math.max(0, Math.min(peer.cursorIndex, editBody.length));
                        // getCaretCoordinates returns content-space top (no scroll subtraction needed)
                        const caretCoords = getCaretCoordinates(textareaRef.current, clampedIndex);
                        const lineHeight = parseFloat(getComputedStyle(textareaRef.current).lineHeight) || 22.4;
                        const highlightWidth = textareaRef.current.clientWidth;
                        const highlightTop = caretCoords.top;
                        return (
                          <div key={peer.userId}>
                            <div
                              className="doc-cursor-line"
                              style={{
                                top: highlightTop,
                                left: 0,
                                height: lineHeight,
                                width: highlightWidth,
                                background: peer.color,
                                opacity: 0.35,
                                position: 'absolute',
                                pointerEvents: 'none',
                              }}
                            />
                            <span
                              className="doc-cursor-label"
                              style={{ background: peer.color, top: highlightTop, left: 0, position: 'absolute' }}
                            >
                              {peer.name}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
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
