'use client'

// Heartbeat hook — POST /user/heartbeat every 60s while authenticated so the
// timeout monitor (P07) knows a secretary is present. Fires once on mount, then
// on an interval; silently ignores failures (a missed beat is harmless).
import { useEffect } from 'react'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const HEARTBEAT_INTERVAL_MS = 60_000

export function useHeartbeat() {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken))

  useEffect(() => {
    if (!isAuthed) return
    const beat = () => {
      api.post('/user/heartbeat').catch(() => {
        // ignore — the next beat will retry
      })
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isAuthed])
}
