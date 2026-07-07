'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Periodically re-fetches the current server component so file-backed lists and
// status counts stay live without a manual reload. Pauses while the tab is hidden.
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const interval = Math.max(5, seconds) * 1000
    const tick = () => { if (!document.hidden) router.refresh() }
    const id = setInterval(tick, interval)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
