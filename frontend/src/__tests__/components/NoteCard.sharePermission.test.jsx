import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoteCard from '../../components/NoteCard'

// ---------------------------------------------------------------------------
// Mock supabase — NoteCard calls supabase.storage.from().download() in useEffect
// ---------------------------------------------------------------------------
vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  },
}))

// ---------------------------------------------------------------------------
// Minimal note fixture
// ---------------------------------------------------------------------------
const BASE_NOTE = {
  id: 1,
  title: 'Test Note',
  content: 'Some content',
  pinned: false,
  created_at: new Date().toISOString(),
  note_tags: [],
  note_attachments: [],
}

const defaultHandlers = {
  onEdit: vi.fn(),
  onPin: vi.fn(),
  onArchive: vi.fn(),
  onUnarchive: vi.fn(),
  onDeletePermanent: vi.fn(),
  onTagClick: vi.fn(),
  onDeleteAttachment: vi.fn(),
  onShare: vi.fn(),
}

describe('NoteCard — sharePermission menu visibility', () => {
  it('(a) view-only sharee — ⋮ actions button is hidden', () => {
    render(
      <NoteCard
        note={BASE_NOTE}
        isArchived={false}
        isOwner={false}
        sharePermission="view"
        ownerName="Alice Smith"
        {...defaultHandlers}
      />,
    )
    expect(screen.queryByRole('button', { name: /note actions/i })).not.toBeInTheDocument()
  })

  it('(b) edit-permission sharee — ⋮ actions button is visible and Edit is callable', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()

    render(
      <NoteCard
        note={BASE_NOTE}
        isArchived={false}
        isOwner={false}
        sharePermission="edit"
        ownerName="Alice Smith"
        {...defaultHandlers}
        onEdit={onEdit}
      />,
    )

    const menuTrigger = screen.getByRole('button', { name: /note actions/i })
    expect(menuTrigger).toBeInTheDocument()

    await user.click(menuTrigger)

    const editButton = screen.getByRole('menuitem', { name: /^edit$/i })
    await user.click(editButton)

    expect(onEdit).toHaveBeenCalledWith(BASE_NOTE)
  })
})

describe('NoteCard — shared-by attribution', () => {
  it('(c) shows owner name when sharePermission is "view"', () => {
    render(
      <NoteCard
        note={BASE_NOTE}
        isArchived={false}
        isOwner={false}
        sharePermission="view"
        ownerName="Alice Smith"
        {...defaultHandlers}
      />,
    )
    expect(screen.getByText(/shared by alice smith/i)).toBeInTheDocument()
  })

  it('(d) shows no attribution when sharePermission is null (own note)', () => {
    render(
      <NoteCard
        note={BASE_NOTE}
        isArchived={false}
        isOwner={true}
        sharePermission={null}
        ownerName={null}
        {...defaultHandlers}
      />,
    )
    expect(screen.queryByText(/shared by/i)).not.toBeInTheDocument()
  })
})
