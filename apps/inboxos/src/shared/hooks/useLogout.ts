'use client'

// Logout: best-effort revoke the refresh token server-side, then clear local
// session and return to /login.
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../api/client'
import { useAuthStore, authSnapshot } from '../store/auth'

export function useLogout() {
  const router = useRouter()
  const logout = useAuthStore((s) => s.logout)
  return useCallback(async () => {
    const { refreshToken } = authSnapshot()
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }).catch(() => {
        // ignore — we clear locally regardless
      })
    }
    logout()
    router.replace('/login')
  }, [logout, router])
}
