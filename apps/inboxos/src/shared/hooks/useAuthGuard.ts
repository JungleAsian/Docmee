'use client'

// Auth guard for protected layouts. Waits for the persisted store to hydrate,
// then redirects unauthenticated users to /login and role-gated users away from
// pages they cannot access. Returns the resolved user once allowed.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/auth'
import type { PanelRole } from '../types'

interface GuardResult {
  ready: boolean
  user: ReturnType<typeof useAuthStore.getState>['user']
}

export function useAuthGuard(allowedRoles?: PanelRole[]): GuardResult {
  const router = useRouter()
  const hydrated = useAuthStore((s) => s.hydrated)
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)

  const authorized = Boolean(accessToken && user && (!allowedRoles || allowedRoles.includes(user.role)))

  useEffect(() => {
    if (!hydrated) return
    if (!accessToken || !user) {
      router.replace('/login')
      return
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      // Authenticated but wrong role — send to the surface they can use.
      router.replace('/inbox')
    }
  }, [hydrated, accessToken, user, allowedRoles, router])

  return { ready: hydrated && authorized, user }
}
