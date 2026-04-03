import { useState, useEffect, useRef } from 'react'
import { validateAttachmentFile } from '../hooks/useAttachmentUpload'

/**
 * Create / edit form — doubles as both depending on whether editingNote is set.
 * Includes an inline tag selector with type-to-filter and inline tag creation.
 *
 * Attachment design decisions:
 *  - Files are staged locally in pendingFiles[] and only uploaded when the user
 *    hits Save/Update (both create and edit modes). No network call on file pick.
 *    (rerender-move-effect-to-event)
 *  - In edit mode, existing attachments removed with × are staged in
 *    pendingDeletes[] and only deleted when the user hits Save/Update.
 *    Cancelling the editor discards both lists — the note stays unchanged.
 *  - No image preview in the editor — signed URLs are generated in NoteCard.
 *
 * @param {{
 *   editingNote: import('../lib/database.types').Note|null,
 *   onSave: Function,
 *   onCancel: Function,
 *   saving: boolean,
 *   allTags: import('../lib/database.types').Tag[],
 *   onCreateTag: Function,
 *   userId: string|null,
 *   sharePermission?: 'edit'|null,
 * }} props
 */
export default function NoteEditor({ editingNote, onSave, onCancel, saving, allTags, onCreateTag, userId, sharePermission = null }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [localAttachments, setLocalAttachments] = useState([])
  // Files staged for upload on Save (both create and edit modes).
  const [pendingFiles, setPendingFiles] = useState([])
  // Existing attachments staged for deletion on Save (edit mode only).
  const [pendingDeletes, setPendingDeletes] = useState([])
  // Validation error for the Attach button.
  const [attachError, setAttachError] = useState(null)

  // Hidden file input ref — triggered programmatically by the Attach button.
  const fileInputRef = useRef(null)

  // Sync form fields when the edit target changes
  useEffect(() => {
    if (editingNote !== null) {
      setTitle(editingNote.title)
      setContent(editingNote.content ?? '')
      setSelectedTagIds(editingNote.note_tags?.map(nt => nt.tag_id) ?? [])
      setLocalAttachments(editingNote.note_attachments ?? [])
    } else {
      setTitle('')
      setContent('')
      setSelectedTagIds([])
      setLocalAttachments([])
    }
    setPendingFiles([])
    setPendingDeletes([])
    setAttachError(null)
    setTagInput('')
    setShowDropdown(false)
  }, [editingNote])

  const lowerInput = tagInput.toLowerCase()
  const filteredTags = allTags.filter(
    t => !selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(lowerInput)
  )

  async function handleTagInputKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = tagInput.trim()
    if (!trimmed) return
    // If exact match exists, select it; otherwise create a new tag
    const existing = allTags.find(t => t.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        setSelectedTagIds(prev => [...prev, existing.id])
      }
    } else {
      const newTag = await onCreateTag(trimmed)
      setSelectedTagIds(prev => [...prev, newTag.id])
    }
    setTagInput('')
    setShowDropdown(false)
  }

  function handleDropdownSelect(tag) {
    setSelectedTagIds(prev => [...prev, tag.id])
    setTagInput('')
    setShowDropdown(false)
  }

  function handleRemoveTag(tagId) {
    setSelectedTagIds(prev => prev.filter(id => id !== tagId))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    await onSave({ title, content, tagIds: selectedTagIds, pendingFiles, pendingDeletes })
    // Clear fields only when creating (not editing)
    if (editingNote === null) {
      setTitle('')
      setContent('')
      setSelectedTagIds([])
      setPendingFiles([])
    }
  }

  const submitLabel = saving
    ? 'Saving…'
    : editingNote !== null
      ? 'Update'
      : 'Create'

  // The tags selected for display (resolved from allTags for the label)
  const selectedTags = selectedTagIds
    .map(id => allTags.find(t => t.id === id))
    .filter(Boolean)

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <h2>{editingNote !== null ? 'Edit note' : 'New note'}</h2>

      <label htmlFor="note-title">Title</label>
      <input
        id="note-title"
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Note title"
        required
      />

      <label htmlFor="note-content">Content</label>
      <textarea
        id="note-content"
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write your note…"
        rows={4}
      />

      {/* Tags: hidden for shared-note edits — tag management is owner-only */}
      {sharePermission === null ? (
        <>
          <label>Tags</label>
          {selectedTags.length > 0 ? (
            <div className="note-card-tags" style={{ marginBottom: '.375rem' }}>
              {selectedTags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  className="tag-pill tag-pill--remove"
                  onClick={() => handleRemoveTag(tag.id)}
                >
                  {tag.name} ×
                </button>
              ))}
            </div>
          ) : null}
          <div className="tag-input-wrap">
            <input
              type="text"
              value={tagInput}
              onChange={e => { setTagInput(e.target.value); setShowDropdown(true) }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setShowDropdown(false)}
              onKeyDown={handleTagInputKeyDown}
              placeholder="Add tag… (Enter to create)"
              autoComplete="off"
            />
            {showDropdown && (filteredTags.length > 0 || tagInput.trim() || allTags.length === 0) ? (
              <div className="tag-dropdown">
                {filteredTags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); handleDropdownSelect(tag) }}
                  >
                    {tag.name}
                  </button>
                ))}
                {tagInput.trim() && !allTags.some(t => t.name.toLowerCase() === tagInput.trim().toLowerCase()) ? (
                  <button
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      handleTagInputKeyDown({ key: 'Enter', preventDefault: () => {} })
                    }}
                  >
                    Create &ldquo;{tagInput.trim()}&rdquo;
                  </button>
                ) : null}
                {filteredTags.length === 0 && !tagInput.trim() ? (
                  <span className="tag-dropdown-hint">
                    {allTags.length === 0 ? 'Type to create your first tag' : 'All tags added — type to create more'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Attachments: hidden for shared-note edits — upload/management is owner-only.
          Attach file — available in both create and edit modes (owner only).
          Files are validated on pick but uploaded only when Save/Update is clicked.
          In edit mode, × on an existing attachment stages it for deletion on save.
          Cancelling discards all staged changes — the note stays unchanged.
          (rerender-move-effect-to-event) */}
      {sharePermission === null ? (
      <div className="note-editor-attachments">
        <label>Attachments</label>
        <div className="note-editor-attach-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setAttachError(null); fileInputRef.current?.click() }}
          >
            Attach file
          </button>
          <span className="note-editor-attach-hint">Images or PDF · max 10 MB</span>
        </div>
        {attachError !== null ? (
          <p className="form-error" role="alert" style={{ marginTop: '.375rem' }}>
            {attachError}
          </p>
        ) : null}
        {/* Hidden file input — accept mirrors ALLOWED_TYPES in useAttachmentUpload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            // Reset so the same file can be re-selected after an error
            e.target.value = ''
            if (!file) return
            const err = validateAttachmentFile(file)
            if (err) { setAttachError(err); return }
            setAttachError(null)
            setPendingFiles(prev => [...prev, file])
          }}
        />
        {/* Edit-mode: existing attachments — × stages for deletion on save */}
        {editingNote !== null && localAttachments.length > 0 ? (
          <ul className="note-editor-attachment-list">
            {localAttachments.map(att => (
              <li key={att.id} className="note-editor-attachment-item">
                <span className="attachment-name" title={att.file_name}>
                  {att.mime_type?.startsWith('image/') ? '🖼️' : '📄'}
                  {' '}{att.file_name}
                </span>
                <button
                  type="button"
                  className="attachment-delete"
                  title="Remove on save"
                  onClick={() => {
                    setLocalAttachments(prev => prev.filter(a => a.id !== att.id))
                    setPendingDeletes(prev => [...prev, att])
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Pending new files (both modes) — uploaded on save */}
        {pendingFiles.length > 0 ? (
          <ul className="note-editor-attachment-list">
            {pendingFiles.map((file, idx) => (
              <li key={idx} className="note-editor-attachment-item note-editor-attachment-item--pending">
                <span className="attachment-name" title={file.name}>
                  {file.type?.startsWith('image/') ? '🖼️' : '📄'}
                  {' '}{file.name}
                </span>
                <button
                  type="button"
                  className="attachment-delete"
                  title="Remove"
                  onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      ) : null}

      <div className="note-editor-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
