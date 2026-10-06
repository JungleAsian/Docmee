import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout, CALENDAR_TIMEOUT_MS } from '../calbot/google-calendar-client.js'

// Reliability fix: googleapis has no built-in request timeout, so an
// unresponsive Google Calendar could otherwise hang the awaiting call (and
// with it, the whole workflow run / patient conversation) indefinitely.
// withTimeout is the single mechanism every Calendar network call in
// google-calendar-client.ts is wrapped in — this proves it actually bounds a
// hung call rather than relying on it "probably working" because it compiles.
// Fake timers so the "hangs forever" case doesn't actually block the test
// suite for CALENDAR_TIMEOUT_MS real milliseconds.
describe('withTimeout (booking-flow freeze prevention)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves normally when the underlying call finishes well within the window', async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 5))
    const result = withTimeout(fast, 'test op')
    await vi.advanceTimersByTimeAsync(5)
    await expect(result).resolves.toBe('ok')
  })

  it('rejects with a clear error instead of hanging forever when the call never settles', async () => {
    // A promise that NEVER resolves or rejects — the exact failure mode an
    // unresponsive Google endpoint would produce. Without the timeout wrapper,
    // this would hang forever; with it, advancing past CALENDAR_TIMEOUT_MS
    // must produce a rejection.
    const hangs = new Promise<string>(() => {})
    const result = withTimeout(hangs, 'availability lookup')
    const assertion = expect(result).rejects.toThrow(/availability lookup timed out/)
    await vi.advanceTimersByTimeAsync(CALENDAR_TIMEOUT_MS)
    await assertion
  })

  it('propagates the underlying rejection unchanged when the call fails fast', async () => {
    const fails = Promise.reject(new Error('Google says no'))
    await expect(withTimeout(fails, 'test op')).rejects.toThrow('Google says no')
  })

  it('clears its timer once the call settles, so no stray timers pile up', async () => {
    await withTimeout(Promise.resolve('ok'), 'test op')
    await expect(withTimeout(Promise.reject(new Error('no')), 'test op')).rejects.toThrow('no')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a bounded, sane timeout window', () => {
    // Long enough to never trip on a normal (sub-2s) Calendar call; short
    // enough that a genuine hang resolves in seconds, not minutes.
    expect(CALENDAR_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    expect(CALENDAR_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})
