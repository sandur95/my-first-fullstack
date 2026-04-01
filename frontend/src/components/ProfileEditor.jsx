import { useState, useEffect } from 'react'

/**
 * Inline form for viewing and editing the user's display name.
 *
 * Mirrors the NoteEditor pattern: same .note-editor / .note-editor-actions
 * CSS classes, same submit-while-saving guard, same cancel prop.
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 *
 * @param {{
 *   fullName: string|null,
 *   onSave: Function,
 *   onCancel: Function,
 *   saving: boolean
 * }} props
 */
export default function ProfileEditor({ fullName, onSave, onCancel, saving }) {
  const [name, setName] = useState('')

  // Sync field once the fetch from useProfile resolves
  useEffect(() => {
    setName(fullName ?? '')
  }, [fullName])

  async function handleSubmit(e) {
    e.preventDefault()
    await onSave(name)
  }

  // Ternary — avoids falsy 0/NaN rendering (rendering-conditional-render)
  const submitLabel = saving ? 'Saving…' : 'Save'

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <h2>Profile</h2>

      <label htmlFor="profile-full-name">Display name</label>
      <input
        id="profile-full-name"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="name"
      />

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
