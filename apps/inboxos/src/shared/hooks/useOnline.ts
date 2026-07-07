'use client'

// Connectivity hook — tracks whether the browser currently has a network
// connection so the inbox can surface an offline/disconnected banner (a required
// state for the operational queue: a secretary must know when a reply can't reach
// the patient). Seeds from navigator.onLine and follows the window online/offline
// events. SSR-safe (assumes online until the client hydrates).
import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  return online
}
