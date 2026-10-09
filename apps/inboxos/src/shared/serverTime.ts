export type ServerTimeSample = { serverMs: number; sampledAt: number }
export const SERVER_TIME_MAX_AGE_MS = 120_000

export function serverTimeAt(sample: ServerTimeSample | undefined, monotonicNow: number): number | null {
  if (!sample || !Number.isFinite(sample.serverMs)) return null
  const elapsed = monotonicNow - sample.sampledAt
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > SERVER_TIME_MAX_AGE_MS) return null
  return sample.serverMs + elapsed
}

export async function readServerTime(
  base: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  monotonic: () => number = () => performance.now(),
): Promise<ServerTimeSample> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(abort, 10_000)
  try {
    const startedAt = monotonic()
    // Public, read-only heartbeat: no credentials or clinic information are sent.
    const response = await fetcher(`${base}/heartbeat`, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error('Server time unavailable')
    const body = await response.json() as { ok?: boolean; ts?: unknown }
    const receivedAt = monotonic()
    const serverMs = typeof body.ts === 'string' ? Date.parse(body.ts) : NaN
    if (!body.ok || !Number.isFinite(serverMs)) throw new Error('Invalid server timestamp')
    // Approximate one-way latency; subsequent ticks never depend on Date.now().
    return { serverMs: serverMs + Math.max(0, receivedAt - startedAt) / 2, sampledAt: receivedAt }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
