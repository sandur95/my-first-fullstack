import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShares } from '../../hooks/useShares'

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted vars are accessible inside vi.mock factory
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

describe('useShares — email normalisation', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    singleInsertMock.mockReset()
  })

  it('trims and lower-cases the email before calling get_user_id_by_email', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'bob-uuid', full_name: 'Bob' }],
      error: null,
    })
    singleInsertMock.mockResolvedValue({
      data: { id: 1, permission: 'view', created_at: new Date().toISOString(), users: null },
      error: null,
    })

    const { result } = renderHook(() => useShares(42))

    let returnValue
    await act(async () => {
      returnValue = await result.current.shareByEmail('  Alice@Example.COM  ', 'view')
    })

    expect(rpcMock).toHaveBeenCalledWith('get_user_id_by_email', {
      p_email: 'alice@example.com',
    })
    expect(returnValue).toBeNull() // success
  })

  it('returns an error message when no account is found', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useShares(42))

    let returnValue
    await act(async () => {
      returnValue = await result.current.shareByEmail('nobody@example.com', 'view')
    })

    expect(returnValue).toMatch(/no account found/i)
  })
})
