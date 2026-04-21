import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NoteEditor from '../../components/NoteEditor'

// NoteEditor imports validateAttachmentFile — mock the module to prevent side-effects
vi.mock('../../hooks/useAttachmentUpload', () => ({
  validateAttachmentFile: vi.fn(() => null),
}))

const defaultProps = {
  editingNote: null,
  onSave: vi.fn(),
  onCancel: vi.fn(),
  saving: false,
  allTags: [],
  onCreateTag: vi.fn(),
  userId: 'test-user-id',
}

describe('NoteEditor — sharePermission attachment gate', () => {
  it('shows "Attach file" button when sharePermission is null (owner)', () => {
    render(<NoteEditor {...defaultProps} sharePermission={null} />)
    expect(screen.getByRole('button', { name: /attach file/i })).toBeInTheDocument()
  })

  it('hides "Attach file" button when sharePermission is "edit" (sharee)', () => {
    render(<NoteEditor {...defaultProps} sharePermission="edit" />)
    expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument()
  })

  it('hides "Attach file" button when sharePermission is "view" (sharee)', () => {
    render(<NoteEditor {...defaultProps} sharePermission="view" />)
    expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument()
  })
})
