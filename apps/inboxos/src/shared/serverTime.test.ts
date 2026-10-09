import { describe, expect, it, vi } from 'vitest'
import { readServerTime, serverTimeAt } from './serverTime'

describe('server clock synchronization', () => {
  it('uses server time and elapsed monotonic time, not the computer wall clock', () => {
    const sample = { serverMs: Date.parse('2026-10-08T12:00:00Z'), sampledAt: 500 }
    vi.spyOn(Date, 'now').mockReturnValue(0)
    expect(serverTimeAt(sample, 2500)).toBe(Date.parse('2026-10-08T12:00:02Z'))
    vi.restoreAllMocks()
  })
  it('does not display an expired or invalid sample as current server time', () => {
    expect(serverTimeAt(undefined, 10)).toBeNull()
    expect(serverTimeAt({ serverMs: 0, sampledAt: 10 }, 9)).toBeNull()
    expect(serverTimeAt({ serverMs: 0, sampledAt: 10 }, 120011)).toBeNull()
    expect(serverTimeAt({ serverMs: NaN, sampledAt: 10 }, 20)).toBeNull()
  })
  it('requests an uncached heartbeat and compensates for network round-trip time', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, ts: '2026-10-08T12:00:00Z' }) })
    const monotonic = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(300)
    const sample = await readServerTime('/api', new AbortController().signal, fetcher, monotonic)
    expect(fetcher).toHaveBeenCalledWith('/api/heartbeat', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
    expect(sample).toEqual({ serverMs: Date.parse('2026-10-08T12:00:00Z') + 100, sampledAt: 300 })
  })
  it('rejects failed or invalid heartbeat responses rather than using local time', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ ok: true, ts: 'invalid' }) }]) {
      await expect(readServerTime('/api', new AbortController().signal, vi.fn().mockResolvedValue(response))).rejects.toThrow()
    }
  })
})
