'use client'

import { useEffect, useRef } from 'react'
import { useLogout } from '../hooks/useLogout'
import { useAuthStore } from '../store/auth'

const ACTIVITY_EVENTS = ['pointerdown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'visibilitychange'] as const
const DEFAULT_TIMEOUT_MINUTES = 1

function normalizedTimeoutMs(value: number | undefined): number {
  const minutes = Number.isFinite(value) && value ? value : DEFAULT_TIMEOUT_MINUTES
  return Math.max(1, Math.min(480, minutes)) * 60_000
}

export function InactivityLogout() {
  const hydrated = useAuthStore((s) => s.hydrated)
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()
  const logoutRef = useRef(logout)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    logoutRef.current = logout
  }, [logout])

  useEffect(() => {
    if (!hydrated || !user) return

    let active = true
    const timeoutMs = normalizedTimeoutMs(user.inactivityTimeoutMinutes)

    function clearTimer() {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    function resetTimer() {
      if (!active) return
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        active = false
        try {
          sessionStorage.setItem('docmee-inactivity-timeout', '1')
        } catch {
          /* sessionStorage unavailable; logout still proceeds */
        }
        void logoutRef.current()
      }, timeoutMs)
    }

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, resetTimer, { passive: true })
    }
    resetTimer()

    return () => {
      active = false
      clearTimer()
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, resetTimer)
      }
    }
  }, [hydrated, user?.id, user?.inactivityTimeoutMinutes])

  return null
}
