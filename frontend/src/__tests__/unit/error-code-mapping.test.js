import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShares } from '../../hooks/useShares'
import { useDocumentShares } from '../../hooks/useDocumentShares'

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
const { rpcMock, singleInsertMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  singleInsertMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: singleInsertMock,
        })),
      })),
    })),
  },
}))

// Shared setup: make the RPC always return a user so we reach the insert step
function mockRpcSuccess() {
  rpcMock.mockResolvedValue({
    data: [{ id: 'bob-uuid', full_name: 'Bob' }],
    error: null,
  })
}

describe('Error code mapping — useShares', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    singleInsertMock.mockReset()
    mockRpcSuccess()
  })

  it('23505 (unique_violation) → "already shared" message', async () => {
    singleInsertMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })

    const { result } = renderHook(() => useShares(1))
    let msg
    await act(async () => {
      msg = await result.current.shareByEmail('bob@example.com', 'view')
    })

    expect(msg).toBe('This note is already shared with that user.')
  })

  it('23514 (check_violation) → "cannot share with yourself" message', async () => {
    singleInsertMock.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'self-share' },
    })

    const { result } = renderHook(() => useShares(1))
    let msg
    await act(async () => {
      msg = await result.current.shareByEmail('alice@example.com', 'view')
    })

    expect(msg).toBe('You cannot share a note with yourself.')
  })
})

describe('Error code mapping — useDocumentShares', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    singleInsertMock.mockReset()
    mockRpcSuccess()
  })

  it('23505 (unique_violation) → "already shared" message', async () => {
    singleInsertMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })

    const { result } = renderHook(() => useDocumentShares(10))
    let msg
    await act(async () => {
      msg = await result.current.shareByEmail('bob@example.com', 'view')
    })

    expect(msg).toBe('This document is already shared with that user.')
  })

  it('23514 (check_violation) → "cannot share with yourself" message', async () => {
    singleInsertMock.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'self-share' },
    })

    const { result } = renderHook(() => useDocumentShares(10))
    let msg
    await act(async () => {
      msg = await result.current.shareByEmail('alice@example.com', 'view')
    })

    expect(msg).toBe('You cannot share a document with yourself.')
  })
})
