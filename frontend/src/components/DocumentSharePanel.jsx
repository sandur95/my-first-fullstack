import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocumentShares } from '../hooks/useDocumentShares'

/**
 * Modal overlay that lets the document owner manage who a document is shared with.
 *
 * Mirrors SharePanel.jsx but for documents.
 *
 * @param {{
 *   documentId: number,
 *   onClose: () => void
 * }} props
 */
export default function DocumentSharePanel({ documentId, onClose }) {
  const { shares, loading, error: fetchError, fetchShares, shareByEmail, updatePermission, revokeShare } = useDocumentShares(documentId)

  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState('view')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)
  const toastRef = useRef(null)
  const panelRef = useRef(null)

  // Focus trap — keeps Tab/Shift+Tab cycling within the panel and closes on Escape.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const focusable = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()
    function handleKeyDown(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    panel.addEventListener('keydown', handleKeyDown)
    return () => panel.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const showToast = useCallback((msg) => {
    clearTimeout(toastRef.current)
    setToastMessage(msg)
    toastRef.current = setTimeout(() => setToastMessage(null), 3000)
  }, [])

  // Load shares when the panel opens.
  useEffect(() => {
    fetchShares()
    return () => clearTimeout(toastRef.current)
  }, [fetchShares])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setSubmitting(true)
    setFormError(null)
    const err = await shareByEmail(trimmed, permission)
    if (err) {
      setFormError(err)
    } else {
      setEmail('')
      setPermission('view')
    }
    setSubmitting(false)
  }

  async function handlePermissionChange(shareId, newPermission) {
    const err = await updatePermission(shareId, newPermission)
    if (err) showToast(err)
  }

  async function handleRevoke(shareId) {
    const err = await revokeShare(shareId)
    if (err) showToast(err)
  }

  // Close on backdrop click (but not on panel content click).
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="share-panel-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        className="share-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-share-panel-title"
      >
        <div className="share-panel-header">
          <h2 id="doc-share-panel-title" className="share-panel-title">Share document</h2>
          <button
            type="button"
            className="share-panel-close"
            onClick={onClose}
            aria-label="Close share panel"
          >
            ✕
          </button>
        </div>

        {/* Add new share */}
        <form className="share-panel-form" onSubmit={handleSubmit}>
          <input
            type="email"
            className="share-panel-email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={submitting}
            aria-label="Sharee email address"
          />
          <select
            className="share-panel-permission-select"
            value={permission}
            onChange={e => setPermission(e.target.value)}
            disabled={submitting}
            aria-label="Permission level"
          >
            <option value="view">View</option>
            <option value="edit">Edit</option>
          </select>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !email.trim()}
          >
            {submitting ? 'Sharing…' : 'Share'}
          </button>
        </form>
        {formError !== null ? (
          <p className="form-error" role="alert">{formError}</p>
        ) : null}

        {/* Existing shares */}
        <div className="share-panel-list">
          {loading ? (
            <p className="centered-status">Loading…</p>
          ) : fetchError !== null ? (
            <p className="form-error" role="alert">{fetchError}</p>
          ) : shares.length === 0 ? (
            <p className="empty-state">Not shared with anyone yet.</p>
          ) : (
            shares.map(share => (
              <div key={share.id} className="share-row">
                <div className="share-row-info">
                  <span className="share-row-name">
                    {share.users?.full_name || share.users?.email || '(unknown)'}
                  </span>
                  {share.users?.full_name ? (
                    <span className="share-row-email">{share.users.email}</span>
                  ) : null}
                </div>
                <select
                  className="share-panel-permission-select share-panel-permission-select--inline"
                  value={share.permission}
                  onChange={e => handlePermissionChange(share.id, e.target.value)}
                  aria-label={`Permission for ${share.users?.email ?? 'user'}`}
                >
                  <option value="view">View</option>
                  <option value="edit">Edit</option>
                </select>
                <button
                  type="button"
                  className="btn-danger btn-small"
                  onClick={() => handleRevoke(share.id)}
                  aria-label={`Revoke access for ${share.users?.email ?? 'user'}`}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>

        {toastMessage !== null ? (
          <div className="toast-error" role="alert">{toastMessage}</div>
        ) : null}
      </div>
    </div>
  )
}
