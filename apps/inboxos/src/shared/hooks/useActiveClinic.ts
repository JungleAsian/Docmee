'use client'

// Screen 6 — the active-clinic context. Every clinic-scoped surface (inbox,
// calendar, contextual panels) reads the clinic it operates on from here instead of
// hard-coding the JWT clinic, so an ia_studio_admin can switch which clinic they are
// working in. The api client sends `clinicId` as the X-Clinic-Id header; the server
// pins non-admins to their own clinic, so switching is only effective for admins.
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'

export interface ActiveClinic {
  /** The clinic id every clinic-scoped request should target. */
  clinicId: string
  /** The user's home clinic (the tenant they belong to) — never changes by switching. */
  homeClinicId: string
  /** Whether the operator may switch clinics (ia_studio_admin only). */
  canSwitch: boolean
  /** True while the active clinic is the operator's own (false → admin cross-tenant view). */
  isHome: boolean
  /** Switch the active clinic and drop cached clinic-scoped data so it refetches. */
  switchClinic: (clinicId: string) => void
}

export function useActiveClinic(): ActiveClinic {
  const user = useAuthStore((s) => s.user)
  const activeClinicId = useAuthStore((s) => s.activeClinicId)
  const setActiveClinicId = useAuthStore((s) => s.setActiveClinicId)
  const qc = useQueryClient()

  const homeClinicId = user?.clinicId ?? ''
  const clinicId = activeClinicId ?? homeClinicId
  const canSwitch = user?.role === 'ia_studio_admin'

  const switchClinic = useCallback(
    (next: string) => {
      if (!next || next === clinicId) return
      setActiveClinicId(next)
      // Cached queries don't key on the clinic, so a switch must invalidate them or
      // the panel would keep showing the previous clinic's threads/appointments.
      // invalidate (not clear) so active queries refetch immediately under the new
      // X-Clinic-Id header while the switcher's own clinic list stays populated.
      void qc.invalidateQueries()
    },
    [clinicId, setActiveClinicId, qc],
  )

  return {
    clinicId,
    homeClinicId,
    canSwitch,
    isHome: clinicId === homeClinicId,
    switchClinic,
  }
}
