import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from './auth'
import type { AuthUser } from '../types'

// Screen 6 — the active clinic drives clinic switching + the X-Clinic-Id header.
// These cover its lifecycle: a login pins it to the user's own clinic, an admin can
// switch it, and logout clears it so the next session never inherits a prior switch.
const user: AuthUser = { id: 'u-1', email: 'ana@demo.test', role: 'secretary', clinicId: 'c-1' }
const admin: AuthUser = { id: 'a-1', email: 'admin@demo.test', role: 'ia_studio_admin', clinicId: 'c-1' }

function login(u: AuthUser) {
  useAuthStore.getState().setSession({ accessToken: 'a', refreshToken: 'r', user: u })
}

describe('auth store — active clinic (Screen 6)', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  it('login pins the active clinic to the user\'s own clinic', () => {
    login(user)
    expect(useAuthStore.getState().activeClinicId).toBe('c-1')
  })

  it('an admin can switch the active clinic', () => {
    login(admin)
    useAuthStore.getState().setActiveClinicId('c-2')
    expect(useAuthStore.getState().activeClinicId).toBe('c-2')
  })

  it('a fresh login resets a previous switch', () => {
    login(admin)
    useAuthStore.getState().setActiveClinicId('c-2')
    login(admin)
    expect(useAuthStore.getState().activeClinicId).toBe('c-1')
  })

  it('logout clears the active clinic', () => {
    login(admin)
    useAuthStore.getState().setActiveClinicId('c-2')
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().activeClinicId).toBeNull()
  })
})
