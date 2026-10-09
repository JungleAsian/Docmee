'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_BASE } from '../api/client'
import { readServerTime, serverTimeAt } from '../serverTime'

export function useServerTime() {
  const query = useQuery({
    queryKey: ['server-time', API_BASE],
    queryFn: ({ signal }) => readServerTime(API_BASE, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
    retry: 1,
  })
  const [monotonicNow, setMonotonicNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setMonotonicNow(performance.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])
  // A fresh response can arrive between ticks; show that sample immediately.
  const timestamp = monotonicNow === null ? null : serverTimeAt(query.data, Math.max(monotonicNow, query.data?.sampledAt ?? monotonicNow))
  return { timestamp, unavailable: query.isError || Boolean(query.data && timestamp === null && monotonicNow !== null) }
}
