import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetGoogleOAuthStateStoreForTests,
  consumeGoogleOAuthState,
  issueGoogleOAuthState,
} from './oauth-state-store.js'

describe('Google OAuth state store', () => {
  beforeEach(() => {
    __resetGoogleOAuthStateStoreForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes a tenant-bound state exactly once', async () => {
    const binding = { flow: 'clinic' as const, clinicId: 'clinic-1', userId: 'admin-1' }
    const state = await issueGoogleOAuthState(binding)
    expect(state).not.toContain('clinic-1')
    await expect(consumeGoogleOAuthState(state)).resolves.toEqual(binding)
    await expect(consumeGoogleOAuthState(state)).resolves.toBeNull()
  })

  it('rejects an expired state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T00:00:00.000Z'))
    const state = await issueGoogleOAuthState(
      { flow: 'doctor', clinicId: 'clinic-1', doctorId: 'doctor-1', userId: 'admin-1' },
      1,
    )
    vi.advanceTimersByTime(1_001)
    await expect(consumeGoogleOAuthState(state)).resolves.toBeNull()
  })
})
