import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DocumentEditor from '../../components/DocumentEditor'

// ---------------------------------------------------------------------------
// Seed user constants (must match supabase/seed.sql)
// ---------------------------------------------------------------------------
const ALICE_ID = '00000000-0000-0000-0000-000000000001'
const BOB_ID   = '00000000-0000-0000-0000-000000000002'

// ---------------------------------------------------------------------------
// Hoisted mock refs — accessible inside vi.mock() factories
// ---------------------------------------------------------------------------
const { singleFn, maybeSingleFn, channelMock } = vi.hoisted(() => {
  const channelMock = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    send: vi.fn(),
    unsubscribe: vi.fn(),
  }
  return {
    singleFn: vi.fn(),
    maybeSingleFn: vi.fn(),
    channelMock,
  }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// react-router — remove the need for a real Router wrapper
vi.mock('react-router', () => ({
  useParams: vi.fn(() => ({ documentId: 'doc-123' })),
  useNavigate: vi.fn(() => vi.fn()),
  NavLink: ({ children }) => <span>{children}</span>,
}))

// supabase singleton
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: singleFn,
      maybeSingle: maybeSingleFn,
    })),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  },
}))

// SupabaseBroadcastProvider — replaces the complex Yjs realtime layer
// Must use a regular function (not arrow) because it's called with `new`
vi.mock('../../lib/SupabaseBroadcastProvider', () => ({
  SupabaseBroadcastProvider: vi.fn().mockImplementation(function () {
    return {
      onSynced: vi.fn(),
      destroy: vi.fn(),
      broadcastPresence: vi.fn(),
      broadcastLeave: vi.fn(),
      broadcastTitleUpdate: vi.fn(),
      _onPresenceUpdate: null,
      _onPresenceLeave: null,
      _onPresenceRequest: null,
      _onTitleUpdate: null,
    }
  }),
}))

// useProfile — return a static profile without hitting supabase
vi.mock('../../hooks/useProfile', () => ({
  useProfile: vi.fn(() => ({ fullName: 'Alice', avatarUrl: null, avatarPath: null })),
}))

// usePresence — ephemeral; return empty peers so no presence UI is rendered
vi.mock('../../hooks/usePresence', () => ({
  usePresence: vi.fn(() => ({ peers: [], broadcastCursor: vi.fn() })),
}))

// useAutoSave — return a no-op save hook
vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({ status: 'idle', schedule: vi.fn(), flush: vi.fn() })),
}))

// useYjsTextarea — bind to an empty text without a real Y.Doc
vi.mock('../../hooks/useYjsTextarea', () => ({
  useYjsTextarea: vi.fn(() => ({ text: '', handleChange: vi.fn() })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDoc(userId, title = 'Test Doc') {
  return {
    id: 'doc-123',
    user_id: userId,
    title,
    body: '',
    yjs_state: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DocumentEditor — owner-only Share button', () => {
  beforeEach(() => {
    singleFn.mockReset()
    maybeSingleFn.mockReset()
  })

  it('shows Share button when the viewer is the document owner', async () => {
    singleFn.mockResolvedValue({ data: makeDoc(ALICE_ID), error: null })
    maybeSingleFn.mockResolvedValue({ data: null, error: null })

    render(
      <DocumentEditor
        userId={ALICE_ID}
        userEmail="alice@example.com"
        onSignOut={vi.fn()}
      />,
    )

    // Wait for loading to complete and Share button to appear
    expect(await screen.findByRole('button', { name: /^share$/i })).toBeInTheDocument()
  })

  it('hides Share button when the viewer is a sharee (not the owner)', async () => {
    // Document owned by Bob, viewed by Alice
    singleFn.mockResolvedValue({ data: makeDoc(BOB_ID), error: null })
    maybeSingleFn.mockResolvedValue({ data: { permission: 'edit' }, error: null })

    render(
      <DocumentEditor
        userId={ALICE_ID}
        userEmail="alice@example.com"
        onSignOut={vi.fn()}
      />,
    )

    // Wait for the toolbar Save button to appear (confirms loading is done)
    await screen.findByRole('button', { name: /save/i })
    expect(screen.queryByRole('button', { name: /^share$/i })).not.toBeInTheDocument()
  })
})

describe('DocumentEditor — canEdit rendering (textarea vs read-only)', () => {
  beforeEach(() => {
    singleFn.mockReset()
    maybeSingleFn.mockReset()
  })

  it('shows editor textarea when viewer has edit permission', async () => {
    singleFn.mockResolvedValue({ data: makeDoc(BOB_ID), error: null })
    maybeSingleFn.mockResolvedValue({ data: { permission: 'edit' }, error: null })

    render(
      <DocumentEditor
        userId={ALICE_ID}
        userEmail="alice@example.com"
        onSignOut={vi.fn()}
      />,
    )

    expect(await screen.findByLabelText(/document title/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/document body/i)).toBeInTheDocument()
  })

  it('shows read-only h1 title (not input) for view-only sharee', async () => {
    singleFn.mockResolvedValue({ data: makeDoc(BOB_ID, 'My Doc'), error: null })
    maybeSingleFn.mockResolvedValue({ data: { permission: 'view' }, error: null })

    render(
      <DocumentEditor
        userId={ALICE_ID}
        userEmail="alice@example.com"
        onSignOut={vi.fn()}
      />,
    )

    // Wait for loading to finish (read-only title heading appears)
    const readOnlyTitle = await screen.findByRole('heading', { name: /my doc/i })
    expect(readOnlyTitle).toBeInTheDocument()
    // No editable title input
    expect(screen.queryByLabelText(/document title/i)).not.toBeInTheDocument()
    // No Save button
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })
})
