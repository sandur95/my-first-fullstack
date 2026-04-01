import { useState, useEffect } from 'react'

/**
 * Create / edit form — doubles as both depending on whether editingNote is set.
 * Includes an inline tag selector with type-to-filter and inline tag creation.
 *
 * @param {{
 *   editingNote: import('../lib/database.types').Note|null,
 *   onSave: Function,
 *   onCancel: Function,
 *   saving: boolean,
 *   allTags: import('../lib/database.types').Tag[],
 *   onCreateTag: Function
 * }} props
 */
export default function NoteEditor({ editingNote, onSave, onCancel, saving, allTags, onCreateTag }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  // Sync form fields when the edit target changes
  useEffect(() => {
    if (editingNote !== null) {
      setTitle(editingNote.title)
      setContent(editingNote.content ?? '')
      setSelectedTagIds(editingNote.note_tags?.map(nt => nt.tag_id) ?? [])
    } else {
      setTitle('')
      setContent('')
      setSelectedTagIds([])
    }
    setTagInput('')
    setShowDropdown(false)
  }, [editingNote])

  const filteredTags = allTags.filter(
    t =>
      !selectedTagIds.includes(t.id) &&
      t.name.toLowerCase().includes(tagInput.toLowerCase())
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
    await onSave({ title, content, tagIds: selectedTagIds })
    // Clear fields only when creating (not editing)
    if (editingNote === null) {
      setTitle('')
      setContent('')
      setSelectedTagIds([])
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
        {showDropdown && (filteredTags.length > 0 || tagInput.trim()) ? (
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
          </div>
        ) : null}
      </div>

      <div className="note-editor-actions">
        <button type="submit" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
